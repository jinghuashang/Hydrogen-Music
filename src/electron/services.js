const { serveNcmApi, getModulesDefinitions } = require('@neteasecloudmusicapienhanced/api')
const path = require('path')

//启动网易云音乐API（注入自定义 /song/url/v1 模块，支持客户端元数据直连 UNM 解灰）
module.exports = async function startNeteaseMusicApi() {
  process.env.ENABLE_GENERAL_UNBLOCK = 'true'

  // 加载默认模块并替换 /song/url/v1
  const apiModulesDir = path.resolve(__dirname, '../../node_modules/@neteasecloudmusicapienhanced/api/module')
  const defaultModules = await getModulesDefinitions(apiModulesDir,
    {
      'daily_signin.js': '/daily_signin',
      'fm_trash.js': '/fm_trash',
      'personal_fm.js': '/personal_fm',
    }
  )
  const idx = defaultModules.findIndex(m => m.route === '/song/url/v1')
  if (idx !== -1) {
    defaultModules[idx] = {
      identifier: 'song_url_v1',
      route: '/song/url/v1',
      module: require('../server/custom-song-url-v1'),
    }
  }

  await serveNcmApi({
    checkVersion: true,
    port: 36530,
    moduleDefs: defaultModules,
  })
}
