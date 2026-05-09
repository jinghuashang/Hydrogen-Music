const { serveNcmApi } = require('@neteasecloudmusicapienhanced/api')

let started = false

async function startNcm(port = 36530) {
  if (started) return
  process.env.ENABLE_GENERAL_UNBLOCK = 'false'
  await serveNcmApi({
    checkVersion: true,
    port,
  })
  started = true
  console.log(`[NCM API] listening on ${port}`)
}

module.exports = { startNcm }
