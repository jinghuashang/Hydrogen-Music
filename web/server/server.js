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

async function main() {
  logger.init()
  const handlers = createHandlers({ broadcast })
  const app = express()
  app.use(
    cors({
      origin: true,
      credentials: true,
    }),
  )
  app.use(express.json({ limit: '50mb' }))

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, service: 'hydrogen-music-web-gateway' })
  })
  app.get('/api/bili-cdn', (req, res) => handlers.handleBiliCdn(req, res))
  app.get('/api/events', sseMiddleware)
  app.post('/api/invoke', express.json(), handlers.invokeRoute)
  app.post('/api/send', express.json(), handlers.sendRoute)

  app.use(
    '/ncm',
    // http-proxy-middleware v3 起挂载点由 express 剥离后直接转发剩余路径
    createProxyMiddleware({
      target: `http://127.0.0.1:${NCM_PORT}`,
      changeOrigin: true,
    }),
  )

  const webDist = path.join(__dirname, '..', 'dist')
  app.use(express.static(webDist))

  await startNcm(NCM_PORT)

  // express 5 将 listen 错误（如 EADDRINUSE）传入回调而非 throw，需显式检查
  app.listen(GATEWAY_PORT, '0.0.0.0', (err) => {
    if (err) {
      console.error('[gateway] listen failed:', err)
      process.exit(1)
    }
    console.log(`[gateway] http://0.0.0.0:${GATEWAY_PORT}`)
    console.log(`[gateway] NCM 反代路径 /ncm -> http://127.0.0.1:${NCM_PORT}`)
    console.log(`[gateway] 静态资源目录 ${webDist}`)
  })
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
