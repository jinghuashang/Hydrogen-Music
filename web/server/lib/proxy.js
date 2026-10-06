const { applyProxyEnv } = require('../../../src/server/proxyConfig')
const { applyNodeProxyAgents } = require('../../../src/server/proxyAgents')

/**
 * 网关（Node 侧）网络策略，与桌面主进程一致：
 * 设置里没填代理 → 直连，忽略机器上的系统/环境变量代理；
 * 填了 → 网关自己的请求（NCM API、B 站、下载、抓取）只走这一个代理。
 * 注意：浏览器到网关之间的流量由浏览器自己的代理设置决定，网关无法代管。
 */
function applyGatewayProxy(raw) {
  applyProxyEnv(process.env, raw)
  applyNodeProxyAgents(raw)
}

module.exports = { applyGatewayProxy }
