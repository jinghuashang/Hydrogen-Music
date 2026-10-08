const path = require('path')
const { generateRandomChineseIP } = require('@neteasecloudmusicapienhanced/api/util/index')
const { enableRandomCnIp, patchUpstreamRequest } = require('../server/apiRiskControl')

// 风控包装必须在 require 上游 API 主入口之前完成（上游加载时会捕获 request 引用）
patchUpstreamRequest({ generateIp: generateRandomChineseIP })

const { serveNcmApi, getModulesDefinitions } = require('@neteasecloudmusicapienhanced/api')

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

  const scrobbleIdx = defaultModules.findIndex(m => m.route === '/scrobble')
  if (scrobbleIdx !== -1) {
    defaultModules[scrobbleIdx] = {
      identifier: 'scrobble',
      route: '/scrobble',
      module: require('../server/custom-scrobble'),
    }
  } else {
    defaultModules.push({
      identifier: 'scrobble',
      route: '/scrobble',
      module: require('../server/custom-scrobble'),
    })
  }

  const cloudDelIdx = defaultModules.findIndex(m => m.route === '/user/cloud/del')
  if (cloudDelIdx !== -1) {
    defaultModules[cloudDelIdx] = {
      identifier: 'user_cloud_del',
      route: '/user/cloud/del',
      module: require('../server/custom-cloud-del'),
    }
  } else {
    defaultModules.push({
      identifier: 'user_cloud_del',
      route: '/user/cloud/del',
      module: require('../server/custom-cloud-del'),
    })
  }

  const cloudIdx = defaultModules.findIndex(m => m.route === '/cloud')
  if (cloudIdx !== -1) {
    defaultModules[cloudIdx] = {
      identifier: 'cloud',
      route: '/cloud',
      module: require('../server/custom-cloud-upload'),
    }
  } else {
    defaultModules.push({
      identifier: 'cloud',
      route: '/cloud',
      module: require('../server/custom-cloud-upload'),
    })
  }

  // 风控缓解：上游请求改用随机中国大陆 IP（不走 app.js 入口，需自行初始化 global.cnIp）
  enableRandomCnIp({ generateIp: generateRandomChineseIP })

  await serveNcmApi({
    checkVersion: true,
    port: 36530,
    moduleDefs: defaultModules,
  })
}
