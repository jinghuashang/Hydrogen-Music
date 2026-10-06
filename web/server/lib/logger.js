/**
 * Web 网关日志落盘：与 Electron 主进程共用 logCore。
 * - 网关自身 stdout/stderr（含 console 与 pino 输出）直接落盘；
 * - 浏览器端日志经 /api/send 事件 'renderer-log' 转发落盘；
 * 开关同为 settings.other.logToFile（设置页「日志落盘」），保存在 web/server/data/logs。
 */

const path = require('path')
const { createLogWriter, hookStdStreams } = require('../../../src/shared/logCore')
const { createStore, DATA_DIR } = require('./store')

const KEEP_DAYS = 7

function readEnabledFromStore() {
  try {
    const settings = createStore('settings').get('settings')
    return settings?.other?.logToFile === true
  } catch (_) {
    return false
  }
}

let writer = null

function init() {
  if (writer) return writer
  writer = createLogWriter({
    dir: path.join(DATA_DIR, 'logs'),
    filePrefix: 'app',
    keepDays: KEEP_DAYS,
    header: () => `Hydrogen Music Web Gateway | Node ${process.version} | ${process.platform} ${process.arch}`,
  })
  hookStdStreams(writer)
  writer.setEnabled(readEnabledFromStore())
  return writer
}

function setEnabled(value) {
  if (writer) writer.setEnabled(value === true)
}

function writeRendererLog(level, text) {
  if (!writer) return
  const tag = `renderer:${typeof level === 'string' && level ? level : 'log'}`
  writer.write(tag, typeof text === 'string' ? text : String(text ?? ''))
}

function getLogDir() {
  return writer ? writer.ensureDir() : null
}

module.exports = { init, setEnabled, writeRendererLog, getLogDir }
