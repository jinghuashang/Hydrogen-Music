const { BrowserWindow, ipcMain, screen, globalShortcut } = require('electron')
const path = require('path')
const Store = require('electron-store')
const { getSystemFonts } = require('../electron/systemFonts')

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
                preload: path.resolve(__dirname, '../electron/preload.js'),
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
        if (process.resourcesPath && process.resourcesPath.indexOf('\\node_modules\\') !== -1) {
            this.win.loadURL('http://localhost:5173/#/desktop-lyric')
        } else {
            const indexHtml = path.resolve(__dirname, '../../dist/index.html')
            this.win.loadFile(indexHtml, { hash: 'desktop-lyric' })
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
        if (this.win && !this.win.isDestroyed()) {
            this.win.close()
        } else {
            this.createWindow()
        }
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
        ipcMain.handle('get-system-fonts', async () => {
            return await getSystemFonts()
        })
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
            if (this.win && !this.win.isDestroyed()) {
                this.win.webContents.send('desktop-lyric-render-data', data)
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
