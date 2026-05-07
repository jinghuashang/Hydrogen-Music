/* eslint-disable no-console */
const express = require('express')
const cors = require('cors')
const { createProxyMiddleware } = require('http-proxy-middleware')
const path = require('path')
const { sseMiddleware, broadcast } = require('./lib/sse')
const { createHandlers } = require('./lib/handlers')
const { startNcm } = require('./lib/ncm')

const GATEWAY_PORT = Number(process.env.GATEWAY_PORT || 37890)
const NCM_PORT = Number(process.env.NCM_PORT || 36530)

async function main() {
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
    createProxyMiddleware({
      target: `http://127.0.0.1:${NCM_PORT}`,
      changeOrigin: true,
      pathRewrite: { '^/ncm': '' },
    }),
  )

  const webDist = path.join(__dirname, '..', 'dist')
  app.use(express.static(webDist))

  await startNcm(NCM_PORT)
  handlers.bootstrapUnblock()

  app.listen(GATEWAY_PORT, '0.0.0.0', () => {
    console.log(`[gateway] http://0.0.0.0:${GATEWAY_PORT}`)
    console.log(`[gateway] NCM 反代路径 /ncm -> http://127.0.0.1:${NCM_PORT}`)
    console.log(`[gateway] 静态资源目录 ${webDist}`)
  })
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
