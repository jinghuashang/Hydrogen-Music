/**
 * 日志落盘核心（Node CJS，无 Electron 依赖）：Electron 主进程与 Web 网关共用。
 * - 捕获 process.stdout/stderr.write 与 fs 对 fd 1/2 的直写（pino/sonic-boom 等绕过 console 的输出）
 * - 按天滚动写入 <dir>/<filePrefix>-YYYY-MM-DD.log，自动清理超过 keepDays 的历史文件
 * - 仅在 enabled 时写盘；写盘失败自动熔断（broken），绝不影响主流程
 */

const fs = require('fs')
const path = require('path')

const MAX_LINE_LENGTH = 16384
/** stdout/stderr 残缺行（无换行结尾）延迟落盘时间 */
const TAIL_FLUSH_MS = 1000

function pad(value, width = 2) {
  return String(value).padStart(width, '0')
}

function dateStamp(date = new Date()) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function timeStamp(date = new Date()) {
  return `${dateStamp(date)} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`
}

/**
 * @param {object} options
 * @param {string|Function} options.dir 日志目录（函数形式可延迟解析）
 * @param {string} [options.filePrefix]
 * @param {number} [options.keepDays]
 * @param {string|Function} [options.header] 每个日志文件开头写入的会话标记
 */
function createLogWriter(options = {}) {
  const filePrefix = options.filePrefix || 'app'
  const keepDays = Number.isFinite(options.keepDays) && options.keepDays > 0 ? options.keepDays : 7
  const dirOption = options.dir
  const header = options.header

  let enabled = false
  let broken = false
  let resolvedDir = null
  let currentFile = null
  let currentDay = null

  function getDir() {
    if (!resolvedDir) {
      resolvedDir = typeof dirOption === 'function' ? dirOption() : dirOption
    }
    return resolvedDir
  }

  function ensureDir() {
    const dir = getDir()
    try {
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    } catch (_) {}
    return dir
  }

  function pruneOldFiles() {
    try {
      const pattern = new RegExp(`^${filePrefix}-\\d{4}-\\d{2}-\\d{2}\\.log$`)
      const existing = fs.readdirSync(getDir()).filter((name) => pattern.test(name)).sort()
      // 当天文件尚未落盘、单独占一个保留位
      const keepOld = Math.max(keepDays - 1, 0)
      const expired = keepOld === 0 ? existing : existing.slice(0, -keepOld)
      for (const name of expired) {
        try {
          fs.unlinkSync(path.join(getDir(), name))
        } catch (_) {}
      }
    } catch (_) {}
  }

  function writeRaw(line) {
    if (!enabled || broken) return
    try {
      const day = dateStamp()
      if (!currentFile || day !== currentDay) {
        currentDay = day
        ensureDir()
        currentFile = path.join(getDir(), `${filePrefix}-${day}.log`)
        pruneOldFiles()
        const head = typeof header === 'function' ? header() : header
        if (head) writeRaw(`${timeStamp()} [log] ===== ${head} =====`)
      }
      const text = line.length > MAX_LINE_LENGTH ? `${line.slice(0, MAX_LINE_LENGTH)} …[truncated]` : line
      fs.appendFileSync(currentFile, text.endsWith('\n') ? text : `${text}\n`, 'utf8')
    } catch (error) {
      broken = true
      try {
        process.stderr.write(`[logger] 日志写入失败，已停止落盘: ${(error && error.message) || error}\n`)
      } catch (_) {}
    }
  }

  return {
    /** 写入一行：<时间> [tag] <text> */
    write(tag, text) {
      writeRaw(`${timeStamp()} [${tag}] ${text}`)
    },
    getDir,
    ensureDir,
    isEnabled: () => enabled,
    isBroken: () => broken,
    canCapture: () => enabled && !broken,
    /** 开关切换：写入开启/关闭标记，随后生效 */
    setEnabled(next) {
      const value = next === true
      if (value === enabled) return
      if (value) {
        enabled = true
        writeRaw(`${timeStamp()} [log] ----- 日志落盘已开启 -----`)
      } else {
        writeRaw(`${timeStamp()} [log] ----- 日志落盘已关闭 -----`)
        enabled = false
      }
    },
  }
}

const hookedWriters = new WeakSet()

/**
 * 挂接捕获钩子（全局一次）：
 * 1. process.stdout/stderr.write —— 覆盖全部 console.* 与直接流写入；
 * 2. fs.writeSync / fs.write 对 fd 1/2 的直写 —— 覆盖 pino/sonic-boom 等绕过流的输出，
 *    通过 capturing 标志避免与第 1 层重复采集。
 */
function hookStdStreams(writer) {
  if (!writer || hookedWriters.has(writer)) return
  hookedWriters.add(writer)

  let capturing = false
  const tails = new Map()
  let flushTimer = null

  function flushTails() {
    flushTimer = null
    for (const [tag, tail] of tails) {
      tails.delete(tag)
      if (tail) writer.write(tag, tail)
    }
  }

  function scheduleFlush() {
    if (flushTimer) return
    flushTimer = setTimeout(flushTails, TAIL_FLUSH_MS)
    if (typeof flushTimer.unref === 'function') flushTimer.unref()
  }

  function feed(tag, chunk) {
    if (!writer.canCapture() || chunk == null) return
    const text = typeof chunk === 'string' ? chunk : Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk)
    if (!text) return
    const parts = ((tails.get(tag) || '') + text).split(/\r\n|\n|\r/)
    const tail = parts.pop()
    for (const line of parts) {
      if (line) writer.write(tag, line)
    }
    if (tail) {
      tails.set(tag, tail)
      scheduleFlush()
    } else {
      tails.delete(tag)
    }
  }

  for (const [stream, tag] of [
    [process.stdout, 'stdout'],
    [process.stderr, 'stderr'],
  ]) {
    const originalWrite = stream.write
    stream.write = function (chunk, encoding, callback) {
      if (!writer.canCapture()) return originalWrite.apply(stream, arguments)
      capturing = true
      try {
        feed(tag, chunk)
        return originalWrite.apply(stream, arguments)
      } finally {
        capturing = false
      }
    }
  }

  const originalWriteSync = fs.writeSync
  fs.writeSync = function (fd, ...rest) {
    if (!capturing && (fd === 1 || fd === 2) && writer.canCapture()) {
      feed(fd === 1 ? 'stdout' : 'stderr', rest[0])
    }
    return originalWriteSync.apply(fs, arguments)
  }

  const originalFsWrite = fs.write
  fs.write = function (fd, ...rest) {
    if (!capturing && (fd === 1 || fd === 2) && writer.canCapture()) {
      feed(fd === 1 ? 'stdout' : 'stderr', rest[0])
    }
    return originalFsWrite.apply(fs, arguments)
  }
}

module.exports = {
  createLogWriter,
  hookStdStreams,
}
