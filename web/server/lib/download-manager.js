const axios = require('axios')
const fs = require('fs')
const path = require('path')
const http = require('http')
const { File, Picture, PictureType, ByteVector } = require('node-taglib-sharp')

function fetchBuffer(url) {
  return new Promise((resolve, reject) => {
    axios.get(url, { responseType: 'arraybuffer' })
      .then(res => resolve(Buffer.from(res.data)))
      .catch(reject)
  })
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
