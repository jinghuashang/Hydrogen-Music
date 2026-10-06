import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { applyNodeProxyAgents } from '../src/server/proxyAgents.js'

// 转发用的普通 agent：显式绕过被替换的全局代理 agent
const directAgent = new http.Agent({ keepAlive: false })

function listen(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler)
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }))
  })
}

function coreHttpGet(url, options = {}) {
  return new Promise((resolve) => {
    const req = http.request(url, { method: 'GET', timeout: 4000, ...options }, (res) => {
      res.resume()
      res.on('end', () => resolve({ status: res.statusCode }))
    })
    req.on('timeout', () => { req.destroy(new Error('timeout')) })
    req.on('error', (error) => resolve({ error: error.code || error.message }))
    req.end()
  })
}

test('routes node core http requests through the configured proxy only', async () => {
  const seen = []
  const origin = await listen((req, res) => {
    res.writeHead(200, { 'content-type': 'audio/mpeg' })
    res.end('audio')
  })
  const proxy = await listen((req, res) => {
    seen.push(req.url)
    const target = new URL(req.url)
    // 转发请求必须绕过（已被替换成代理的）全局 agent，否则会转发给自己
    const upstream = http.request(
      { hostname: target.hostname, port: target.port, path: target.pathname, method: req.method, headers: { host: target.host }, agent: directAgent },
      (up) => {
        res.writeHead(up.statusCode, up.headers)
        up.pipe(res)
      },
    )
    upstream.on('error', () => {
      res.writeHead(502)
      res.end()
    })
    req.pipe(upstream)
  })
  const originUrl = `http://127.0.0.1:${origin.port}/cover.jpg`
  try {
    // 直连：不经过代理
    applyNodeProxyAgents('')
    assert.equal(http.globalAgent.constructor.name, 'Agent')
    const directResult = await coreHttpGet(originUrl)
    assert.deepEqual(directResult, { status: 200 })
    assert.equal(seen.length, 0)

    // 配置了代理：核心 http 也走代理
    const applied = applyNodeProxyAgents(`http://127.0.0.1:${proxy.port}`)
    assert.equal(applied.applied, true)
    assert.match(http.globalAgent.constructor.name, /HttpProxyAgent$/)
    const proxiedResult = await coreHttpGet(originUrl)
    assert.deepEqual(proxiedResult, { status: 200 })
    assert.equal(seen.length, 1)
    assert.match(seen[0], /^http:\/\/127\.0\.0\.1:\d+\/cover\.jpg$/)

    // socks 无法作用于核心 http：回退直连
    assert.equal(applyNodeProxyAgents('socks5://127.0.0.1:1080').applied, false)
    assert.equal(http.globalAgent.constructor.name, 'Agent')

    // agent:false（Node 会 new globalAgent.constructor()）必须仍然可用，且同样走代理
    applyNodeProxyAgents(`http://127.0.0.1:${proxy.port}`)
    const noPoolResult = await coreHttpGet(originUrl, { agent: false })
    assert.deepEqual(noPoolResult, { status: 200 })
    assert.equal(seen.length, 2)
  } finally {
    applyNodeProxyAgents('')
    origin.server.closeAllConnections?.()
    proxy.server.closeAllConnections?.()
    origin.server.close()
    proxy.server.close()
  }
})
