const { serveNcmApi } = require('@neteasecloudmusicapienhanced/api')

//启动网易云音乐API（api-enhanced 内置解灰，由客户端 per-request 控制）
module.exports = async function startNeteaseMusicApi() {
  process.env.ENABLE_GENERAL_UNBLOCK = 'false'
  await serveNcmApi({
    checkVersion: true,
    port: 36530,
  })
}
