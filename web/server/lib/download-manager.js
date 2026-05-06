const axios = require('axios')
const fs = require('fs')
const path = require('path')

/**
 * 与 Electron download.js 一致：单文件顺序下载，避免并发打乱 download-next 语义。
 */
function createDownloadManager({ settingsStore, broadcast }) {
  let abortController = null
  let chain = Promise.resolve()

  function getDownloadFolder() {
    const s = settingsStore.get('settings')
    return s && s.local && s.local.downloadFolder
  }

  async function downloadOne(args) {
    let folder = getDownloadFolder()
    if (!folder) return
    folder = path.resolve(String(folder).trim())
    try {
      await fs.promises.mkdir(folder, { recursive: true })
    } catch (e) {
      console.error('[download] mkdir', folder, e.message)
      broadcast('download-next', null)
      return
    }
    const fileName = args.name.replaceAll('/', ' - ').replaceAll('\\', ' - ')
    const dest = path.join(folder, `${fileName}.${args.type}`)
    abortController = new AbortController()
    try {
      const res = await axios({
        method: 'get',
        url: args.url,
        responseType: 'stream',
        signal: abortController.signal,
        onDownloadProgress: (ev) => {
          if (!ev.total) return
          const progress = Math.round((ev.loaded / ev.total) * 100)
          broadcast('download-progress', progress)
        },
      })
      await new Promise((resolve, reject) => {
        const writer = fs.createWriteStream(dest)
        res.data.pipe(writer)
        writer.on('finish', resolve)
        writer.on('error', reject)
        res.data.on('error', reject)
      })
    } catch (e) {
      if (e.name !== 'CanceledError' && e.code !== 'ERR_CANCELED') {
        console.error('[download]', dest, e.code || e.message)
      }
    } finally {
      abortController = null
    }
  }

  return {
    onDownloadStart() {
      broadcast('download-next', null)
    },
    onDownload(args) {
      chain = chain
        .then(() => downloadOne(args))
        .then(() => {
          broadcast('download-next', null)
        })
        .catch((e) => {
          console.error('[download chain]', e)
          broadcast('download-next', null)
        })
    },
    onPause(close) {
      if (close === 'shutdown') {
        if (abortController) abortController.abort()
      }
    },
    onResume() {},
    onCancel() {
      if (abortController) abortController.abort()
    },
  }
}

module.exports = { createDownloadManager }
