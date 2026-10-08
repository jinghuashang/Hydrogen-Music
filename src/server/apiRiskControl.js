// 网易云风控（-460 网络环境存在风险）缓解：让上游请求带上随机中国大陆 IP。
//
// 上游 API 会把调用方 IP 当作 X-Real-IP 传给网易：桌面端是 127.0.0.1、Web 网关下是浏览器内网 IP，
// 这类私有地址容易被判定为「网络环境存在风险」。上游为此提供了 ENABLE_RANDOM_CN_IP 开关
// （开启后所有请求改用 global.cnIp），但只有 app.js 入口会初始化 global.cnIp ——
// 我们直接调 serveNcmApi，所以这里补上开关与初始化。

const RANDOM_CN_IP_FLAG = 'ENABLE_RANDOM_CN_IP'
// 上游生成器不可用时的兜底：一个中国大陆地址，仍优于把 127.0.0.1/内网 IP 传上去
const FALLBACK_CN_IP = '116.25.146.177'
const IPV4_PATTERN = /^\d{1,3}(\.\d{1,3}){3}$/

/**
 * 打开随机中国 IP 缓解。
 * 显式设置 ENABLE_RANDOM_CN_IP=false 时尊重用户选择，不做任何改动。
 * @returns {boolean} 是否接管了该开关
 */
function enableRandomCnIp({ env = process.env, globalScope = globalThis, generateIp } = {}) {
  if (env[RANDOM_CN_IP_FLAG] === 'false') return false

  env[RANDOM_CN_IP_FLAG] = 'true'

  if (!globalScope.cnIp) {
    let generated = ''
    try {
      generated = typeof generateIp === 'function' ? String(generateIp() || '') : ''
    } catch (_) {
      generated = ''
    }
    globalScope.cnIp = IPV4_PATTERN.test(generated) ? generated : FALLBACK_CN_IP
  }
  return true
}

/**
 * 包装上游 request：让 X-Real-IP 始终为随机中国大陆 IP，并在网易云返回 -460（网络环境存在风险）时换 IP 重试一次。
 *
 * 背景：randomCNIP=true 时上游会跳过 IP 注入，请求不带 X-Real-IP，网易云按真实出口 IP 判定；
 * 出口为机房/VPN 或本机私有 IP 时容易触发 -460。这里显式补 realIP 并做一次透明重试。
 *
 * @param {Function} original 上游 request（签名 (path, data, options)）
 * @param {{ generateIp?: Function, logger?: Console }} [options]
 */
function createRiskControlledRequest(original, { generateIp, logger = console, retryCooldownMs = 8000, now = () => Date.now() } = {}) {
  const nextIp = () => {
    try {
      const generated = typeof generateIp === 'function' ? String(generateIp() || '') : ''
      if (IPV4_PATTERN.test(generated)) return generated
    } catch (_) {}
    return FALLBACK_CN_IP
  }

  // -460 重试冷却：避免并发请求同时重试形成风暴，反而加重风控
  let retryAfter = 0

  return async function riskControlledRequest(...args) {
    const options = args[2] || {}
    if (options.randomCNIP && !options.realIP) {
      options.realIP = nextIp()
      args[2] = options
    }

    // 上游对非 200 是 reject（抛 { status, body, cookie }），-460 也在其中
    const isRiskError = (value) => !!value && !!value.body && value.body.code === -460

    const retryOnce = async () => {
      options.realIP = nextIp()
      args[2] = options
      logger.warn && logger.warn('[riskControl] 命中 -460，已切换随机 IP 重试')
      return original(...args)
    }

    let response
    try {
      response = await original(...args)
    } catch (e) {
      if (isRiskError(e) && now() >= retryAfter) {
        retryAfter = now() + retryCooldownMs
        return retryOnce()
      }
      if (isRiskError(e)) {
        logger.warn && logger.warn('[riskControl] 命中 -460，冷却中不再重试')
      }
      throw e
    }

    if (isRiskError(response)) {
      if (now() < retryAfter) {
        logger.warn && logger.warn('[riskControl] 命中 -460，冷却中不再重试')
        return response
      }
      retryAfter = now() + retryCooldownMs
      return retryOnce()
    }
    return response
  }
}

/**
 * 用风控包装替换上游 request 模块的导出。
 * 必须在 require('@neteasecloudmusicapienhanced/api') 之前调用，否则上游已持有原函数引用。
 */
function patchUpstreamRequest({ generateIp, logger } = {}) {
  try {
    const modulePath = require.resolve('@neteasecloudmusicapienhanced/api/util/request')
    const original = require(modulePath)
    const patched = createRiskControlledRequest(original, { generateIp, logger })
    require.cache[modulePath].exports = patched
    return true
  } catch (e) {
    logger && logger.warn && logger.warn('[riskControl] request 包装失败:', e.message)
    return false
  }
}

module.exports = { FALLBACK_CN_IP, RANDOM_CN_IP_FLAG, enableRandomCnIp, createRiskControlledRequest, patchUpstreamRequest }
