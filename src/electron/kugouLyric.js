// 酷狗逐字歌词（KRC）：搜索歌曲 -> 找歌词候选 -> 下载并解密
// 酷狗接口的证书链不完整，这里单独放宽证书校验（仅限主进程内这三个域名）
const https = require('https')
const zlib = require('zlib')

const KRC_KEY = Buffer.from([
    0x40, 0x47, 0x61, 0x77, 0x5e, 0x32, 0x74, 0x47, 0x51, 0x36, 0x31, 0x2d, 0xce, 0xd2, 0x6e, 0x69,
])
const TIMEOUT = 8000

function getJson(host, path) {
    return new Promise((resolve, reject) => {
        const req = https.get(
            { host, path, rejectUnauthorized: false, timeout: TIMEOUT, headers: { 'User-Agent': 'Mozilla/5.0' } },
            (res) => {
                let body = ''
                res.setEncoding('utf8')
                res.on('data', (chunk) => { body += chunk })
                res.on('end', () => {
                    try {
                        resolve(JSON.parse(body))
                    } catch (err) {
                        reject(err)
                    }
                })
            },
        )
        req.on('timeout', () => req.destroy(new Error('timeout')))
        req.on('error', reject)
    })
}

/** base64 -> 去 4 字节头 -> XOR -> zlib 解压 */
function decodeKrc(base64) {
    const raw = Buffer.from(String(base64 || ''), 'base64').subarray(4)
    for (let i = 0; i < raw.length; i += 1) {
        raw[i] ^= KRC_KEY[i % KRC_KEY.length]
    }
    return zlib.inflateSync(raw).toString('utf8')
}

const plain = (text) => String(text || '').toLowerCase().split(' ').join('')

const sameTitle = (a, b) => {
    const left = plain(a)
    const right = plain(b)
    if (!left || !right) return false
    return left === right || left.includes(right) || right.includes(left)
}

// 酷狗搜索结果的 duration 单位是秒，歌词搜索接口要求毫秒
// 先按歌名过滤，再按时长挑最接近的，避免「雨天」被匹配成同歌手的另一首歌
const pickClosest = (items, wantSeconds, title) => {
    const list = (items || []).filter((item) => item && item.hash)
    if (list.length === 0) return null
    const titled = title ? list.filter((item) => sameTitle(item.songname, title)) : list
    const pool = titled.length > 0 ? titled : list
    if (!wantSeconds) return pool[0]
    return pool
        .slice()
        .sort((a, b) => Math.abs((a.duration || 0) - wantSeconds) - Math.abs((b.duration || 0) - wantSeconds))[0]
}

/** 按标题 + 歌手 + 时长查酷狗逐字歌词，返回 KRC 原文；查不到返回 null */
async function fetchKugouKrc({ title, artist, duration } = {}) {
    if (!title) return null
    const wantSeconds = Math.round(Number(duration) || 0)
    try {
        const keyword = encodeURIComponent(`${title} ${artist || ''}`.trim())
        const search = await getJson('mobilecdn.kugou.com', `/api/v3/search/song?format=json&keyword=${keyword}&page=1&pagesize=8`)
        const song = pickClosest(search?.data?.info, wantSeconds, title)
        if (!song) return null

        const lyricSearch = await getJson(
            'krcs.kugou.com',
            `/search?ver=1&man=yes&client=mobi&keyword=${encodeURIComponent(title)}&duration=${Math.round((song.duration || wantSeconds) * 1000)}&hash=${song.hash}`,
        )
        const candidates = (lyricSearch?.candidates || []).filter((c) => c && c.id && c.accesskey)
        if (candidates.length === 0) return null
        // krctype=1 是逐字歌词，优先取；没有就退回第一条（逐行）
        const pick = candidates.find((c) => Number(c.krctype) === 1) || candidates[0]

        const download = await getJson(
            'lyrics.kugou.com',
            `/download?ver=1&client=pc&id=${encodeURIComponent(pick.id)}&accesskey=${encodeURIComponent(pick.accesskey)}&fmt=krc&charset=utf8`,
        )
        if (!download?.content) return null
        return decodeKrc(download.content)
    } catch (err) {
        console.error('[kugou-lyric] 获取失败:', err.message)
        return null
    }
}

module.exports = { fetchKugouKrc }
