const axios = require('axios')
const fs = require('fs')
const path = require('path')
const { parseFile } = require('music-metadata')
const { CancelToken } = axios
const { createStore } = require('./store')
const { defaultSettings } = require('./defaults')
const { createDownloadManager } = require('./download-manager')
const { createLocalScan } = require('./local-scan')
const {
  startUnblockNeteaseMusic,
  stopUnblockNeteaseMusic,
  restartUnblockNeteaseMusic,
  getUnblockStatus,
  getUnblockDiagnostic,
} = require('./unblock')

const pkg = require('../../../package.json')

function fileExists(p) {
  return new Promise((resolve) => {
    fs.access(p, fs.constants.F_OK, (err) => resolve(!err))
  })
}

function createHandlers({ broadcast }) {
  const settingsStore = createStore('settings')
  const lastPlaylistStore = createStore('lastPlaylist')
  const musicVideoStore = createStore('musicVideo')

  const downloadManager = createDownloadManager({ settingsStore, broadcast })
  const localScan = createLocalScan({ settingsStore, broadcast })

  const biliCookies = {}
  let biliVideoCancel = null

  async function searchMusicVideo(id) {
    if (!musicVideoStore.has('musicVideo')) return false
    const result = musicVideoStore.get('musicVideo')
    const index = (result || []).findIndex((music) => music.id == id)
    if (index !== -1) return { data: result[index], index }
    return false
  }

  async function saveMusicVideo(data) {
    let musicVideo = musicVideoStore.get('musicVideo')
    if (musicVideo && Array.isArray(musicVideo)) {
      const found = await searchMusicVideo(data.id)
      if (found) musicVideo.splice(found.index, 1)
      musicVideo.push(data)
      musicVideoStore.set('musicVideo', musicVideo)
    } else {
      musicVideoStore.set('musicVideo', [data])
    }
  }

  async function getSettings() {
    let settings = settingsStore.get('settings')
    if (!settings) {
      settings = defaultSettings()
      settingsStore.set('settings', settings)
    }
    return settings
  }

  const invokeHandlers = {
    'get-app-version': async () => pkg.version,
    'get-image-base64': async (_e, filePath) => {
      const data = await parseFile(filePath)
      if (data.common.picture) {
        return `data:${data.common.picture[0].format};base64,${data.common.picture[0].data.toString('base64')}`
      }
      return null
    },
    'get-settings': getSettings,
    'dialog:openFile': async () => ({
      __web: true,
      kind: 'directory',
      message: 'Web 版请在弹窗中输入 NAS 上的绝对路径',
    }),
    'get-last-playlist': async () => {
      const lastPlaylist = lastPlaylistStore.get('playlist')
      return lastPlaylist || null
    },
    'get-request-data': async (_e, request) => {
      const result = await axios.get(request.url, request.option)
      return result.data
    },
    'get-bili-request-data': async (_e, request) => {
      const option = request.option || {}
      option.headers = option.headers || {}
      const cookieStr = Object.entries(biliCookies)
        .map(([k, v]) => `${k}=${v}`)
        .join('; ')
      if (cookieStr) option.headers.Cookie = cookieStr
      const result = await axios.get(request.url, option)
      const setCookies = result.headers['set-cookie']
      if (setCookies) {
        setCookies.forEach((c) => {
          const [kv] = c.split(';')
          const [name, ...vals] = kv.split('=')
          biliCookies[name.trim()] = vals.join('=')
        })
      }
      return { data: result.data, cookies: { ...biliCookies } }
    },
    /**
     * Web 端专用：浏览器不能直接请求 B 站 API（CORS），由网关代为请求并与 biliCookies 合并。
     * 返回体与 Electron preload 中 biliFetch 一致，为接口 JSON（非 axios 包装）。
     */
    'get-bili-fetch': async (_e, request) => {
      const option = request.option || {}
      option.headers = { ...(option.headers || {}) }
      const serverCookieStr = Object.entries(biliCookies)
        .map(([k, v]) => `${k}=${v}`)
        .join('; ')
      const clientCookie = option.headers.Cookie || option.headers.cookie || ''
      delete option.headers.cookie
      if (clientCookie && serverCookieStr) {
        option.headers.Cookie = `${clientCookie}; ${serverCookieStr}`
      } else {
        option.headers.Cookie = clientCookie || serverCookieStr
      }
      const result = await axios.get(request.url, option)
      const setCookies = result.headers['set-cookie']
      if (setCookies) {
        setCookies.forEach((c) => {
          const [kv] = c.split(';')
          const [name, ...vals] = kv.split('=')
          biliCookies[name.trim()] = vals.join('=')
        })
      }
      return result.data
    },
    'get-bili-video': async (_e, request) => {
      const settings = await getSettings()
      if (!settings.local.videoFolder) return 'noSavePath'
      const folder = path.resolve(String(settings.local.videoFolder).trim())
      try {
        await fs.promises.mkdir(folder, { recursive: true })
      } catch (e) {
        console.error('[get-bili-video] mkdir', e.message)
        return 'failed'
      }
      const q = request.option.params.quality || ''
      const outPath = path.join(folder, `${request.option.params.cid}_${q.substring(3)}.mp4`)
      if (await fileExists(outPath)) {
        request.option.params.timing = JSON.parse(request.option.params.timing)
        request.option.params.path = outPath
        await saveMusicVideo(request.option.params)
        return 'success'
      }
      if (biliVideoCancel) biliVideoCancel()
      let canceled = false
      let result
      try {
        result = await axios({
          url: request.url,
          method: 'get',
          headers: request.option.headers,
          responseType: 'stream',
          onDownloadProgress: (progressEvent) => {
            if (!progressEvent.total) return
            const progress = Math.round((progressEvent.loaded / progressEvent.total) * 100)
            broadcast('download-video-progress', progress)
          },
          cancelToken: new CancelToken((c) => {
            biliVideoCancel = () => {
              canceled = true
              c()
            }
          }),
        })
      } catch (e) {
        if (e.code === 'ERR_CANCELED' || canceled) {
          try {
            if (fs.existsSync(outPath)) fs.unlinkSync(outPath)
          } catch {}
          return 'cancel'
        }
        console.error('[get-bili-video] fetch', e.message)
        try {
          if (fs.existsSync(outPath)) fs.unlinkSync(outPath)
        } catch {}
        return 'failed'
      }
      const writer = fs.createWriteStream(outPath)
      try {
        await new Promise((resolve, reject) => {
          result.data.pipe(writer)
          writer.on('finish', resolve)
          writer.on('error', reject)
          result.data.on('error', reject)
        })
      } catch (e) {
        if (canceled) {
          try {
            fs.unlinkSync(outPath)
          } catch {}
          return 'cancel'
        }
        console.error('[get-bili-video] write', e.message)
        try {
          if (fs.existsSync(outPath)) fs.unlinkSync(outPath)
        } catch {}
        return 'failed'
      }
      if (canceled) {
        try {
          fs.unlinkSync(outPath)
        } catch {}
        return 'cancel'
      }
      request.option.params.timing = JSON.parse(request.option.params.timing)
      request.option.params.path = outPath
      await saveMusicVideo(request.option.params)
      biliVideoCancel = null
      return 'success'
    },
    'music-video-isexists': async (_e, obj) => {
      const result = await searchMusicVideo(obj.id)
      if (result) {
        if (obj.method === 'get') return result
        const file = await fileExists(result.data.path)
        if (!file) return '404'
        return result
      }
      return false
    },
    'clear-unused-video': async () => {
      const settings = await getSettings()
      const folderPath = settings.local.videoFolder
      if (!folderPath) return 'noSavePath'
      const musicVideo = musicVideoStore.get('musicVideo') || []
      const files = fs.readdirSync(folderPath)
      files.forEach((filename) => {
        const filePath = path.join(folderPath, filename)
        if (!musicVideo.some((video) => video.path === filePath)) {
          try {
            fs.unlinkSync(filePath)
          } catch {}
        }
      })
      return true
    },
    'delete-music-video': async (_e, id) => {
      const musicVideo = musicVideoStore.get('musicVideo') || []
      const found = await searchMusicVideo(id)
      if (found) {
        musicVideo.splice(found.index, 1)
        musicVideoStore.set('musicVideo', musicVideo)
        return true
      }
      return false
    },
    'get-local-music-lyric': async (_e, filePath) => {
      const str = filePath.split(/[/\\]/)
      const folderPath = filePath.substring(0, filePath.length - str[str.length - 1].length - 1)
      const fileName = path.basename(filePath, path.extname(filePath))
      function readLyric(p) {
        try {
          return fs.readFileSync(p, 'utf8')
        } catch {
          return false
        }
      }
      function lyricHandle(data) {
        const lines = data.split(/\r?\n/)
        let lyricArr = ''
        lines.forEach((line) => {
          if (line) lyricArr += `${line}\n`
        })
        return lyricArr
      }
      const lrcPath = path.join(folderPath, `${fileName}.lrc`)
      const txtPath = path.join(folderPath, `${fileName}.txt`)
      if (await fileExists(lrcPath)) {
        const res = readLyric(lrcPath)
        if (res) return lyricHandle(res)
      }
      if (await fileExists(txtPath)) {
        const res = readLyric(txtPath)
        if (res) return lyricHandle(res)
      }
      const metedata = await parseFile(filePath)
      if (metedata.common.lyrics) return metedata.common.lyrics[0]
      return false
    },
    'select-file': async () => ({
      __web: true,
      kind: 'font',
      message: 'Web 版请输入字体文件在 NAS 上的绝对路径',
    }),
    'start-unblock': async () => {
      startUnblockNeteaseMusic(settingsStore)
      return getUnblockStatus()
    },
    'stop-unblock': async () => {
      stopUnblockNeteaseMusic()
      return getUnblockStatus()
    },
    'restart-unblock': async () => {
      restartUnblockNeteaseMusic(settingsStore)
      return getUnblockStatus()
    },
    'get-unblock-status': async () => getUnblockStatus(),
    'get-unblock-diag': async () => getUnblockDiagnostic(),
  }

  function dispatchSend(event, payload) {
    switch (event) {
      case 'download-start':
        downloadManager.onDownloadStart()
        break
      case 'download':
        downloadManager.onDownload(payload)
        break
      case 'download-pause':
        downloadManager.onPause(payload)
        break
      case 'download-resume':
        downloadManager.onResume()
        break
      case 'download-cancel':
        downloadManager.onCancel()
        break
      case 'set-settings':
        settingsStore.set('settings', typeof payload === 'string' ? JSON.parse(payload) : payload)
        restartUnblockNeteaseMusic(settingsStore)
        break
      case 'save-last-playlist':
        lastPlaylistStore.set('playlist', typeof payload === 'string' ? JSON.parse(payload) : payload)
        break
      case 'exit-app':
        lastPlaylistStore.set('playlist', typeof payload === 'string' ? JSON.parse(payload) : payload)
        break
      case 'scan-local-music':
        localScan.readLocalFiles(payload.type, payload.refresh)
        break
      case 'clear-local-music-data':
        localScan.clearLocalMusicData(payload)
        break
      case 'cancel-download-music-video':
        if (biliVideoCancel) biliVideoCancel()
        break
      case 'copy-txt':
      case 'set-window-title':
      case 'music-playing-check':
      case 'music-playmode-tray-change':
      case 'register-shortcuts':
      case 'unregister-shortcuts':
      case 'window-min':
      case 'window-max':
      case 'window-close':
      case 'to-register':
      case 'open-local-folder':
        break
      default:
        break
    }
  }

  async function invokeRoute(req, res) {
    try {
      const { name, args = [] } = req.body
      const fn = invokeHandlers[name]
      if (!fn) {
        res.status(404).json({ error: `unknown invoke: ${name}` })
        return
      }
      const result = await fn(null, ...args)
      res.json({ ok: true, result })
    } catch (e) {
      console.error('[invoke]', e)
      res.status(500).json({ ok: false, error: e.message })
    }
  }

  function sendRoute(req, res) {
    try {
      const { event, payload } = req.body
      dispatchSend(event, payload)
      res.json({ ok: true })
    } catch (e) {
      console.error('[send]', e)
      res.status(500).json({ ok: false, error: e.message })
    }
  }

  function bootstrapUnblock() {
    startUnblockNeteaseMusic(settingsStore)
  }

  return {
    invokeRoute,
    sendRoute,
    bootstrapUnblock,
    settingsStore,
  }
}

module.exports = { createHandlers }
