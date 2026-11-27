const path = require('path')
const { generateRandomChineseIP } = require('@neteasecloudmusicapienhanced/api/util/index')
const { enableRandomCnIp, patchUpstreamRequest, patchCookieToJson } = require('../server/apiRiskControl')

// 风控包装必须在 require 上游 API 主入口之前完成（上游加载时会捕获 request 引用）
patchUpstreamRequest({ generateIp: generateRandomChineseIP })
// 修复上游 cookieToJson 丢弃含 '=' 的凭据（MUSIC_U 等）
patchCookieToJson()

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

  // 一起听：替换共享列表命令模块（补 playMode），并补上上游缺失的 leave 路由
  const listenSyncIdx = defaultModules.findIndex(m => m.route === '/listentogether/sync/list/command')
  if (listenSyncIdx !== -1) {
    defaultModules[listenSyncIdx] = {
      identifier: 'listentogether_sync_list_command',
      route: '/listentogether/sync/list/command',
      module: require('../server/custom-listen-together-sync'),
    }
  } else {
    defaultModules.push({
      identifier: 'listentogether_sync_list_command',
      route: '/listentogether/sync/list/command',
      module: require('../server/custom-listen-together-sync'),
    })
  }

  if (!defaultModules.some(m => m.route === '/listentogether/leave')) {
    defaultModules.push({
      identifier: 'listentogether_leave',
      route: '/listentogether/leave',
      module: require('../server/custom-listen-together-leave'),
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

  // 端口可能被 Windows 保留（Hyper-V/WinNAT 的 excludedportrange 会覆盖 36530），
  // 先试首选端口，失败则按候选列表回退，最终端口通过 IPC 告知渲染进程
  const candidates = [Number(process.env.NCM_PORT) || 36530, 40130, 40131, 40132]
  let lastError = null
  for (const port of candidates) {
    try {
      await serveNcmApi({
        checkVersion: true,
        port,
        host: '127.0.0.1',
        moduleDefs: defaultModules,
      })
      // 主动探活：listen 回调成功不代表真的可连（端口被系统保留时会静默失败）
      const probe = await new Promise((resolve) => {
        const req = require('http').get({ host: '127.0.0.1', port, path: '/personalized/newsong', timeout: 3000 }, (res) => {
          res.resume()
          resolve(true)
        })
        req.on('error', () => resolve(false))
        req.on('timeout', () => { req.destroy(); resolve(false) })
      })
      if (!probe) {
        console.error(`[services] 端口 ${port} 监听成功但无法连接，继续尝试下一个端口`)
        continue
      }
      currentNcmPort = port
      process.env.NCM_PORT = String(port)
      if (port !== 36530) console.warn(`[services] 36530 不可用，NCM API 改用 ${port}`)
      return
    } catch (e) {
      lastError = e
      console.warn(`[services] NCM API 端口 ${port} 启动失败:`, e && e.message)
    }
  }
  throw lastError || new Error('NCM API 启动失败')
}

let currentNcmPort = Number(process.env.NCM_PORT) || 36530

function getNcmPort() {
  return currentNcmPort
}

module.exports.getNcmPort = getNcmPort
