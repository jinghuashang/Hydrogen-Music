const { app, session } = require('electron')
const { applyProxyEnv, buildSessionProxyConfig, isSocksProxy, normalizeProxyUrl } = require('../server/proxyConfig')
const { applyNodeProxyAgents } = require('../server/proxyAgents')

let proxyCredentials = null
let socksAgentApplied = false
let appliedConfig = null

/**
 * socks 代理无法用环境变量表达，axios 需要显式 agent；依赖缺失时保持直连并提示。
 * http(s) 代理走环境变量，能覆盖 NCM API 服务内部的所有 axios 请求。
 */
function applySocksAgent(proxy) {
  const axios = require('axios')
  if (!proxy || !isSocksProxy(proxy)) {
    if (socksAgentApplied) {
      delete axios.defaults.httpAgent
      delete axios.defaults.httpsAgent
      socksAgentApplied = false
    }
    return
  }
  try {
    const { SocksProxyAgent } = require('socks-proxy-agent')
    const auth = proxy.username ? `${encodeURIComponent(proxy.username)}:${encodeURIComponent(proxy.password)}@` : ''
    const agentUrl = `${proxy.protocol}://${auth}${proxy.host}:${proxy.port}`
    axios.defaults.httpAgent = new SocksProxyAgent(agentUrl)
    axios.defaults.httpsAgent = new SocksProxyAgent(agentUrl)
    socksAgentApplied = true
  } catch (error) {
    console.warn('[proxy] socks 代理缺少 socks-proxy-agent，Node 侧回退直连:', error?.message || error)
  }
}

/**
 * 统一应用网络代理：
 * - 未在设置里配置 → 直连，忽略系统代理与环境变量代理（播放/下载/接口都不再被本地代理劫持）
 * - 已配置 → Chromium（音频流/封面/下载/页面）与主进程 Node 请求都只走这个代理
 */
async function applyNetworkProxy(settings) {
  const raw = settings?.other?.networkProxy || ''
  const proxy = normalizeProxyUrl(raw)
  if (raw && !proxy) console.warn('[proxy] 代理地址无法解析，按直连处理:', raw)

  applyProxyEnv(process.env, raw)
  applyNodeProxyAgents(raw)
  applySocksAgent(proxy)
  proxyCredentials = proxy && proxy.username ? { username: proxy.username, password: proxy.password } : null

  const config = buildSessionProxyConfig(raw)
  const serialized = JSON.stringify(config)
  if (serialized === appliedConfig) return
  appliedConfig = serialized

  try {
    await session.defaultSession.setProxy(config)
    // 代理切换后丢弃旧连接，避免已建立的直连/旧代理连接继续生效
    await session.defaultSession.closeAllConnections()
  } catch (error) {
    console.error('[proxy] 应用代理失败:', error?.message || error)
  }

  console.log(proxy ? `[proxy] 使用应用内代理 ${proxy.url}` : '[proxy] 直连（已忽略系统/环境代理）')
}

/** 代理需要账号密码时，Chromium 侧通过 login 事件提供 */
function registerProxyAuth() {
  app.on('login', (event, webContents, details, authInfo, callback) => {
    if (!authInfo?.isProxy || !proxyCredentials) return
    event.preventDefault()
    callback(proxyCredentials.username, proxyCredentials.password)
  })
}

module.exports = { applyNetworkProxy, registerProxyAuth }
