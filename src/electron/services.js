const { serveNcmApi, getModulesDefinitions } = require('@neteasecloudmusicapienhanced/api')
const path = require('path')

// 主进程顶层预加载 UNM 模块，确保 ASAR 内 require 能命中缓存
let unmMatch = null
try {
  unmMatch = require('@unblockneteasemusic/server')
  console.log('[services] UNM module preloaded successfully')
} catch (e) {
  console.error('[services] Failed to preload UNM module:', e.message)
}

//启动网易云音乐API（注入自定义 /song/url/v1 模块，独立 UNM 解灰，禁用 API 内置 unblock）
module.exports = async function startNeteaseMusicApi() {

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
