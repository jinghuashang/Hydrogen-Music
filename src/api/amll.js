/**
 * AMLL TTML 逐词歌词（社区共建词库，https://github.com/amll-dev/amll-ttml-db）
 * 按网易云歌曲 ID 查询，返回 TTML（`itunes:timing="Word"`），解析成
 * [{ text, start, words: [{ t, d, c }] }]，与网易云 yrc 的结构一致。
 * 词库没有的歌返回 null，由调用方回落到行级歌词。
 */

const API_BASE = 'https://api.amll.dev/v1/lyrics/get'
const CACHE_PREFIX = 'amll:lines:'
const CACHE_INDEX = 'amll:index'
const CACHE_LIMIT = 120
const FETCH_TIMEOUT = 6000

const ENTITIES = {
    '&amp;': '&',
    '&lt;': '<',
    '&gt;': '>',
    '&quot;': '"',
    '&apos;': "'",
    '&#39;': "'",
}

function decodeEntities(text) {
    return String(text || '').replace(/&(amp|lt|gt|quot|apos|#39);/g, (match) => ENTITIES[match] || match)
}

/** TTML 时间：`12.345` 或 `0:12.345` 或 `1:02:03.456` */
function toSeconds(value) {
    if (!value) return 0
    const parts = String(value).trim().split(':').map((part) => Number(part))
    if (parts.some((part) => !Number.isFinite(part))) return 0
    if (parts.length === 1) return parts[0]
    if (parts.length === 2) return parts[0] * 60 + parts[1]
    return parts[0] * 3600 + parts[1] * 60 + parts[2]
}

function stripTags(html) {
    return decodeEntities(String(html || '').replace(/<[^>]*>/g, ''))
}

/** 解析 TTML 正文：<p begin end> 内每个 <span begin end> 是一个词 */
export function parseTtml(raw) {
    if (!raw) return null
    const paragraphs = String(raw).match(/<p\b[^>]*>[\s\S]*?<\/p>/g) || []
    const lines = []
    for (const paragraph of paragraphs) {
        const pOpen = /<p\b([^>]*)>/.exec(paragraph)
        if (!pOpen) continue
        const begin = toSeconds(/begin="([^"]+)"/.exec(pOpen[1])?.[1])
        const end = toSeconds(/end="([^"]+)"/.exec(pOpen[1])?.[1])
        if (!(end > begin)) continue
        const body = paragraph.slice(pOpen[0].length, paragraph.lastIndexOf('</p>'))

        const words = []
        let leading = ''
        const spanRe = /<span\b([^>]*)>([\s\S]*?)<\/span>([^<]*)/g
        let match
        let first = true
        while ((match = spanRe.exec(body)) !== null) {
            const attrs = match[1] || ''
            const trailing = decodeEntities(match[3] || '')
            // 跳过翻译/背景人声等没有独立时间轴的 span
            if (!/begin="/.test(attrs) || /ttm:role="/.test(attrs)) continue
            const text = decodeEntities(match[2] || '')
            if (!text) continue
            const start = toSeconds(/begin="([^"]+)"/.exec(attrs)?.[1])
            const finish = toSeconds(/end="([^"]+)"/.exec(attrs)?.[1])
            const duration = finish > start ? finish - start : 0
            if (first) {
                const idx = body.indexOf(match[0])
                leading = idx > 0 ? decodeEntities(body.slice(0, idx)) : ''
                first = false
            }
            words.push({ t: start, d: duration, c: (words.length === 0 ? leading : '') + text + trailing })
        }
        if (words.length === 0) continue

        lines.push({
            text: words.map((word) => word.c).join('').trim(),
            start: begin,
            duration: 0,
            words: words.map((word) => ({ t: word.t, d: word.d, c: word.c })),
        })
    }
    if (lines.length === 0) return null
    lines.sort((a, b) => a.start - b.start)
    // 去掉纯空白行
    return lines.filter((line) => line.text)
}

function readCache(songId) {
    try {
        const raw = localStorage.getItem(CACHE_PREFIX + songId)
        if (!raw) return undefined
        return JSON.parse(raw)
    } catch (_) {
        return undefined
    }
}

function writeCache(songId, lines) {
    try {
        const index = JSON.parse(localStorage.getItem(CACHE_INDEX) || '[]')
        const next = index.filter((id) => id !== songId)
        next.push(songId)
        while (next.length > CACHE_LIMIT) {
            const dropped = next.shift()
            localStorage.removeItem(CACHE_PREFIX + dropped)
        }
        localStorage.setItem(CACHE_PREFIX + songId, JSON.stringify(lines))
        localStorage.setItem(CACHE_INDEX, JSON.stringify(next))
    } catch (_) {
        // 存储满或被禁用时忽略：不影响播放
    }
}

/** 查询并解析某首歌的 AMLL 逐词歌词；没有则返回 null（结果会本地缓存） */
export async function fetchAmllLines(songId) {
    if (!songId) return null
    const cached = readCache(songId)
    if (cached !== undefined) return cached

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT)
    try {
        const response = await fetch(`${API_BASE}?ncmMusicId=${encodeURIComponent(String(songId))}`, {
            signal: controller.signal,
        })
        if (!response.ok) {
            // 404 = 词库没有这首歌，记成空结果避免反复请求
            if (response.status === 404) writeCache(songId, [])
            return null
        }
        const payload = await response.json()
        const ttml = payload?.data?.lyrics || ''
        const lines = parseTtml(ttml)
        if (lines) writeCache(songId, lines)
        return lines
    } catch (_) {
        return null
    } finally {
        clearTimeout(timer)
    }
}
