const { serveNcmApi } = require('@neteasecloudmusicapienhanced/api')

//启动网易云音乐API（api-enhanced 内置解灰，由客户端 per-request 控制）
module.exports = async function startNeteaseMusicApi() {
  process.env.ENABLE_GENERAL_UNBLOCK = 'true'
  process.env.FOLLOW_SOURCE_ORDER = 'true'
  // UNM 音源优先级：bodian(酷我) > kuwo(酷我) > kugou(酷狗) > qq(QQ音乐) > migu(咪咕) > bilibili
  process.env.UNBLOCK_SOURCES = process.env.UNBLOCK_SOURCES || 'bodian,kuwo,kugou,qq,migu,bilibili'
  await serveNcmApi({
    checkVersion: true,
    port: 36530,
  })
}
