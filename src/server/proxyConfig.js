// 应用内代理配置解析（纯函数，便于测试）：默认直连，只有设置里填了地址才走代理
const PROXY_ENV_KEYS = [
  'http_proxy',
  'https_proxy',
  'all_proxy',
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'ALL_PROXY',
  'npm_config_proxy',
  'npm_config_https_proxy',
]
const NO_PROXY_VALUE = 'localhost,127.0.0.1,::1'
const SUPPORTED_PROTOCOLS = new Set(['http:', 'https:', 'socks:', 'socks4:', 'socks5:', 'socks5h:'])

/** 归一化用户填写的代理地址；空值/非法值返回 null（按直连处理） */
function normalizeProxyUrl(raw) {
  const value = typeof raw === 'string' ? raw.trim() : ''
  if (!value) return null
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `http://${value}`
  let parsed
  try {
    parsed = new URL(withScheme)
  } catch {
    return null
  }
  if (!SUPPORTED_PROTOCOLS.has(parsed.protocol)) return null
  if (!parsed.hostname || !parsed.port) return null
  const port = Number(parsed.port)
  if (!Number.isInteger(port) || port <= 0 || port > 65535) return null
  const protocol = parsed.protocol.replace(':', '')
  return {
    protocol,
    host: parsed.hostname,
    port,
    url: `${protocol}://${parsed.hostname}:${port}`,
    username: parsed.username ? decodeURIComponent(parsed.username) : '',
    password: parsed.password ? decodeURIComponent(parsed.password) : '',
  }
}

function isSocksProxy(proxy) {
  return !!proxy && proxy.protocol.startsWith('socks')
}

/** Electron session.setProxy 配置：未配置 = direct（连系统代理一起忽略） */
function buildSessionProxyConfig(raw) {
  const proxy = normalizeProxyUrl(raw)
  if (!proxy) return { mode: 'direct' }
  const authority = `${proxy.host}:${proxy.port}`
  return {
    proxyRules: isSocksProxy(proxy) ? `${proxy.protocol}://${authority}` : `http=${authority};https=${authority}`,
    proxyBypassRules: '<local>',
  }
}

/**
 * 主进程 Node 侧（axios / electron-updater / NCM API 服务）的代理环境变量：
 * 先清掉系统与外部环境里的所有代理，再按应用内配置写入（socks 走 agent，不写环境变量）。
 */
function applyProxyEnv(env, raw, { noProxy = NO_PROXY_VALUE } = {}) {
  for (const key of PROXY_ENV_KEYS) delete env[key]
  delete env.no_proxy
  delete env.NO_PROXY

  const proxy = normalizeProxyUrl(raw)
  if (!proxy || isSocksProxy(proxy)) return env

  env.http_proxy = proxy.url
  env.https_proxy = proxy.url
  env.HTTP_PROXY = proxy.url
  env.HTTPS_PROXY = proxy.url
  if (noProxy) {
    env.no_proxy = noProxy
    env.NO_PROXY = noProxy
  }
  return env
}

module.exports = {
  NO_PROXY_VALUE,
  PROXY_ENV_KEYS,
  applyProxyEnv,
  buildSessionProxyConfig,
  isSocksProxy,
  normalizeProxyUrl,
}
