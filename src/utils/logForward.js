/**
 * 渲染进程日志转发：console.* 与全局错误经 windowApi.log 送到主进程 / Web 网关，
 * 是否落盘由对端按「日志落盘」开关决定（关闭时对端直接丢弃，绝不改变控制台行为）。
 */

const MAX_ARG_LENGTH = 4000
const LEVELS = ['log', 'info', 'warn', 'error', 'debug']

function formatValue(value) {
  if (typeof value === 'string') return value
  if (value instanceof Error) return value.stack || value.message || String(value)
  if (typeof value === 'undefined') return 'undefined'
  if (typeof value === 'function') return `[Function: ${value.name || 'anonymous'}]`
  if (typeof value === 'symbol') return value.toString()
  if (typeof value === 'bigint') return `${value}n`
  let text
  try {
    text = JSON.stringify(value)
  } catch (_) {
    text = String(value)
  }
  if (text === undefined) text = String(value)
  return text.length > MAX_ARG_LENGTH ? `${text.slice(0, MAX_ARG_LENGTH)} …[truncated]` : text
}

function formatArgs(args) {
  return args.map(formatValue).join(' ')
}

export function installLogForwarding() {
  if (typeof window === 'undefined' || window.__hydrogenLogForwardingInstalled) return
  const api = globalThis.windowApi
  if (!api || typeof api.log !== 'function') return
  window.__hydrogenLogForwardingInstalled = true

  const forward = (level, text) => {
    try {
      api.log(level, text)
    } catch (_) {}
  }

  for (const level of LEVELS) {
    const original = console[level]
    if (typeof original !== 'function') continue
    console[level] = (...args) => {
      try {
        forward(level, formatArgs(args))
      } catch (_) {}
      original.apply(console, args)
    }
  }

  // 资源加载错误（img/script 等）不冒泡，需在捕获阶段监听
  window.addEventListener(
    'error',
    (event) => {
      if (!event.error && !event.message) {
        // 仅记录脚本/样式等关键资源，避免图片/媒体失败刷屏
        const target = event.target
        const tagName = target && target.tagName
        if (tagName !== 'SCRIPT' && tagName !== 'LINK') return
        forward('error', `[resource] 加载失败: ${(target && (target.src || target.href)) || 'unknown'}`)
        return
      }
      const detail = (event.error && (event.error.stack || event.error.message)) || event.message
      const where = event.filename ? ` (${event.filename}:${event.lineno}:${event.colno})` : ''
      forward('error', `[window.onerror] ${detail}${where}`)
    },
    true,
  )

  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason
    const detail = (reason && (reason.stack || reason.message)) || String(reason)
    forward('error', `[unhandledrejection] ${detail}`)
  })
}
