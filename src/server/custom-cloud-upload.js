// 自定义云盘上传模块 — 修复 Token 分配与资源发布链路（支持大文件分片上传）
const fs = require('fs')
const crypto = require('crypto')
const axios = require('axios')
const createOption = require('@neteasecloudmusicapienhanced/api/util/option')
const { cookieToJson } = require('@neteasecloudmusicapienhanced/api/util/index')
const {
  isTempFile,
  getFileSize,
  getFileMd5,
  cleanupTempFile,
  getFileExtension,
  sanitizeFilename,
  getUploadData,
} = require('@neteasecloudmusicapienhanced/api/util/fileHelper')

let mm = null

module.exports = async (query, request) => {
  if (!mm) {
    try {
      // music-metadata 8+ 为 ESM-only，动态导入
      mm = await import('music-metadata')
    } catch (_) {}
  }

  if (!query.songFile) {
    return {
      status: 400,
      body: { msg: '请上传音频文件', code: 400 },
    }
  }

  // 恢复 express-fileupload 解析的中文文件名
  let safeName = query.songFile.name || 'unknown.mp3'
  try {
    const fixed = Buffer.from(safeName, 'binary').toString('utf-8')
    if (fixed && !fixed.includes('\ufffd') && fixed.length > 0) {
      safeName = fixed
    }
  } catch (_) {}
  query.songFile.name = safeName

  const ext = getFileExtension(query.songFile.name) || 'mp3'
  const filename = sanitizeFilename(query.songFile.name)
  const bucket = 'jd-musicrep-privatecloud-audio-public'

  const useTemp = isTempFile(query.songFile)
  const fileSize = await getFileSize(query.songFile)
  const fileMd5 = await getFileMd5(query.songFile)

  query.songFile.md5 = fileMd5
  query.songFile.size = fileSize

  // 注入标准认证和设备信息
  let rawCookie = query.cookie || ''
  let cookieObj = typeof rawCookie === 'string' ? cookieToJson(rawCookie) : { ...rawCookie }
  cookieObj = {
    ...cookieObj,
    os: 'osx',
    appver: '3.1.10.5100',
    osver: '15.5',
    channel: 'netease',
  }

  const option = createOption({ ...query, cookie: cookieObj }, 'weapi')

  try {
    // 1. 检查云盘中是否已存在或需要直传
    const checkRes = await request(
      '/api/cloud/upload/check',
      {
        bitrate: '999000',
        ext: '',
        length: fileSize,
        md5: fileMd5,
        songId: '0',
        version: 1,
      },
      option,
    )

    const checkBody = checkRes?.body || {}
    const songId = checkBody.songId || '0'
    const needUpload = checkBody.needUpload !== false

    // 2. 解析音频元数据 (歌曲名、歌手、专辑)
    let artist = ''
    let album = ''
    let songName = ''
    let audioBitrate = 999
    if (mm) {
      try {
        let metadata
        if (useTemp && query.songFile.tempFilePath) {
          metadata = await mm.parseFile(query.songFile.tempFilePath)
        } else if (query.songFile.data) {
          metadata = await mm.parseBuffer(query.songFile.data, query.songFile.mimetype || 'audio/mpeg')
        }
        const info = metadata?.common
        if (info) {
          if (info.title) songName = info.title
          if (info.album) album = info.album
          if (info.artist) artist = info.artist
        }
        if (metadata?.format?.bitrate) {
          audioBitrate = Math.round(metadata.format.bitrate / 1000) || 999
        }
      } catch (err) {
        console.warn('[custom-cloud-upload] 元数据解析跳过:', err?.message)
      }
    }

    if (!songName) songName = filename.replace(/\.[^/.]+$/, '')

    // 3. 分配专用 Bucket 的 NOS 令牌
    const tokenRes = await request(
      '/api/nos/token/alloc',
      {
        bucket,
        ext,
        filename,
        local: false,
        nos_product: 3,
        type: 'audio',
        md5: fileMd5,
      },
      option,
    )

    const tokenResult = tokenRes?.body?.result || {}
    const token = tokenResult.token
    const objectKey = tokenResult.objectKey
    const resourceId = tokenResult.resourceId

    if (!token || !objectKey) {
      throw new Error(tokenRes?.body?.msg || '获取云存储上传令牌失败')
    }

    // 4. NOS 直传执行函数 (支持大文件分片上传，彻底避免 413 限制)
    const doNosUpload = async () => {
      let lbsUrl = 'https://wanproxy.127.net/lbs?version=1.0&bucketname=' + bucket
      let lbs
      try {
        lbs = (await axios.get(lbsUrl, { timeout: 10000 })).data
      } catch (e) {
        lbs = { upload: ['https://nosup-hz1.127.net'] }
      }

      const uploadHost = lbs?.upload?.[0] || 'https://nosup-hz1.127.net'
      const encodedKey = objectKey.replace(/\//g, '%2F')

      // 单次分片大小设为 32MB（避免超过 NOS 单请求体限制）
      const CHUNK_SIZE = 32 * 1024 * 1024

      if (fileSize <= CHUNK_SIZE && !useTemp) {
        // 小于 32MB 且在内存中的文件直接单次传输
        const targetUrl = `${uploadHost}/${bucket}/${encodedKey}?offset=0&complete=true&version=1.0`
        const uploadData = getUploadData(query.songFile)
        await axios({
          method: 'POST',
          url: targetUrl,
          headers: {
            'x-nos-token': token,
            'Content-MD5': fileMd5,
            'Content-Type': query.songFile.mimetype || 'audio/mpeg',
            'Content-Length': String(fileSize),
          },
          data: uploadData,
          maxContentLength: Infinity,
          maxBodyLength: Infinity,
          timeout: 300000,
        })
      } else {
        // 大文件分片流式上传
        let offset = 0
        let context = ''
        let fd = null
        try {
          if (useTemp && query.songFile.tempFilePath) {
            fd = await fs.promises.open(query.songFile.tempFilePath, 'r')
          }

          while (offset < fileSize) {
            const currentChunkSize = Math.min(CHUNK_SIZE, fileSize - offset)
            let chunkBuffer
            if (fd) {
              chunkBuffer = Buffer.alloc(currentChunkSize)
              await fd.read(chunkBuffer, 0, currentChunkSize, offset)
            } else {
              chunkBuffer = query.songFile.data.subarray(offset, offset + currentChunkSize)
            }
            const chunkMd5 = crypto.createHash('md5').update(chunkBuffer).digest('hex')
            const isComplete = (offset + currentChunkSize >= fileSize)

            let chunkUrl = `${uploadHost}/${bucket}/${encodedKey}?offset=${offset}&complete=${isComplete ? 'true' : 'false'}&version=1.0`
            if (context) {
              chunkUrl += `&context=${context}`
            }

            const chunkRes = await axios({
              method: 'POST',
              url: chunkUrl,
              headers: {
                'x-nos-token': token,
                'Content-MD5': chunkMd5,
                'Content-Type': query.songFile.mimetype || 'audio/mpeg',
                'Content-Length': String(currentChunkSize),
              },
              data: chunkBuffer,
              maxContentLength: Infinity,
              maxBodyLength: Infinity,
              timeout: 300000,
            })

            context = chunkRes.data?.context || context
            offset += currentChunkSize
          }
        } finally {
          if (fd) await fd.close().catch(() => {})
        }
      }
    }

    if (needUpload) {
      await doNosUpload()
    }

    // 5. 提交云盘信息 (关联正确的 resourceId)
    let infoRes
    try {
      infoRes = await request(
        '/api/upload/cloud/info/v2',
        {
          md5: fileMd5,
          songid: songId,
          filename: query.songFile.name,
          song: songName,
          album: album || '未知专辑',
          artist: artist || '未知艺术家',
          bitrate: String(audioBitrate),
          resourceId: String(resourceId || ''),
        },
        option,
      )
    } catch (err) {
      // 秒传失效重传兜底
      if (!needUpload) {
        await doNosUpload()
        infoRes = await request(
          '/api/upload/cloud/info/v2',
          {
            md5: fileMd5,
            songid: songId,
            filename: query.songFile.name,
            song: songName,
            album: album || '未知专辑',
            artist: artist || '未知艺术家',
            bitrate: String(audioBitrate),
            resourceId: String(resourceId || ''),
          },
          option,
        )
      } else {
        throw err
      }
    }

    // 若秒传返回的 fileSize 为 0，表明底层对象缺失，强制执行真实分片直传
    if (!needUpload && infoRes?.body?.privateCloud?.fileSize === 0) {
      await doNosUpload()
      infoRes = await request(
        '/api/upload/cloud/info/v2',
        {
          md5: fileMd5,
          songid: songId,
          filename: query.songFile.name,
          song: songName,
          album: album || '未知专辑',
          artist: artist || '未知艺术家',
          bitrate: String(audioBitrate),
          resourceId: String(resourceId || ''),
        },
        option,
      )
    }

    const infoBody = infoRes?.body || {}
    const finalSongId = infoBody.songId || infoBody.songid || songId

    // 6. 发布云盘资源完成入库
    let pubBody = {}
    try {
      const pubRes = await request(
        '/api/cloud/pub/v2',
        {
          songid: String(finalSongId),
        },
        option,
      )
      pubBody = pubRes?.body || {}
    } catch (e) {
      // pub/v2 静默降级
    }

    const privateCloudData = (pubBody?.privateCloud && typeof pubBody.privateCloud === 'object')
      ? pubBody.privateCloud
      : (infoBody?.privateCloud || infoBody)

    return {
      status: 200,
      body: {
        code: 200,
        data: privateCloudData,
        songId: finalSongId,
        message: '上传成功',
      },
    }
  } finally {
    if (useTemp && query.songFile?.tempFilePath) {
      await cleanupTempFile(query.songFile.tempFilePath).catch(() => {})
    }
  }
}
