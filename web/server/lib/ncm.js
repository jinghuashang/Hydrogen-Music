const path = require('path')
const { generateRandomChineseIP } = require('@neteasecloudmusicapienhanced/api/util/index')
const { enableRandomCnIp, patchUpstreamRequest, patchCookieToJson } = require('../../../src/server/apiRiskControl')

// 风控包装必须在 require 上游 API 主入口之前完成（上游加载时会捕获 request 引用）
patchUpstreamRequest({ generateIp: generateRandomChineseIP })
// 修复上游 cookieToJson 丢弃含 '=' 的凭据（MUSIC_U 等）
patchCookieToJson()

const { serveNcmApi, getModulesDefinitions } = require('@neteasecloudmusicapienhanced/api')

// UNM 统一使用最高码率；进程启动时设置一次，避免请求期改写环境变量造成并发污染
process.env.SELECT_MAX_BR = 'true'

let started = false

async function startNcm(port = 36530) {
  if (started) return

  const apiModulesDir = path.resolve(__dirname, '../../../node_modules/@neteasecloudmusicapienhanced/api/module')
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
      module: require('../../../src/server/custom-song-url-v1'),
    }
  }

  const scrobbleIdx = defaultModules.findIndex(m => m.route === '/scrobble')
  if (scrobbleIdx !== -1) {
    defaultModules[scrobbleIdx] = {
      identifier: 'scrobble',
      route: '/scrobble',
      module: require('../../../src/server/custom-scrobble'),
    }
  } else {
    defaultModules.push({
      identifier: 'scrobble',
      route: '/scrobble',
      module: require('../../../src/server/custom-scrobble'),
    })
  }

  const cloudDelIdx = defaultModules.findIndex(m => m.route === '/user/cloud/del')
  if (cloudDelIdx !== -1) {
    defaultModules[cloudDelIdx] = {
      identifier: 'user_cloud_del',
      route: '/user/cloud/del',
      module: require('../../../src/server/custom-cloud-del'),
    }
  } else {
    defaultModules.push({
      identifier: 'user_cloud_del',
      route: '/user/cloud/del',
      module: require('../../../src/server/custom-cloud-del'),
    })
  }

  const cloudIdx = defaultModules.findIndex(m => m.route === '/cloud')
  if (cloudIdx !== -1) {
    defaultModules[cloudIdx] = {
      identifier: 'cloud',
      route: '/cloud',
      module: require('../../../src/server/custom-cloud-upload'),
    }
  } else {
    defaultModules.push({
      identifier: 'cloud',
      route: '/cloud',
      module: require('../../../src/server/custom-cloud-upload'),
    })
  }

  // 风控缓解：上游请求改用随机中国大陆 IP（不走 app.js 入口，需自行初始化 global.cnIp）
  enableRandomCnIp({ generateIp: generateRandomChineseIP })

  await serveNcmApi({
    checkVersion: true,
    port,
    host: '127.0.0.1',
    moduleDefs: defaultModules,
  })
  started = true
  console.log(`[NCM API] listening on 127.0.0.1:${port}`)
}

module.exports = { startNcm }
