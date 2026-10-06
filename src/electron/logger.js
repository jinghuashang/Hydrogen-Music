/**
 * Electron 主进程日志落盘：
 * - 主进程：捕获 stdout/stderr（含 pino 等绕过 console 的输出）与未捕获异常；
 * - 渲染进程：经 preload `windowApi.log` → IPC('renderer-log') 转发至此；
 * 开关为 settings.other.logToFile（设置页「日志落盘」），保存在 userData/logs。
 */

const path = require('path')
const { app, ipcMain } = require('electron')
const Store = require('electron-store')
const { createLogWriter, hookStdStreams } = require('../shared/logCore')

const KEEP_DAYS = 7

/** 每次读取都新建 Store，保证拿到最新写入的配置（与 shortcuts.js 同模式） */
function readEnabledFromStore() {
    try {
        const settings = new Store({ name: 'settings' }).get('settings')
        return settings?.other?.logToFile === true
    } catch (_) {
        return false
    }
}

let writer = null

function init() {
    if (writer) return writer
    writer = createLogWriter({
        dir: () => path.join(app.getPath('userData'), 'logs'),
        filePrefix: 'app',
        keepDays: KEEP_DAYS,
        header: () =>
            `Hydrogen Music v${require('../../package.json').version} | Electron ${process.versions.electron} | Node ${process.versions.node} | ${process.platform} ${process.arch}`,
    })
    hookStdStreams(writer)

    // 未捕获异常监控：不改变 Electron 默认崩溃处理，仅旁路记录
    process.on('uncaughtExceptionMonitor', (error, origin) => {
        writer.write('main:uncaught', `${origin} ${(error && (error.stack || error.message)) || String(error)}`)
    })

    ipcMain.on('renderer-log', (_event, level, text) => {
        const tag = `renderer:${typeof level === 'string' && level ? level : 'log'}`
        writer.write(tag, typeof text === 'string' ? text : String(text ?? ''))
    })
    ipcMain.handle('get-log-dir', () => writer.ensureDir())

    writer.setEnabled(readEnabledFromStore())
    return writer
}

function setEnabled(value) {
    if (writer) writer.setEnabled(value === true)
}

module.exports = { init, setEnabled }
