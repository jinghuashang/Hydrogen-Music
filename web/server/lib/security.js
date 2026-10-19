/** 网关安全辅助（无依赖，供 server.js 与 handlers.js 共用） */

// 可改写上游出站目标的控制参数（NCM 上游会把这些字段拼进出站 URL / 请求头）
const CONTROL_KEYS = ['domain', 'proxy', 'headers', 'eapiConfig', 'x-api-key', 'realIP', 'randomCNIP']

/**
 * 从 URL 查询串中剥离控制参数与原型相关键。
 * /ncm 代理与 get-request-data 必须经过，防止 SSRF（含 __proto__ 注入形式）。
 */
function stripControlParams(urlStr) {
  try {
    const [pathname, search = ''] = String(urlStr || '').split('?')
    if (!search) return urlStr
    const params = new URLSearchParams(search)
    let changed = false
    for (const key of [...params.keys()]) {
      if (CONTROL_KEYS.includes(key) || /^(__proto__|constructor|prototype)\b/i.test(key)) {
        params.delete(key)
        changed = true
      }
    }
    return changed ? `${pathname}?${params.toString()}` : urlStr
  } catch {
    return urlStr
  }
}

module.exports = { CONTROL_KEYS, stripControlParams }
