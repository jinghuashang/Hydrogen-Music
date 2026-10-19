/* eslint-disable no-console */
const express = require('express')
const cors = require('cors')
const { createProxyMiddleware } = require('http-proxy-middleware')
const path = require('path')
const { sseMiddleware, broadcast } = require('./lib/sse')
const { createHandlers } = require('./lib/handlers')
const { startNcm } = require('./lib/ncm')
const logger = require('./lib/logger')

const GATEWAY_PORT = Number(process.env.GATEWAY_PORT || 37890)
const NCM_PORT = Number(process.env.NCM_PORT || 36530)
// 默认只监听回环；局域网/反代部署需显式设置 GATEWAY_HOST=0.0.0.0（并配合前置认证）
const GATEWAY_HOST = process.env.GATEWAY_HOST || '127.0.0.1'

// 允许的跨域来源：同源部署不需要；如需独立前端域名用 CORS_ALLOW_ORIGIN 显式配置
const ALLOWED_ORIGINS = (process.env.CORS_ALLOW_ORIGIN || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)

// 阻止借查询参数改写上游出站目标（SSRF）：/ncm 与 get-request-data 都必须经过
const { stripControlParams } = require('./lib/security')

// 递归删除原型相关键与控制参数，避免上游 Object.assign 合并 body 时污染原型或改写出站目标
const BODY_CONTROL_KEYS = ['domain', 'proxy', 'headers', 'eapiConfig', 'x-api-key', 'realIP', 'randomCNIP']
function scrubProto(value, depth = 0) {
  if (!value || typeof value !== 'object' || depth > 8) return
  for (const key of Object.keys(value)) {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
      delete value[key]
      continue
    }
    if (BODY_CONTROL_KEYS.includes(key)) {
      delete value[key]
      continue
    }
    scrubProto(value[key], depth + 1)
  }
}

// 状态变更类接口的跨站防护：浏览器请求必须同源或在白名单内
function originGuard(req, res, next) {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next()
  const origin = req.headers.origin
  if (!origin) return next()
  try {
    if (new URL(origin).host === req.headers.host) return next()
  } catch {}
  if (ALLOWED_ORIGINS.includes(origin)) return next()
  res.status(403).json({ ok: false, error: 'origin not allowed' })
}

// 可选的基础认证：设置 HYDROGEN_WEB_PASSWORD 后，/api 与 /ncm 需要 Basic Auth
function basicAuth(req, res, next) {
  const password = process.env.HYDROGEN_WEB_PASSWORD
  if (!password) return next()
  const m = (req.headers.authorization || '').match(/^Basic\s+(.+)$/i)
  if (m) {
    try {
      const idx = Buffer.from(m[1], 'base64').toString('utf8').indexOf(':')
      const pass = idx >= 0 ? Buffer.from(m[1], 'base64').toString('utf8').slice(idx + 1) : ''
      if (pass === password) return next()
    } catch {}
  }
  res.setHeader('WWW-Authenticate', 'Basic realm="Hydrogen Music"')
  res.status(401).json({ ok: false, error: 'unauthorized' })
}

// 基础安全响应头
function securityHeaders(_req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('Referrer-Policy', 'no-referrer')
  res.setHeader('X-Frame-Options', 'DENY')
  next()
}

// 简单限流：每 IP 每分钟 300 次
function rateLimit(req, res, next) {
  const key = req.ip || req.socket.remoteAddress || 'unknown'
  const now = Date.now()
  const entry = rateLimit._map.get(key)
  if (!entry || now - entry.start > 60000) {
    rateLimit._map.set(key, { start: now, count: 1 })
    return next()
  }
  entry.count += 1
  if (entry.count > 300) return res.status(429).json({ ok: false, error: 'too many requests' })
  next()
}
rateLimit._map = new Map()
setInterval(() => rateLimit._map.clear(), 60000).unref?.()

async function main() {
  logger.init()
  const handlers = createHandlers({ broadcast })
  const app = express()
  app.disable('x-powered-by')
  app.use(
    cors({
      origin(origin, callback) {
        // 非浏览器请求没有 Origin；浏览器请求只放行白名单（不再反射任意来源）
        if (!origin || ALLOWED_ORIGINS.includes(origin)) return callback(null, true)
        return callback(null, false)
      },
      credentials: true,
    }),
  )
  app.use(securityHeaders)
  app.use(rateLimit)
  app.use(originGuard)

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, service: 'hydrogen-music-web-gateway' })
  })

  // 认证之后的业务接口（/api/health 保持公开供探活）
  app.use('/api', basicAuth)
  app.get('/api/bili-cdn', (req, res) => handlers.handleBiliCdn(req, res))
  app.get('/api/events', sseMiddleware)
  app.post('/api/invoke', express.json(), handlers.invokeRoute)
  app.post('/api/send', express.json(), handlers.sendRoute)

  app.use(
    '/ncm',
    basicAuth,
    // 剥离可改写上游出站目标的控制参数（domain/proxy/headers 等），防止 SSRF
    (req, _res, next) => {
      req.url = stripControlParams(req.url)
      next()
    },
    // 解析并清理 JSON / urlencoded body 中的原型污染键与控制参数（上游会 Object.assign 合并 body）
    express.json({
      limit: '2mb',
      strict: false,
      verify: (req, _res, buf) => {
        req.rawBody = buf
      },
    }),
    express.urlencoded({ extended: false, limit: '2mb' }),
    (req, _res, next) => {
      if (req.body && typeof req.body === 'object') scrubProto(req.body)
      next()
    },
    // http-proxy-middleware v3 起挂载点由 express 剥离后直接转发剩余路径
    createProxyMiddleware({
      target: `http://127.0.0.1:${NCM_PORT}`,
      changeOrigin: true,
      on: {
        proxyReq(proxyReq, req) {
          // body 已被解析过：用清理后的内容重新写入（GET 无 body，不受影响）
          if (!req.body || typeof req.body !== 'object') return
          const isUrlencoded = String(req.headers['content-type'] || '').includes('application/x-www-form-urlencoded')
          // 数组字段按重复键序列化，保持 urlencoded 语义（ids=1&ids=2）
          let body
          if (isUrlencoded) {
            const params = new URLSearchParams()
            for (const [k, v] of Object.entries(req.body)) {
              if (Array.isArray(v)) v.forEach((x) => params.append(k, String(x)))
              else params.append(k, String(v))
            }
            body = params.toString()
          } else {
            body = JSON.stringify(req.body)
          }
          // body 已解压/重写：原编码与传输头必须去掉，否则上游会按 gzip/chunked 解析失败
          proxyReq.removeHeader('content-encoding')
          proxyReq.removeHeader('transfer-encoding')
          proxyReq.setHeader('Content-Type', isUrlencoded ? 'application/x-www-form-urlencoded' : 'application/json')
          proxyReq.setHeader('Content-Length', Buffer.byteLength(body))
          proxyReq.end(body)
        },
        error(err, _req, res) {
          // HPM 内部的代理错误不经过应用错误中间件，这里统一兜底且不回显内部地址
          console.error('[gateway] proxy', err && err.message)
          if (res && !res.headersSent) res.status(502).json({ ok: false, error: 'upstream error' })
          else if (res && !res.writableEnded) res.end()
        },
      },
    }),
  )

  const webDist = path.join(__dirname, '..', 'dist')
  app.use(express.static(webDist))

  // 统一错误处理：不向客户端泄露内部细节与堆栈
  app.use((err, _req, res, _next) => {
    console.error('[gateway]', err && err.message)
    if (!res.headersSent) res.status(500).json({ ok: false, error: 'internal error' })
  })

  await startNcm(NCM_PORT)

  // express 5 将 listen 错误（如 EADDRINUSE）传入回调而非 throw，需显式检查
  app.listen(GATEWAY_PORT, GATEWAY_HOST, (err) => {
    if (err) {
      console.error('[gateway] listen failed:', err)
      process.exit(1)
    }
    console.log(`[gateway] http://${GATEWAY_HOST}:${GATEWAY_PORT}`)
    console.log(`[gateway] NCM 反代路径 /ncm -> http://127.0.0.1:${NCM_PORT}`)
    console.log(`[gateway] 静态资源目录 ${webDist}`)
  })
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
