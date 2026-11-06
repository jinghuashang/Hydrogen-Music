const { BrowserWindow, ipcMain, screen, globalShortcut, nativeTheme } = require('electron')
const path = require('path')
const Store = require('electron-store')
const { desktopStyleFromSettings } = require('../electron/taskbarLyric')

// 读取主窗口设置里的任务栏歌词样式，供桌面歌词复用
const settingsStore = new Store({ name: 'settings' })

/**
 * 桌面歌词 payload → 任务栏歌词页面的 payload。
 * 逐字时间先按线性均分（无 YRC/KRC 时的降级），行有效时长沿用 lineDuration。
 */
function toTaskbarPayload(data) {
    const text = String(data?.currentLrc || '')
    const start = Number(data?.lineStartTime) || 0
    const available = Math.max(0.6, Number(data?.lineDuration) || 0)
    // 与任务栏 estimateSungDuration 同款估算：行长异常拉长时视为句尾间奏，
    // 按本行字数语速封顶，避免填充在间奏里继续爬（纯 LRC 场景的关键降级）
    const charCount = text.replace(/\s+/g, '').length
    const typical = charCount ? Math.max(1.2, charCount * 0.32 + 0.3) : available
    const cap = available > typical * 2.5 ? typical * 1.4 : available * 0.95
    const duration = Math.max(1.2, Math.min(cap, Math.max(typical, available * 0.75)))
    // 优先使用任务栏算好的真实词级时间（YRC/AMLL/KRC），缺失时退回线性均分
    const rawWords = Array.isArray(data?.words) && data.words.length ? data.words : null
    let words = null
    let sung = duration
    if (rawWords) {
        words = rawWords.map((w) => ({ c: w.c, t: Number(w.t) || 0, d: Number(w.d) || 0 }))
        const last = words[words.length - 1]
        if (last) sung = Math.max(0.4, last.t + last.d - start)
    } else {
        const chars = [...text].filter((ch) => ch.trim())
        const step = chars.length ? duration / chars.length : duration
        words = chars.length ? chars.map((ch, i) => ({ c: ch, t: start + i * step, d: step })) : null
    }
    return {
        lines: [{
            text,
            words,
            start,
            duration: sung,
            gap: 0,
            trans: data?.transLrc || '',
        }],
        now: Number(data?.progress) || 0,
        playing: data?.playing === true,
        // 桌面歌词使用自己的配置（desktopLyric*），与任务栏歌词完全分离
        ...desktopStyleFromSettings(settingsStore.get('settings')?.other || {}),
        // 任务栏按「背景亮度取反 > 系统深浅色」决定文字色；桌面歌词没有背景，走系统深浅色
        dark: nativeTheme.shouldUseDarkColors,

    }
}

class DesktopLyricManager {
    constructor() {
        this.win = null
        this.mainWin = null
        this.store = new Store({ name: 'desktopLyricState' })
        this.isLocked = this.store.get('isLocked', false)
        this.isEnabled = this.store.get('isEnabled', false)
    }

    init(mainWin) {
        this.mainWin = mainWin
        if (this.ipcRegistered) {
            // macOS 关窗再激活会二次 init，重复注册会抛错并中断后续初始化
            this.broadcastState()
            return
        }
        this.ipcRegistered = true
        this.registerIpc()
        this.registerShortcuts()
        if (this.isEnabled) {
            this.createWindow()
        }
        this.mainWin.webContents.on('did-finish-load', () => {
            this.broadcastState()
        })
    }

    broadcastState() {
        const isWinAlive = !!(this.win && !this.win.isDestroyed())
        if (this.mainWin && !this.mainWin.isDestroyed()) {
            this.mainWin.webContents.send('desktop-lyric-state-change', isWinAlive)
            this.mainWin.webContents.send('desktop-lyric-lock-status', this.isLocked)
        }
        if (isWinAlive) {
            this.win.webContents.send('desktop-lyric-lock-status', this.isLocked)
        }
    }

    createWindow() {
        if (this.win && !this.win.isDestroyed()) {
            this.win.show()
            this.win.focus()
            this.isEnabled = true
            this.store.set('isEnabled', true)
            this.broadcastState()
            return
        }

        const primaryDisplay = screen.getPrimaryDisplay()
        const { width: screenWidth, height: screenHeight } = primaryDisplay.workAreaSize

        const savedBounds = this.store.get('bounds', {
            x: Math.round((screenWidth - 800) / 2),
            y: screenHeight - 140,
            width: 800,
            height: 120
        })

        this.win = new BrowserWindow({
            x: savedBounds.x,
            y: savedBounds.y,
            width: savedBounds.width,
            height: savedBounds.height,
            minWidth: 400,
            minHeight: 80,
            frame: false,
            transparent: true,
            alwaysOnTop: true,
            skipTaskbar: true,
            hasShadow: false,
            resizable: true,
            backgroundColor: '#00000000',
            webPreferences: {
                preload: path.resolve(__dirname, '../electron/taskbarLyricPreload.js'),
                webSecurity: false,
                contextIsolation: true,
            }
        })

        // 系统最高置顶层级，覆盖全屏应用与任务栏（支持 macOS 与 Windows）
        this.win.setAlwaysOnTop(true, 'screen-saver')
        if (process.platform === 'darwin') {
            this.win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
        }

        // 加载桌面歌词视图
        // 与任务栏歌词共用同一份渲染页面（逐字卡拉OK、晕染、字位移完全一致）
        if (process.resourcesPath && process.resourcesPath.indexOf('\\node_modules\\') !== -1) {
            this.win.loadURL('http://localhost:5173/taskbar-lyric.html')
        } else {
            this.win.loadFile(path.resolve(__dirname, '../../dist/taskbar-lyric.html'))
        }

        this.win.webContents.on('did-finish-load', () => {
            this.applyLockState()
            if (this.mainWin && !this.mainWin.isDestroyed()) {
                this.mainWin.webContents.send('desktop-lyric-request-sync')
            }
        })

        // 应用当前的锁定（鼠标穿透）状态
        this.applyLockState()

        this.win.on('moved', () => {
            if (this.win && !this.win.isDestroyed()) {
                this.store.set('bounds', this.win.getBounds())
            }
        })
        this.win.on('resized', () => {
            if (this.win && !this.win.isDestroyed()) {
                this.store.set('bounds', this.win.getBounds())
            }
        })

        this.win.on('closed', () => {
            this.win = null
            this.isEnabled = false
            this.store.set('isEnabled', false)
            this.broadcastState()
        })

        this.isEnabled = true
        this.store.set('isEnabled', true)
        this.broadcastState()
    }

    applyLockState() {
        if (this.win && !this.win.isDestroyed()) {
            // forward: true 确保鼠标事件在穿透的同时不产生多余拦截
            this.win.setIgnoreMouseEvents(this.isLocked, { forward: true })
            this.win.webContents.send('desktop-lyric-lock-status', this.isLocked)
        }
        if (this.mainWin && !this.mainWin.isDestroyed()) {
            this.mainWin.webContents.send('desktop-lyric-lock-status', this.isLocked)
        }
    }

    setLock(locked) {
        this.isLocked = !!locked
        this.store.set('isLocked', this.isLocked)
        this.applyLockState()
        this.broadcastState()
    }

    toggleLock() {
        this.setLock(!this.isLocked)
    }

    toggle() {
        // 防抖：多个入口（托盘/设置/按钮/快捷键抖动）在极短时间内重复触发时只生效一次，
        // 否则 close() 是异步的，紧接着的 toggle 会读到窗口仍存活而再次 close/再创建，形成反复开关
        const now = Date.now()
        if (this.lastToggleAt && now - this.lastToggleAt < 350) return
        this.lastToggleAt = now
        if (this.win && !this.win.isDestroyed()) {
            this.isEnabled = false
            this.store.set('isEnabled', false)
            this.win.close()
        } else {
            this.createWindow()
        }
        this.broadcastState()
    }

    registerShortcuts() {
        // 注册置顶锁定快捷键 Ctrl+Alt+L / Cmd+Alt+L
        try {
            globalShortcut.register('CommandOrControl+Alt+L', () => {
                if (this.win && !this.win.isDestroyed()) {
                    this.toggleLock()
                } else if (this.isEnabled) {
                    this.toggleLock()
                }
            })
        } catch (e) {
            console.warn('[desktop-lyric] Failed to register lock shortcut:', e.message)
        }
    }

    registerIpc() {
        ipcMain.handle('desktop-lyric-get-state', () => {
            return {
                enabled: !!(this.win && !this.win.isDestroyed()),
                locked: this.isLocked,
            }
        })
        // get-system-fonts 已由主进程 ipcMain.js 注册，这里不重复注册（重复会抛错并中断 init）
        ipcMain.on('desktop-lyric-toggle', () => this.toggle())
        ipcMain.on('desktop-lyric-set-lock', (e, locked) => this.setLock(locked))
        ipcMain.on('desktop-lyric-set-ignore-mouse', (e, ignore, options) => {
            if (this.win && !this.win.isDestroyed() && this.isLocked) {
                this.win.setIgnoreMouseEvents(ignore, options || { forward: true })
            }
        })
        ipcMain.on('desktop-lyric-close', () => {
            if (this.win && !this.win.isDestroyed()) this.win.close()
        })
        ipcMain.on('desktop-lyric-data-sync', (e, data) => {
            // 只接受主窗口的推送：歌词窗口/其它渲染进程若也发送，会让两路数据互相覆盖（表现为歌词来回跳）
            if (!this.mainWin || this.mainWin.isDestroyed() || e.sender !== this.mainWin.webContents) return
            if (this.win && !this.win.isDestroyed()) {
                this.win.webContents.send('taskbar-lyric:update', toTaskbarPayload(data))
            }
        })
        ipcMain.on('desktop-lyric-action', (e, action, payload) => {
            if (action === 'openSettings') {
                if (this.mainWin && !this.mainWin.isDestroyed()) {
                    if (this.mainWin.isMinimized()) this.mainWin.restore()
                    this.mainWin.show()
                    this.mainWin.focus()
                }
            }
            if (this.mainWin && !this.mainWin.isDestroyed()) {
                this.mainWin.webContents.send('desktop-lyric-main-action', action, payload)
            }
        })
        ipcMain.on('desktop-lyric-config-update', (e, config) => {
            if (this.win && !this.win.isDestroyed()) {
                this.win.webContents.send('desktop-lyric-apply-config', config)
            }
        })
    }
}

module.exports = new DesktopLyricManager()
