import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { applyGatewayProxy } from '../web/server/lib/proxy.js'

// 转发用的普通 agent：显式绕过被替换的全局代理 agent
const directAgent = new http.Agent({ keepAlive: false })

function listen(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler)
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }))
  })
}

function coreHttpGet(url) {
  return new Promise((resolve) => {
    const req = http.request(url, { method: 'GET', timeout: 4000 }, (res) => {
      res.resume()
      res.on('end', () => resolve({ status: res.statusCode }))
    })
    req.on('timeout', () => req.destroy(new Error('timeout')))
    req.on('error', (error) => resolve({ error: error.code || error.message }))
    req.end()
  })
}

test('the gateway bypasses local proxies unless the setting names one', async () => {
  const seen = []
  const origin = await listen((req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end('{}')
  })
  const proxy = await listen((req, res) => {
    seen.push(req.url)
    const target = new URL(req.url)
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
  const originUrl = `http://127.0.0.1:${origin.port}/ncm/search`
  const saved = { ...process.env }
  try {
    // 机器上存在的本地/环境代理：设置里没填时必须被清掉，请求直连
    process.env.HTTP_PROXY = 'http://127.0.0.1:9'
    process.env.https_proxy = 'http://127.0.0.1:9'
    applyGatewayProxy('')
    assert.equal(process.env.HTTP_PROXY, undefined)
    assert.equal(process.env.https_proxy, undefined)
    assert.equal(process.env.NO_PROXY, undefined)
    assert.equal(http.globalAgent.constructor.name, 'Agent')
    assert.deepEqual(await coreHttpGet(originUrl), { status: 200 })
    assert.equal(seen.length, 0)

    // 设置里填了代理：环境变量与核心 http 都只走它
    applyGatewayProxy(`127.0.0.1:${proxy.port}`)
    assert.equal(process.env.HTTP_PROXY, `http://127.0.0.1:${proxy.port}`)
    assert.equal(process.env.NO_PROXY, 'localhost,127.0.0.1,::1')
    assert.match(http.globalAgent.constructor.name, /HttpProxyAgent$/)
    assert.deepEqual(await coreHttpGet(originUrl), { status: 200 })
    assert.equal(seen.length, 1)
    assert.match(seen[0], /^http:\/\/127\.0\.0\.1:\d+\/ncm\/search$/)

    // 非法值按直连处理
    applyGatewayProxy('ftp://127.0.0.1:21')
    assert.equal(process.env.HTTP_PROXY, undefined)
    assert.equal(http.globalAgent.constructor.name, 'Agent')
  } finally {
    applyGatewayProxy('')
    for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key]
    Object.assign(process.env, saved)
    origin.server.closeAllConnections?.()
    proxy.server.closeAllConnections?.()
    origin.server.close()
    proxy.server.close()
  }
})
