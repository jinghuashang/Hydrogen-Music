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

module.exports = { FALLBACK_CN_IP, RANDOM_CN_IP_FLAG, enableRandomCnIp }
