/**
 * 浏览器端 windowApi：与 src/electron/preload.js 暴露的 API 形状一致，
 * 通过 /api/invoke、/api/send + SSE(/api/events) 对接 web/server。
 */

// 支持通过环境变量配置 API 地址（用于 Vercel 部署）
const API = import.meta.env.VITE_NCM_API_URL || '/api'

let eventSource = null
const sseListeners = new Map()

function ensureEventSource() {
  if (eventSource && eventSource.readyState !== EventSource.CLOSED) return
  eventSource = new EventSource(`${API}/events`)
  eventSource.onerror = () => {
    /* 浏览器会自动重连 */
  }
  const names = [
    'download-next',
    'download-progress',
    'local-music-files',
    'local-music-count',
    'download-video-progress',
    'check-update',
    'music-playing-control',
    'music-song-control',
    'music-playmode-control',
    'music-volume-up',
    'music-volume-down',
    'music-process-control',
    'hide-player',
    'player-save',
  ]
  names.forEach((name) => {
    eventSource.addEventListener(name, (e) => {
      let data
      try {
        data = e.data ? JSON.parse(e.data) : undefined
      } catch {
        data = e.data
      }
      ;(sseListeners.get(name) || []).forEach((cb) => {
        try {
          cb(null, data)
        } catch (err) {
          console.error('[windowApi-web]', name, err)
        }
      })
    })
  })
}

function onSse(event, callback) {
  ensureEventSource()
  if (!sseListeners.has(event)) sseListeners.set(event, [])
  sseListeners.get(event).push(callback)
}

async function invoke(name, args = []) {
  const res = await fetch(`${API}/invoke`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, args }),
  })
  const json = await res.json()
  if (!res.ok || !json.ok) throw new Error(json.error || res.statusText)
  return json.result
}

async function send(event, payload) {
  await fetch(`${API}/send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ event, payload }),
  })
}

function promptPath(title) {
  const v = window.prompt(title || '请输入目录在服务器上的绝对路径（例如 /volume1/music）')
  return v && v.trim() ? v.trim() : null
}

export function installWebWindowApi() {
  if (globalThis.__HYDROGEN_WEB_API_INSTALLED__) return
  globalThis.__HYDROGEN_WEB_API_INSTALLED__ = true

  globalThis.windowApi = {
    windowMin() {
      /* Web 无系统窗口 */
    },
    windowMax() {},
    windowClose() {},
    toRegister(url) {
      window.open(url, '_blank', 'noopener,noreferrer')
    },
    beforeQuit(callback) {
      window.addEventListener('beforeunload', () => {
        try {
          callback()
        } catch {}
      })
    },
    exitApp(playlist) {
      send('exit-app', playlist)
    },
    startDownload() {
      send('download-start')
    },
    download(url) {
      send('download', url)
    },
    downloadNext(callback) {
      onSse('download-next', callback)
    },
    downloadProgress(callback) {
      onSse('download-progress', callback)
    },
    downloadPause(close) {
      send('download-pause', close)
    },
    downloadResume() {
      send('download-resume')
    },
    downloadCancel() {
      send('download-cancel')
    },
    lyricControl(callback) {
      onSse('lyric-control', callback)
    },
    scanLocalMusic(params) {
      const body =
        typeof params === 'object' && params !== null
          ? params
          : { type: params, refresh: false }
      send('scan-local-music', body)
    },
    localMusicFiles(callback) {
      onSse('local-music-files', callback)
    },
    localMusicCount(callback) {
      onSse('local-music-count', callback)
    },
    getLocalMusicImage: (filePath) => invoke('get-image-base64', [filePath]),
    playOrPauseMusic(callback) {
      onSse('music-playing-control', callback)
    },
    playOrPauseMusicCheck(playing) {
      send('music-playing-check', playing)
    },
    lastOrNextMusic(callback) {
      onSse('music-song-control', callback)
    },
    changeMusicPlaymode(callback) {
      onSse('music-playmode-control', callback)
    },
    changeTrayMusicPlaymode(mode) {
      send('music-playmode-tray-change', mode)
    },
    volumeUp(callback) {
      onSse('music-volume-up', callback)
    },
    volumeDown(callback) {
      onSse('music-volume-down', callback)
    },
    musicProcessControl(callback) {
      onSse('music-process-control', callback)
    },
    hidePlayer(callback) {
      onSse('hide-player', callback)
    },
    setSettings(settings) {
      send('set-settings', settings)
    },
    clearLocalMusicData(type) {
      send('clear-local-music-data', type)
    },
    registerShortcuts() {
      send('register-shortcuts')
    },
    unregisterShortcuts() {
      send('unregister-shortcuts')
    },
    openLocalFolder(p) {
      /* Web 无法打开服务器文件夹；保留为 no-op 避免报错 */
      console.info('[Web] openLocalFolder 忽略:', p)
    },
    saveLastPlaylist(playlist) {
      send('save-last-playlist', playlist)
    },
    downloadVideoProgress(callback) {
      onSse('download-video-progress', callback)
    },
    cancelDownloadMusicVideo() {
      send('cancel-download-music-video')
    },
    copyTxt(txt) {
      if (navigator.clipboard?.writeText) navigator.clipboard.writeText(String(txt))
    },
    checkUpdate(callback) {
      onSse('check-update', callback)
    },
    setWindowTile(title) {
      send('set-window-title', title)
      if (typeof document !== 'undefined') document.title = title || 'Hydrogen Music'
    },
    getSettings: () => invoke('get-settings'),
    openFile: async () => {
      const r = await invoke('dialog:openFile')
      if (r && r.__web) return promptPath(r.message)
      return r
    },
    getLastPlaylist: () => invoke('get-last-playlist'),
    getRequestData: (request) => invoke('get-request-data', [request]),
    getBiliRequestData: (request) => invoke('get-bili-request-data', [request]),
    getBiliVideo: (request) => invoke('get-bili-video', [request]),
    musicVideoIsExists: (obj) => invoke('music-video-isexists', [obj]),
    clearUnusedVideo: (state) => invoke('clear-unused-video', [state]),
    deleteMusicVideo: (id) => invoke('delete-music-video', [id]),
    getLocalMusicLyric: (filePath) => invoke('get-local-music-lyric', [filePath]),
    startUnblock: () => invoke('start-unblock'),
    stopUnblock: () => invoke('stop-unblock'),
    restartUnblock: () => invoke('restart-unblock'),
    getUnblockStatus: () => invoke('get-unblock-status'),
    getUnblockDiag: () => invoke('get-unblock-diag'),
    getAppVersion: () => invoke('get-app-version'),
    selectFile: async () => {
      const r = await invoke('select-file')
      if (r && r.__web) return promptPath(r.message)
      return r
    },
    biliFetch: async (url, options = {}) => {
      const headers = {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        Referer: 'https://www.bilibili.com/',
        ...options.headers,
      }
      return invoke('get-bili-fetch', [{ url, option: { ...options, headers } }])
    },
  }

  document.documentElement.classList.add('hydrogen-web')
}
