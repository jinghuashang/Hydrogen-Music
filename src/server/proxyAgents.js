const http = require('http')
const https = require('https')
const { isSocksProxy, normalizeProxyUrl } = require('./proxyConfig')

// 记住默认 agent，直连时恢复
const defaultHttpAgent = http.globalAgent
const defaultHttpsAgent = https.globalAgent

function agentUrl(proxy) {
  const auth = proxy.username ? `${encodeURIComponent(proxy.username)}:${encodeURIComponent(proxy.password)}@` : ''
  return `http://${auth}${proxy.host}:${proxy.port}`
}

/**
 * Node 核心 http/https 默认不认代理（更新下载、镜像测速、封面抓取等不走 axios 的路径）。
 * 配置了应用内 http(s) 代理时挂全局代理 agent，未配置（或只配了 socks）时恢复默认直连。
 *
 * 注意：Node 在 `agent: false` 时会执行 `new globalAgent.constructor()`，
 * 因此这里用带默认值的子类，避免构造出没有代理地址的 agent 直接抛错。
 */
function applyNodeProxyAgents(raw) {
  const proxy = normalizeProxyUrl(raw)
  if (!proxy || isSocksProxy(proxy)) {
    http.globalAgent = defaultHttpAgent
    https.globalAgent = defaultHttpsAgent
    return { applied: false }
  }
  try {
    const { HttpProxyAgent } = require('http-proxy-agent')
    const { HttpsProxyAgent } = require('https-proxy-agent')
    const url = agentUrl(proxy)
    class DefaultHttpProxyAgent extends HttpProxyAgent {
      constructor(options) {
        super(options || url)
      }
    }
    class DefaultHttpsProxyAgent extends HttpsProxyAgent {
      constructor(options) {
        super(options || url)
      }
    }
    http.globalAgent = new DefaultHttpProxyAgent(url)
    https.globalAgent = new DefaultHttpsProxyAgent(url)
    return { applied: true }
  } catch (error) {
    http.globalAgent = defaultHttpAgent
    https.globalAgent = defaultHttpsAgent
    console.warn('[proxy] 缺少 http(s)-proxy-agent，核心 http 请求回退直连:', error?.message || error)
    return { applied: false }
  }
}

module.exports = { applyNodeProxyAgents }
