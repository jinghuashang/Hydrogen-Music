// 自定义 /song/url/v1 模块 — 客户端附带元数据 + UNM 全量音源匹配
const createOption = require('@neteasecloudmusicapienhanced/api/util/option')

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

  // 优先：客户端提供歌曲元数据 → 直连 UNM 匹配（绕过网易云 name:null）
  if (query.unblock_name) {
    try {
      const unmMatch = require('@unblockneteasemusic/server')
      const songData = {
        id: Number(query.id),
        name: query.unblock_name,
        artists: (query.unblock_artist || query.unblock_name)
          .split('/')
          .map((name, i) => ({ id: i, name: name.trim() })),
        album: { id: 0, name: query.unblock_album || '' },
        duration: Number(query.unblock_duration) || 0,
      }
      const resp = await unmMatch(query.id, ['bodian', 'kuwo', 'kugou', 'qq', 'migu', 'bilibili'], songData)
      if (resp && resp.url) {
        unblockUrl = resp.url
        unblockSource = resp.source || 'unm'
      }
    } catch (_) {}
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
    } catch (_) {}
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
        msg: `Unblock matched via ${unblockSource}`,
        data: [{ id: Number(query.id), url: unblockUrl, type: 'flac', level: query.level, freeTrialInfo: 'null', fee: 0, proxyUrl: proxyUrl || '' }],
      },
      cookie: [],
    }
  }

  // 解灰未成功 — 回退正常网易云 API
  if (data.level === 'sky') data.immerseType = 'c51'
  return request('/api/song/enhance/player/url/v1', data, createOption(query))
}
