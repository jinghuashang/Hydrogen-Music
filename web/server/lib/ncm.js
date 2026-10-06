const { serveNcmApi, getModulesDefinitions } = require('@neteasecloudmusicapienhanced/api')
const { generateRandomChineseIP } = require('@neteasecloudmusicapienhanced/api/util/index')
const path = require('path')
const { enableRandomCnIp } = require('../../../src/server/apiRiskControl')

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
    moduleDefs: defaultModules,
  })
  started = true
  console.log(`[NCM API] listening on ${port}`)
}

module.exports = { startNcm }
