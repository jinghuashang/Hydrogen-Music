const axios = require('axios')
const fs = require('fs')
const path = require('path')
const { URL } = require('url')
const { parseFile } = require('music-metadata')
const { CancelToken } = axios
const { createStore } = require('./store')
const { defaultSettings } = require('./defaults')
const { createDownloadManager } = require('./download-manager')
const { createLocalScan } = require('./local-scan')

const pkg = require('../../../package.json')

function fileExists(p) {
  return new Promise((resolve) => {
    fs.access(p, fs.constants.F_OK, (err) => resolve(!err))
  })
}

function isAllowedBilibiliMediaUrl(urlStr) {
  let u
  try {
    u = new URL(urlStr)
  } catch {
    return false
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return false
  const h = u.hostname.toLowerCase()
  return (
    h.endsWith('.bilivideo.com') ||
    h.endsWith('.bilibili.com') ||
    h.endsWith('.hdslb.com') ||
    h.includes('akamaized.net')
  )
}

const BILI_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

/** 从 B 站 CDN 直链查询串解析 Unix 过期秒；无则返回 null */
function parseStreamUrlExpirySeconds(urlStr) {
  try {
    const u = new URL(urlStr)
    for (const key of ['expires', 'expire']) {
      const v = u.searchParams.get(key)
      if (v && /^\d+$/.test(v)) {
        const n = Number(v)
        return n > 1e12 ? Math.floor(n / 1000) : n
      }
    }
    const dl = u.searchParams.get('deadline')
    if (dl && /^\d+$/.test(dl)) {
      const n = Number(dl)
      return n > 1e12 ? Math.floor(n / 1000) : n
    }
  } catch {
    /* ignore */
  }
  return null
}

/** 与 MusicVideo.vue 中 urlIndex 计算方式一致，从 playurl JSON 取 dash 视频轨 baseUrl */
function pickDashVideoBaseUrl(playData, qn) {
  const dash = playData?.data?.dash
  if (!dash?.video?.length) return null
  const ad = playData?.data?.accept_description
  const Q = Array.isArray(ad) ? ad.length : 0
  const V = dash.video.length
  const q = typeof qn === 'number' && !Number.isNaN(qn) ? qn : 0
  let urlIndex = q - (Q - V / 2)
  if (urlIndex < 0) urlIndex = 0
  urlIndex = Math.min(Math.floor(urlIndex), V - 1)
  const item = dash.video[urlIndex]
  return item?.baseUrl || item?.base_url || null
}

function createHandlers({ broadcast }) {
  const settingsStore = createStore('settings')
  const lastPlaylistStore = createStore('lastPlaylist')
  const musicVideoStore = createStore('musicVideo')
  const webProfileStore = createStore('webProfile')

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

  function biliCookieHeaderFromStore() {
    return Object.entries(biliCookies)
      .map(([k, v]) => `${k}=${v}`)
      .join('; ')
  }

  function mergeBiliCookieForStream(clientBiliCookie) {
    return [biliCookieHeaderFromStore(), (clientBiliCookie || '').trim()].filter(Boolean).join('; ')
  }

  async function probeBiliStreamAlive(urlStr, mergedCookie) {
    const headers = {
      Referer: 'https://www.bilibili.com/',
      'User-Agent': BILI_UA,
    }
    if (mergedCookie) headers.Cookie = mergedCookie
    try {
      const head = await axios({
        method: 'HEAD',
        url: urlStr,
        headers,
        timeout: 12000,
        validateStatus: () => true,
        maxRedirects: 5,
      })
      if (head.status === 200 || head.status === 206) return true
      if (head.status === 405) {
        const getPart = await axios({
          method: 'GET',
          url: urlStr,
          headers: { ...headers, Range: 'bytes=0-0' },
          timeout: 12000,
          validateStatus: () => true,
          maxRedirects: 5,
        })
        return getPart.status === 200 || getPart.status === 206
      }
      return false
    } catch (e) {
      console.warn('[music-video] probe stream', e.message)
      return false
    }
  }

  async function refreshWebMusicVideoStreamBaseUrl(record, clientBiliCookie) {
    const { bv, cid, qn } = record
    if (!bv || !cid) return null
    const merged = mergeBiliCookieForStream(clientBiliCookie)
    const headers = {
      Referer: 'https://www.bilibili.com/',
      'User-Agent': BILI_UA,
    }
    if (merged) headers.Cookie = merged
    const res = await axios.get('https://api.bilibili.com/x/player/playurl', {
      headers,
      params: { bvid: bv, cid, fnval: 80, fourk: 1 },
      timeout: 20000,
      validateStatus: () => true,
    })
    if (res.status !== 200 || res.data?.code !== 0) {
      console.error('[music-video] refresh playurl', res.data?.code, res.data?.message)
      return null
    }
    return pickDashVideoBaseUrl(res.data, qn)
  }

  /**
   * Web 直链：根据 URL 中 expires/deadline 或 HEAD 探测判定失效后，
   * 重新请求 playurl 并 saveMusicVideo 更新 streamBaseUrl。
   */
  async function ensureWebStreamUrlFresh(record, clientBiliCookie) {
    const url = record.streamBaseUrl
    if (!url || typeof url !== 'string') return record
    if (record.path) return record
    const merged = mergeBiliCookieForStream(clientBiliCookie)
    const skew = 120
    const now = Math.floor(Date.now() / 1000)
    const exp = parseStreamUrlExpirySeconds(url)
    let needRefresh = false
    if (exp != null) {
      needRefresh = now >= exp - skew
    } else {
      needRefresh = !(await probeBiliStreamAlive(url, merged))
    }
    if (!needRefresh) return record
    const nextUrl = await refreshWebMusicVideoStreamBaseUrl(record, clientBiliCookie)
    if (!nextUrl) {
      console.warn('[music-video] keep stale streamBaseUrl after refresh failure')
      return record
    }
    if (nextUrl === url) return record
    const next = { ...record, streamBaseUrl: nextUrl }
    await saveMusicVideo(next)
    return next
  }

  async function getSettings() {
    let settings = settingsStore.get('settings')
    if (!settings) {
      settings = defaultSettings()
      settingsStore.set('settings', settings)
    }
    if (!settings.local) settings.local = { ...defaultSettings().local }
    if (!Object.prototype.hasOwnProperty.call(settings.local, 'syncProfileToNas')) settings.local.syncProfileToNas = false
    if (!Object.prototype.hasOwnProperty.call(settings.local, 'downloadCover')) settings.local.downloadCover = false
    if (!Object.prototype.hasOwnProperty.call(settings.local, 'downloadInfo')) settings.local.downloadInfo = false
    if (!Object.prototype.hasOwnProperty.call(settings.local, 'downloadLyric')) settings.local.downloadLyric = false
    if (!settings.other) settings.other = { ...defaultSettings().other }
    if (!Object.prototype.hasOwnProperty.call(settings.other, 'webHomeSidePlayer')) settings.other.webHomeSidePlayer = false
    return settings
  }

  const invokeHandlers = {
    'get-app-version': async () => {
      try {
        const res = await fetch('https://api.github.com/repos/jinghuashang/Hydrogen-Music/releases/latest')
        if (!res.ok) return pkg.version
        const data = await res.json()
        return (data.tag_name || '').replace(/^v/, '') || pkg.version
      } catch {
        return pkg.version
      }
    },
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
      message:
        '请输入目录的绝对路径（Linux/macOS 如 /home/用户名/Music；NAS 如 /volume1/music；Windows 如 D:\\\\Music）',
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
      const params = request?.option?.params || {}
      /** Web：不落盘，仅保存 B 站视频轨直链供 /api/bili-cdn 代理播放 */
      if (params.webStreamOnly && params.streamBaseUrl) {
        try {
          const timing = JSON.parse(params.timing || 'null')
          if (!timing) return 'failed'
          await saveMusicVideo({
            id: params.id,
            bv: params.bv,
            cid: params.cid,
            quality: params.quality,
            qn: params.qn,
            timing,
            path: '',
            streamBaseUrl: String(params.streamBaseUrl).trim(),
          })
          return 'success'
        } catch (e) {
          console.error('[get-bili-video] webStreamOnly', e.message)
          return 'failed'
        }
      }
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
        if (result.data.streamBaseUrl) {
          if (!result.data.path && obj.method === 'verify') {
            const nextData = await ensureWebStreamUrlFresh(result.data, obj.clientBiliCookie)
            return { data: nextData, index: result.index }
          }
          return result
        }
        if (!result.data.path) return '404'
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
        if (
          !musicVideo.some(
            (video) => video.path && path.normalize(video.path) === path.normalize(filePath),
          )
        ) {
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
    'get-web-profile': async () => {
      return webProfileStore.get('profile') || null
    },
    'set-web-profile': async (_e, profile) => {
      webProfileStore.set('profile', profile)
      return true
    },
    'clear-web-profile': async () => {
      webProfileStore.delete('profile')
      return true
    },
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
      case 'set-settings': {
        const next = typeof payload === 'string' ? JSON.parse(payload) : payload
        const prev = settingsStore.get('settings')
        settingsStore.set('settings', next)
        if (prev?.local?.syncProfileToNas && !next?.local?.syncProfileToNas) {
          webProfileStore.delete('profile')
        }
        break
      }
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

  const biliCookieHeader = biliCookieHeaderFromStore

  /** GET /api/bili-cdn?u=<encodeURIComponent(bilibiliUrl)> */
  async function handleBiliCdn(req, res) {
    try {
      const raw = req.query.u
      if (!raw || typeof raw !== 'string') {
        res.status(400).end('missing u')
        return
      }
      const targetUrl = decodeURIComponent(raw)
      if (!isAllowedBilibiliMediaUrl(targetUrl)) {
        res.status(403).end('host not allowed')
        return
      }
      const serverC = biliCookieHeader()
      const clientC = req.headers.cookie || ''
      const cookie = [serverC, clientC].filter(Boolean).join('; ')
      const upstreamHeaders = {
        Referer: 'https://www.bilibili.com/',
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      }
      if (req.headers.range) upstreamHeaders.Range = req.headers.range
      if (cookie) upstreamHeaders.Cookie = cookie

      const upstream = await axios({
        method: 'GET',
        url: targetUrl,
        headers: upstreamHeaders,
        responseType: 'stream',
        validateStatus: () => true,
        maxRedirects: 5,
      })

      const hop = ['content-type', 'content-length', 'content-range', 'accept-ranges', 'cache-control']
      hop.forEach((h) => {
        const v = upstream.headers[h]
        if (v) res.setHeader(h, v)
      })
      res.status(upstream.status)
      upstream.data.pipe(res)
      upstream.data.on('error', (err) => {
        console.error('[bili-cdn] stream', err.message)
        if (!res.writableEnded) res.destroy()
      })
    } catch (e) {
      console.error('[bili-cdn]', e.message)
      if (!res.headersSent) res.status(502).end()
    }
  }

  return {
    invokeRoute,
    sendRoute,
    settingsStore,
    handleBiliCdn,
  }
}

module.exports = { createHandlers }
