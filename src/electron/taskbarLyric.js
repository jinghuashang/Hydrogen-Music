// 任务栏歌词：在 Windows 任务栏区域铺一层透明、鼠标穿透、置顶的窗口显示当前歌词
// 仅在 Windows 生效（其它平台的 workArea 语义不同）
const { BrowserWindow, screen, nativeTheme, app } = require('electron')
const path = require('path')

const OVERLAY_HTML = 'taskbar-lyric.html'
const DEV_SERVER_URL = 'http://localhost:5173/taskbar-lyric.html'
const DEFAULT_TASKBAR_HEIGHT = 48

let overlay = null
let enabled = false
let lastPayload = null
let displayWatched = false
let raiseTimer = null

// 显示样式（由设置页写入，主进程统一合并进推送内容）
const DEFAULT_STYLE = {
    fontSize: 20,
    align: 'center',
    color: '',
    background: '',
    backgroundAlpha: 100,
    fontFamily: '',
    fontWeight: 'bold',
    italic: false,
    letterSpacing: 0,
    shadow: true,
    stroke: false,
    strokeColor: '#ffffff',
    strokeWidth: 2,
    karaoke: false,
    karaokeColor: '#e8384f',
    glowRadius: 8,
    offsetX: 0,
    offsetY: 0,
}
let style = { ...DEFAULT_STYLE }

const clamp = (value, min, max, fallback) => {
    const num = Number(value)
    if (!Number.isFinite(num)) return fallback
    return Math.min(max, Math.max(min, num))
}

/**
 * Windows 11 的任务栏会周期性重绘并抢回 z 序，只设置一次置顶会被压到图标下面，
 * 这里以较低频率重申置顶（SetWindowPos 调用本身很便宜，不会引起重绘抖动）。
 */
function startRaiseTimer() {
    if (raiseTimer) return
    raiseTimer = setInterval(() => {
        if (!enabled || !overlay || overlay.isDestroyed()) return
        overlay.setAlwaysOnTop(true, 'screen-saver')
    }, 500)
}

function stopRaiseTimer() {
    if (!raiseTimer) return
    clearInterval(raiseTimer)
    raiseTimer = null
}

// 与主窗口一致：开发态走 vite dev server
const isDev = () => process.resourcesPath.indexOf('\\node_modules\\') != -1

/**
 * 任务栏占据的屏幕区域。
 * Windows 下 workArea 会排除任务栏，所以屏幕边缘与 workArea 的差值就是任务栏厚度。
 * 任务栏在左侧/右侧或自动隐藏时退回「贴住屏幕底边显示一条」的兜底。
 */
function taskbarBounds() {
    const { bounds, workArea } = screen.getPrimaryDisplay()
    const reservedBottom = bounds.y + bounds.height - (workArea.y + workArea.height)
    if (reservedBottom > 0) {
        return { x: bounds.x, y: workArea.y + workArea.height, width: bounds.width, height: reservedBottom }
    }
    const reservedTop = workArea.y - bounds.y
    if (reservedTop > 0) {
        return { x: bounds.x, y: bounds.y, width: bounds.width, height: reservedTop }
    }
    return {
        x: bounds.x,
        y: bounds.y + bounds.height - DEFAULT_TASKBAR_HEIGHT,
        width: bounds.width,
        height: DEFAULT_TASKBAR_HEIGHT,
    }
}

function positionOverlay() {
    if (!overlay || overlay.isDestroyed()) return
    const area = taskbarBounds()
    // 偏移量允许为负：窗口可以略微伸出任务栏，用于微调视觉位置
    overlay.setBounds({
        x: area.x + style.offsetX,
        y: area.y + style.offsetY,
        width: area.width,
        height: area.height,
    })
}

function normalizeWords(words) {
    if (!Array.isArray(words)) return null
    const list = words
        .filter((word) => word && typeof word.c === 'string' && word.c)
        .map((word) => ({
            t: Number(word.t) || 0,
            d: Math.max(0, Number(word.d) || 0),
            c: word.c,
        }))
    return list.length ? list : null
}

function normalizeLines(lines) {
    if (!Array.isArray(lines)) return []
    return lines
        .filter((line) => line && typeof line.text === 'string')
        .slice(0, 5)
        .map((line) => ({
            text: line.text,
            start: Number(line.start) || 0,
            duration: Math.max(0, Number(line.duration) || 0),
            words: normalizeWords(line.words),
        }))
}

function payloadWithTheme(payload) {
    const now = Number(payload?.now)
    return {
        // 当前行 + 后续几行：覆盖层用本地时钟切句，句间切换不再等 IPC
        lines: normalizeLines(payload?.lines),
        now: Number.isFinite(now) ? Math.max(0, now) : 0,
        playing: payload?.playing === true,
        dark: nativeTheme.shouldUseDarkColors,
        ...style,
    }
}

function pushToOverlay() {
    if (!overlay || overlay.isDestroyed()) return
    overlay.webContents.send('taskbar-lyric:update', payloadWithTheme(lastPayload))
}

function createOverlay() {
    if (overlay && !overlay.isDestroyed()) return overlay
    const area = taskbarBounds()
    overlay = new BrowserWindow({
        x: area.x,
        y: area.y,
        width: area.width,
        height: area.height,
        frame: false,
        transparent: true,
        backgroundColor: '#00000000',
        hasShadow: false,
        resizable: false,
        movable: false,
        minimizable: false,
        maximizable: false,
        fullscreenable: false,
        skipTaskbar: true,
        focusable: false,
        show: false,
        webPreferences: {
            preload: path.resolve(__dirname, './taskbarLyricPreload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
        },
    })
    // 鼠标穿透 + 压在任务栏之上
    overlay.setIgnoreMouseEvents(true)
    overlay.setAlwaysOnTop(true, 'screen-saver')
    overlay.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    overlay.once('ready-to-show', () => {
        if (!enabled || overlay.isDestroyed()) return
        positionOverlay()
        overlay.showInactive()
    })
    overlay.webContents.on('did-finish-load', () => {
        if (!enabled) return
        pushToOverlay()
    })
    overlay.on('closed', () => {
        overlay = null
    })
    if (isDev()) overlay.loadURL(DEV_SERVER_URL)
    // 打包后本文件位于 app.asar/src/electron，页面在 app.asar/dist
    else overlay.loadFile(path.join(__dirname, '..', '..', 'dist', OVERLAY_HTML))
    return overlay
}

function destroyOverlay() {
    if (overlay && !overlay.isDestroyed()) overlay.destroy()
    overlay = null
}

function watchDisplays() {
    if (displayWatched) return
    displayWatched = true
    for (const event of ['display-metrics-changed', 'display-added', 'display-removed']) {
        screen.on(event, () => {
            if (enabled) positionOverlay()
        })
    }
    nativeTheme.on('updated', () => {
        if (enabled) pushToOverlay()
    })
}

/** 设置页改动样式时调用：更新缓存并立即刷新覆盖层 */
function setTaskbarStyle(nextStyle) {
    const next = nextStyle || {}
    style = {
        fontSize: clamp(next.fontSize, 10, 48, DEFAULT_STYLE.fontSize),
        align: ['left', 'center', 'right'].includes(next.align) ? next.align : DEFAULT_STYLE.align,
        color: typeof next.color === 'string' ? next.color : '',
        background: typeof next.background === 'string' ? next.background : '',
        backgroundAlpha: clamp(next.backgroundAlpha, 0, 100, DEFAULT_STYLE.backgroundAlpha),
        fontFamily: typeof next.fontFamily === 'string' ? next.fontFamily.trim() : '',
        fontWeight: ['normal', '500', 'bold'].includes(next.fontWeight) ? next.fontWeight : DEFAULT_STYLE.fontWeight,
        italic: next.italic === true,
        letterSpacing: clamp(next.letterSpacing, -5, 20, DEFAULT_STYLE.letterSpacing),
        shadow: next.shadow !== false,
        stroke: next.stroke === true,
        strokeColor: typeof next.strokeColor === 'string' ? next.strokeColor : DEFAULT_STYLE.strokeColor,
        strokeWidth: clamp(next.strokeWidth, 0, 6, DEFAULT_STYLE.strokeWidth),
        karaoke: next.karaoke === true,
        karaokeColor: typeof next.karaokeColor === 'string' ? next.karaokeColor : DEFAULT_STYLE.karaokeColor,
        glowRadius: clamp(next.glowRadius, 0, 24, DEFAULT_STYLE.glowRadius),
        // 偏移直接移动整条覆盖层：横向放宽到 ±2 倍屏宽，纵向 ±400，避免被窗口实际可用空间限制
        offsetX: clamp(next.offsetX, -6000, 6000, DEFAULT_STYLE.offsetX),
        offsetY: clamp(next.offsetY, -400, 400, DEFAULT_STYLE.offsetY),
    }
    positionOverlay()
    if (enabled) pushToOverlay()
}

/** 设置开关变化时调用：开启则建窗口，关闭则销毁 */
function applyTaskbarLyric(nextEnabled) {
    enabled = nextEnabled === true && process.platform === 'win32'
    if (!enabled) {
        stopRaiseTimer()
        destroyOverlay()
        return
    }
    watchDisplays()
    const win = createOverlay()
    positionOverlay()
    startRaiseTimer()
    if (win && !win.isDestroyed() && !win.isVisible() && win.webContents.getURL()) win.showInactive()
}

/** 渲染进程推送当前歌词行（禁用时只记下来，开启后补发） */
function sendTaskbarLyric(payload) {
    lastPayload = payload || null
    if (!enabled) return
    createOverlay()
    pushToOverlay()
}

app.on('before-quit', () => {
    enabled = false
    stopRaiseTimer()
    destroyOverlay()
})

/** settings.other -> 覆盖层样式，主进程各处（启动、保存设置）共用同一份映射 */
function styleFromSettings(other = {}) {
    return {
        fontSize: other.taskbarLyricSize,
        align: other.taskbarLyricAlign,
        color: other.taskbarLyricColor,
        background: other.taskbarLyricBackground,
        backgroundAlpha: other.taskbarLyricBackgroundAlpha,
        fontFamily: other.taskbarLyricFontFamily,
        fontWeight: other.taskbarLyricFontWeight,
        italic: other.taskbarLyricItalic,
        letterSpacing: other.taskbarLyricLetterSpacing,
        shadow: other.taskbarLyricShadow,
        stroke: other.taskbarLyricStroke,
        strokeColor: other.taskbarLyricStrokeColor,
        strokeWidth: other.taskbarLyricStrokeWidth,
        karaoke: other.taskbarLyricKaraoke,
        karaokeColor: other.taskbarLyricKaraokeColor,
        glowRadius: other.taskbarLyricGlowRadius,
        offsetX: other.taskbarLyricOffsetX,
        offsetY: other.taskbarLyricOffsetY,
    }
}

module.exports = { applyTaskbarLyric, sendTaskbarLyric, setTaskbarStyle, styleFromSettings }
