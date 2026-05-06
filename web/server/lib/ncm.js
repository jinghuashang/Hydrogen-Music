const { serveNcmApi } = require('NeteaseCloudMusicApi')
const generateConfig = require('NeteaseCloudMusicApi/generateConfig')

let started = false

async function startNcm(port = 36530) {
  if (started) return
  await generateConfig()
  await serveNcmApi({
    checkVersion: true,
    port,
  })
  started = true
  console.log(`[NCM API] listening on ${port}`)
}

module.exports = { startNcm }
