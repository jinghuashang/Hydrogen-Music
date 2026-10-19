const axios = require('axios')
const fs = require('fs')
const path = require('path')
const http = require('http')
const { File, Picture, PictureType, ByteVector } = require('node-taglib-sharp')

function fetchBuffer(url) {
  return new Promise((resolve, reject) => {
    if (isPrivateTarget(url)) return reject(new Error('url not allowed'))
    axios.get(url, { responseType: 'arraybuffer' })
      .then(res => resolve(Buffer.from(res.data)))
      .catch(reject)
  })
}

/** 拒绝回环/内网目标，避免下载器被用作 SSRF */
function isPrivateTarget(urlStr) {
  try {
    const h = new URL(String(urlStr)).hostname.toLowerCase()
    if (/^\d+\.\d+\.\d+\.\d+$/.test(h)) return true
    return /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|0\.0\.0\.0)/.test(h)
      || /^\[(::1|::ffff:)/.test(h)
  } catch {
    return true
  }
}

function fetchLyric(songId) {
  return new Promise((resolve) => {
    const url = `http://localhost:36530/lyric?id=${songId}`
    http.get(url, (res) => {
      let data = ''
      res.on('data', c => data += c)
      res.on('end', () => {
        try {
          const json = JSON.parse(data)
          resolve(json?.lrc?.lyric || '')
        } catch { resolve('') }
      })
    }).on('error', () => resolve(''))
  })
}

async function embedMetadata(filePath, meta, options) {
  try {
    if (!fs.existsSync(filePath)) {
      console.error('[download] 文件不存在:', filePath)
      return false
    }

    const file = File.createFromPath(filePath)
    let changed = false

    if (options.info && meta) {
      if (meta.name) { file.tag.title = meta.name; changed = true }
      if (meta.artists) { file.tag.performers = [meta.artists]; changed = true }
      if (meta.album) { file.tag.album = meta.album; changed = true }
      console.log('[download] 歌曲信息:', meta.name, meta.artists, meta.album)
    }

    if (options.cover && meta?.picUrl) {
      try {
        console.log('[download] 下载封面:', meta.picUrl)
        const imgBuffer = await fetchBuffer(meta.picUrl)
        console.log('[download] 封面大小:', imgBuffer.length, 'bytes')
        const pic = new Picture()
        pic.data = ByteVector.fromByteArray(imgBuffer)
        pic.type = PictureType.FrontCover
        pic.mimeType = 'image/jpeg'
        pic.description = 'Cover'
        file.tag.pictures = [pic]
        changed = true
      } catch (e) {
        console.error('[download] 封面下载失败:', e.message)
      }
    }

    if (options.lyric && meta?.id) {
      try {
        console.log('[download] 获取歌词, id:', meta.id)
        const lrcText = await fetchLyric(meta.id)
        console.log('[download] 歌词长度:', lrcText.length)
        if (lrcText) {
          file.tag.lyrics = lrcText
          changed = true
        }
      } catch (e) {
        console.error('[download] 歌词获取失败:', e.message)
      }
    }

    if (changed) {
      file.save()
      console.log('[download] 元数据嵌入成功:', filePath)
    }
    file.dispose()
    return changed
  } catch (e) {
    console.error('[download] 嵌入元数据异常:', e.message, e.stack)
    return false
  }
}

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
    const fileName = path.basename(String(args.name || 'unknown').replace(/[\\/:*?"<>|]/g, ' - ')).trim() || 'unknown'
    const type = String(args.type || '').toLowerCase().replace(/^\./, '')
    // 类型白名单 + 目录收敛，防止 ../ 穿越写入任意文件
    if (!/^(mp3|flac|m4a|aac|wav|ogg|opus|ape)$/.test(type)) {
      console.error('[download] 非法文件类型:', args.type)
      broadcast('download-next', null)
      return
    }
    const dest = path.join(folder, `${fileName}.${type}`)
    if (path.dirname(path.resolve(dest)) !== folder) {
      console.error('[download] 非法目标路径:', dest)
      broadcast('download-next', null)
      return
    }
    if (!/^https?:\/\//i.test(String(args.url || '')) || isPrivateTarget(args.url)) {
      console.error('[download] 非法下载地址')
      broadcast('download-next', null)
      return
    }
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
      // 下载完成后嵌入元数据
      const options = args.options || { cover: false, info: false, lyric: false }
      const { cover, info, lyric } = options
      if (cover || info || lyric) {
        await embedMetadata(dest, args.meta, options)
      }
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
