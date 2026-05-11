// 自定义 /song/url/v1 模块 — 客户端附带元数据 + UNM 全量音源匹配
const createOption = require('@neteasecloudmusicapienhanced/api/util/option')
const http = require('http')
const https = require('https')

// 模块加载时预加载 UNM，避免在 ASAR Express handler 内动态 require 失败
let _unmMatch = null
try {
  _unmMatch = require('@unblockneteasemusic/server')
} catch (_) {}

// 验证 URL 是否为完整歌曲（非试听），通过 Content-Length 判断
// 30秒试听 MP3 ≈ 480KB（128kbps），完整歌曲通常 > 1MB
function verifyFullSong(url, minSize = 500 * 1024) {
  return new Promise((resolve) => {
    try {
      const mod = url.startsWith('https') ? https : http
      const req = mod.get(url, { timeout: 5000 }, (res) => {
        // 跟随重定向
        if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
          verifyFullSong(res.headers.location, minSize).then(resolve)
          return
        }
        const len = parseInt(res.headers['content-length'] || '0', 10)
        res.resume() // 消费响应
        resolve(len >= minSize)
      })
      req.on('error', () => resolve(true)) // 无法验证时默认通过
      req.on('timeout', () => { req.destroy(); resolve(true) })
    } catch {
      resolve(true)
    }
  })
}

module.exports = async (query, request) => {
  const data = {
    ids: '[' + query.id + ']',
    level: query.level,
    encodeType: 'flac',
  }

  if (query.unblock !== 'true') {
    if (data.level === 'sky') data.immerseType = 'c51'
    return request('/api/song/enhance/player/url/v1', data, createOption(query))
  }

  let unblockUrl = null
  let unblockSource = null
  let unblockIsTrial = false

  // 优先：客户端提供歌曲元数据 → UNM 全源匹配（SELECT_MAX_BR 等所有源返回，选码率最高）
  if (query.unblock_name) {
    try {
      const match = _unmMatch || require('@unblockneteasemusic/server')
      if (match) {
        const songData = {
          id: Number(query.id),
          name: query.unblock_name,
          artists: (query.unblock_artist || query.unblock_name)
            .split('/')
            .map((name, i) => ({ id: i, name: name.trim() })),
          album: { id: 0, name: query.unblock_album || '' },
          duration: Number(query.unblock_duration) || 0,
        }
        const sources = ['bodian', 'kuwo', 'kugou', 'qq', 'migu', 'bilibili']
        console.log(`[unblock] API matching: ${query.unblock_name} (id=${query.id})`)

        // SELECT_MAX_BR 让 UNM 用 Promise.allSettled 等所有源，选码率最高
        const prevMaxBr = process.env.SELECT_MAX_BR
        process.env.SELECT_MAX_BR = 'true'
        let resp
        try {
          resp = await match(query.id, sources, songData)
        } finally {
          process.env.SELECT_MAX_BR = prevMaxBr
        }

        if (resp && resp.url) {
          const isFull = await verifyFullSong(resp.url)
          unblockUrl = resp.url
          unblockSource = resp.source || 'unm'
          if (isFull) {
            console.log(`[unblock] API matched (full): ${unblockSource}`)
          } else {
            unblockIsTrial = true
            console.warn(`[unblock] API matched (trial): ${unblockSource}`)
          }
        }
      } else {
        console.error('[unblock] UNM module not available in custom-song-url-v1')
      }
    } catch (e) {
      console.error('[unblock] API UNM match error:', e.message)
    }
  }

  // 回退：matchID 遍历外部模块
  if (!unblockUrl) {
    try {
      const { matchID } = require('@neteasecloudmusicapienhanced/unblockmusic-utils')
      const result = await matchID(query.id, query.source)
      if (result.data && result.data.url) {
        unblockUrl = result.data.url
        unblockSource = result.data.source
      }
    } catch (e) {
      console.warn('[unblock] matchID fallback error:', e.message)
    }
  }

  if (unblockUrl) {
    let proxyUrl = ''
    if (unblockUrl.includes('kuwo')) {
      const useProxy = process.env.ENABLE_PROXY || 'false'
      if (useProxy === 'true' && process.env.PROXY_URL) proxyUrl = process.env.PROXY_URL + unblockUrl
      else proxyUrl = unblockUrl
    }
    return {
      status: 200,
      body: {
        code: 200,
        msg: `Unblock matched via ${unblockSource}${unblockIsTrial ? ' (trial)' : ''}`,
        data: [{
          id: Number(query.id),
          url: unblockUrl,
          type: 'flac',
          level: query.level,
          freeTrialInfo: unblockIsTrial ? { freeTrialFlag: true, start: 0, end: 30 } : 'null',
          fee: 0,
          proxyUrl: proxyUrl || '',
        }],
      },
      cookie: [],
    }
  }

  // 解灰未成功 — 回退正常网易云 API
  if (data.level === 'sky') data.immerseType = 'c51'
  return request('/api/song/enhance/player/url/v1', data, createOption(query))
}
