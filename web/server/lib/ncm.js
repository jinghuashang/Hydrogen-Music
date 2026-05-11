const { serveNcmApi } = require('@neteasecloudmusicapienhanced/api')

let started = false

async function startNcm(port = 36530) {
  if (started) return
  process.env.ENABLE_GENERAL_UNBLOCK = 'true'
  process.env.FOLLOW_SOURCE_ORDER = 'true'
  process.env.UNBLOCK_SOURCES = process.env.UNBLOCK_SOURCES || 'bodian,kuwo,kugou,qq,migu,bilibili'
  await serveNcmApi({
    checkVersion: true,
    port,
  })
  started = true
  console.log(`[NCM API] listening on ${port}`)
}

module.exports = { startNcm }
