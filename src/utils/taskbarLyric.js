import { ref, watch } from 'vue'
import { usePlayerStore } from '../store/playerStore'
import { fetchAmllLines } from '../api/amll'
import { getLyric } from '../api/song'

/**
 * 把播放器当前歌词行与行内进度同步给主进程的任务栏歌词窗口。
 * 优先使用网易云逐字歌词（yrc）：每个字都有独立起止时间，卡拉OK按字推进；
 * 没有 yrc 时回落到行级 LRC + 行内线性插值。
 * Web 端 windowApi.setTaskbarLyric 是空实现，不会产生副作用。
 */

// yrc 行：[行开始ms,行时长ms](字开始ms,字时长ms,?)字…
const YRC_LINE = /^\[(\d+),(\d+)\](.*)$/
const YRC_WORD = /\((\d+),(\d+),\d+\)([^()]*)/g

function parseYrc(raw) {
    if (!raw) return null
    const lines = []
    for (const row of raw.split('\n')) {
        const lineMatch = YRC_LINE.exec(row.trim())
        if (!lineMatch) continue
        const words = []
        YRC_WORD.lastIndex = 0
        let wordMatch
        while ((wordMatch = YRC_WORD.exec(lineMatch[3])) !== null) {
            const text = wordMatch[3].trim()
            if (!text) continue
            words.push({
                t: Number(wordMatch[1]) / 1000,
                d: Number(wordMatch[2]) / 1000,
                c: text,
            })
        }
        if (words.length === 0) continue
        lines.push({
            text: words.map((word) => word.c).join(''),
            start: Number(lineMatch[1]) / 1000,
            duration: Number(lineMatch[2]) / 1000,
            words,
        })
    }
    return lines.length ? lines : null
}

const KRC_LINE = /^\[(\d+),(\d+)\](.*)$/
const KRC_WORD = /<(\d+),(\d+),\d+>([^<]*)/g
const KRC_CACHE_PREFIX = 'krc2:lines:'
const KRC_CACHE_LIMIT = 80

/** 酷狗 KRC：`[行开始ms,行时长ms]<字开始ms,字时长ms,0>字…` */
function parseKrc(raw) {
    if (!raw) return null
    const lines = []
    for (const row of String(raw).split('\n')) {
        const line = row.replace(/^\uFEFF/, '').trim()
        const lineMatch = KRC_LINE.exec(line)
        if (!lineMatch) continue
        const words = []
        KRC_WORD.lastIndex = 0
        let wordMatch
        while ((wordMatch = KRC_WORD.exec(lineMatch[3])) !== null) {
            const text = wordMatch[3]
            if (!text) continue
            words.push({
                t: Number(wordMatch[1]) / 1000,
                d: Number(wordMatch[2]) / 1000,
                c: text,
            })
        }
        if (words.length === 0) continue
        lines.push({
            text: words.map((word) => word.c).join(''),
            start: Number(lineMatch[1]) / 1000,
            duration: 0,
            words,
        })
    }
    return lines.length ? lines : null
}

/** KRC 头部带有 [ti:歌名]，用它校验拉回来的歌词是不是同一首歌 */
function krcTitle(raw) {
    const row = String(raw || '')
        .split('\n')
        .find((line) => line.trim().startsWith('[ti:'))
    if (!row) return ''
    const start = row.indexOf('[ti:')
    const end = row.indexOf(']', start)
    return end > start ? row.slice(start + 4, end).trim() : ''
}

const plainText = (text) =>
    String(text || '')
        .toLowerCase()
        .split(' ').join('')
        .split(String.fromCharCode(0x3000)).join('')

function sameSong(krc, songName) {
    const title = krcTitle(krc)
    if (!title) return true
    const want = plainText(songName)
    const got = plainText(title)
    if (!want || !got) return true
    return got.includes(want) || want.includes(got)
}

function readKrcCache(songId) {
    try {
        const raw = localStorage.getItem(KRC_CACHE_PREFIX + songId)
        return raw ? JSON.parse(raw) : undefined
    } catch (_) {
        return undefined
    }
}

function writeKrcCache(songId, lines) {
    try {
        // 简单容量控制：超过上限时清掉全部缓存，重新按需拉取
        let count = 0
        for (let i = 0; i < localStorage.length; i += 1) {
            const key = localStorage.key(i)
            if (key && key.indexOf(KRC_CACHE_PREFIX) === 0) count += 1
        }
        if (count >= KRC_CACHE_LIMIT) {
            const keys = []
            for (let i = 0; i < localStorage.length; i += 1) {
                const key = localStorage.key(i)
                if (key && key.indexOf(KRC_CACHE_PREFIX) === 0) keys.push(key)
            }
            keys.forEach((key) => localStorage.removeItem(key))
        }
        localStorage.setItem(KRC_CACHE_PREFIX + songId, JSON.stringify(lines))
    } catch (_) {}
}

const stripText = (text) =>
    String(text || '')
        .replace(/[\s\u3000]/g, '')
        .replace(/[，。！？、,.!?：:；;（）()「」『』《》\-—…“”‘’"'~～]/g, '')
        .toLowerCase()

function bigrams(text) {
    const pairs = new Set()
    for (let i = 0; i < text.length - 1; i += 1) pairs.add(text.slice(i, i + 2))
    return pairs
}

/** Dice 系数：衡量两行歌词的文本相似度 */
function similarity(a, b) {
    if (!a || !b) return 0
    if (a === b) return 1
    if (a.includes(b) || b.includes(a)) return (Math.min(a.length, b.length) / Math.max(a.length, b.length)) * 0.8 + 0.2
    const ga = bigrams(a)
    const gb = bigrams(b)
    if (!ga.size || !gb.size) return 0
    let hit = 0
    for (const gram of ga) if (gb.has(gram)) hit += 1
    return (2 * hit) / (ga.size + gb.size)
}

/**
 * 把酷狗 KRC 的逐字时间「重新锚定」到本曲行时间上：
 * 文本匹配到同一行后，保留字与字之间的相对节奏，整体平移到本曲该行的开始时间；
 * 若 KRC 那行比本曲行长还长，再等比压缩到行长内。匹配不上的行返回 null。
 */
function anchorKrcToLines(ncmLines, krcLines) {
    if (!Array.isArray(ncmLines) || !ncmLines.length) return null
    if (!Array.isArray(krcLines) || !krcLines.length) return null
    const used = new Set()
    let matched = 0
    const result = ncmLines.map((line, index) => {
        const target = stripText(line.lyric)
        if (target.length < 2) return null
        let bestIndex = -1
        let bestScore = 0
        for (let i = 0; i < krcLines.length; i += 1) {
            if (used.has(i)) continue
            const score = similarity(target, stripText(krcLines[i].text))
            if (score > bestScore) {
                bestScore = score
                bestIndex = i
            }
        }
        if (bestIndex < 0 || bestScore < 0.72) return null
        const hit = krcLines[bestIndex]
        if (!Array.isArray(hit.words) || hit.words.length === 0) return null
        used.add(bestIndex)
        const first = hit.words[0]
        const last = hit.words[hit.words.length - 1]
        const natural = last.t + last.d - first.t
        const next = ncmLines[index + 1]
        const span = next ? next.time - line.time : 0
        const scale = span > 0 && natural > span * 0.98 ? (span * 0.98) / natural : 1
        const shift = line.time - first.t
        matched += 1
        return {
            text: hit.text,
            start: line.time,
            duration: 0,
            words: hit.words.map((word) => ({
                t: line.time + (word.t - first.t) * scale,
                d: word.d * scale,
                c: word.c,
            })),
        }
    })
    // 命中太少说明两份歌词不是同一版，整体弃用
    if (matched < Math.max(3, Math.ceil(ncmLines.length * 0.3))) return null
    return result
}

export function startTaskbarLyricSync() {
    if (typeof windowApi === 'undefined' || typeof windowApi.setTaskbarLyric !== 'function') return
    const playerStore = usePlayerStore()

    const songKey = () => {
        const song = playerStore.songList?.[playerStore.currentIndex]
        if (!song) return null
        return song.id ?? song.songId ?? song.name ?? null
    }

    // 播放器自己没拿到歌词时（如恢复播放的歌曲）由任务栏歌词自行补拉
    const selfLyric = ref(null)
    const lyricSource = () => playerStore.lyric || selfLyric.value
    let selfLyricSongId = null
    const loadSelfLyric = async (song) => {
        const songId = song?.id
        if (!songId || songId === selfLyricSongId) return
        selfLyricSongId = songId
        selfLyric.value = null
        const result = await getLyric(songId).catch(() => null)
        if (selfLyricSongId === songId) selfLyric.value = result || null
    }

    // AMLL 逐词歌词（社区词库）：yrc 缺失时的第二数据源
    const amllLines = ref(null)
    let amllSongId = null
    // 酷狗逐字歌词：yrc / AMLL 都没有时的第三来源
    const krcLines = ref(null)
    let krcSongId = null
    let yrcSource = null
    let yrcLines = null
    const getYrcLines = () => {
        const raw = lyricSource()?.yrc?.lyric || ''
        if (raw !== yrcSource) {
            yrcSource = raw
            yrcLines = parseYrc(raw)
        }
        return yrcLines
    }

    /**
     * 每首歌自适应的语速（字/秒）：取全曲各行「字数 ÷ 行时长」的中位数，
     * 中位数能抗住长间奏、单句拖腔这类离群值，比固定 0.32s/字更贴近慢歌。
     */
    let rateCacheSource = null
    let rateCacheValue = 0
    const getCharsPerSecond = (lines) => {
        if (rateCacheSource === lines) return rateCacheValue
        const rates = []
        for (let i = 0; i < lines.length; i += 1) {
            const span = (lines[i + 1] ? lines[i + 1].time : 0) - lines[i].time
            const chars = (lines[i].lyric || '').replace(/\s+/g, '').length
            if (span > 0.5 && chars >= 2) rates.push(chars / span)
        }
        rates.sort((a, b) => a - b)
        rateCacheSource = lines
        rateCacheValue = rates.length ? rates[Math.floor(rates.length / 2)] : 0
        return rateCacheValue
    }

    /**
     * 行级歌词没有逐字时间，只能估「唱完」时长：
     * - 基准按本曲实际语速换算（慢歌自然变慢）
     * - 单句至少占行长的 75%（拖腔的句子不会被早早填满），最多 95%
     * - 行长明显异常（超过本曲常规时长 2.5 倍）时判定为句尾间奏，按常规时长封顶
     */
    const estimateSungDuration = (text, available, rate) => {
        const chars = (text || '').replace(/\s+/g, '').length
        if (!chars) return 0
        const typical = rate > 0 ? chars / rate : Math.max(1.2, chars * 0.32 + 0.3)
        if (!(available > 0)) return typical
        const upper = available * 0.95
        // 行长远超常规：大概率是句尾间奏，不要跟着行长一起拉长
        const cap = available > typical * 2.5 ? typical * 1.4 : upper
        return Math.max(1.2, Math.min(cap, Math.max(typical, available * 0.75)))
    }

    // lyricsObjArr 由 Lyric.vue 解析后写回 store，按时间升序，time 单位为秒
    // 本曲歌词 + KRC 逐字时间的合并结果（按数组身份缓存）
    let mergedSource = null
    let mergedKrcSource = null
    let mergedCache = null
    const getMergedLines = () => {
        const ncm = playerStore.lyricsObjArr
        if (!Array.isArray(ncm) || ncm.length === 0) return null
        const krc = krcLines.value
        if (mergedSource === ncm && mergedKrcSource === krc && mergedCache) return mergedCache
        const anchored = anchorKrcToLines(ncm, krc)
        const rate = getCharsPerSecond(ncm)
        mergedCache = ncm.map((line, index) => {
            const hit = anchored && anchored[index]
            if (hit) return hit
            const next = ncm[index + 1]
            const span = next ? next.time - line.time : 0
            return {
                text: line.lyric || '',
                start: line.time,
                duration: estimateSungDuration(line.lyric, span, rate),
                words: null,
            }
        })
        mergedSource = ncm
        mergedKrcSource = krc
        return mergedCache
    }

    // 一次推送「当前行 + 后两行」：覆盖层用本地时钟切句，不再等下一次 IPC 才换行
    const WINDOW_SIZE = 3

    const songTitle = () => playerStore.songList?.[playerStore.currentIndex]?.name || ''
    // 歌名占位行：前奏/纯音乐时显示，填充进度停在 0
    const titleLine = () => ({ text: songTitle(), start: 0, duration: 1e9, words: null })
    // 纯音乐：没有任何有效歌词行，或整首只有「纯音乐，请欣赏」这类占位
    const isInstrumental = (lines) => {
        const texts = lines.map((line) => (line.lyric || '').trim()).filter(Boolean)
        if (texts.length === 0) return true
        return texts.every((text) => /纯音乐|暂无歌词|没有歌词|无歌词/i.test(text))
    }

    const readState = () => {
        const playing = playerStore.playing === true
        const time = Number(playerStore.progress) || 0
        // 逐字数据优先级：网易云 yrc > AMLL TTML
        const ncmLines = playerStore.lyricsObjArr
        const ncmUsable = Array.isArray(ncmLines) && ncmLines.length > 0 && !isInstrumental(ncmLines)
        // 酷狗 KRC 只在这首歌完全没有可用歌词时兜底：它的时间轴可能对应别的版本，容易错位
        const yrc = getYrcLines() || amllLines.value || (ncmUsable ? null : krcLines.value)
        if (yrc) {
            let index = -1
            for (let i = 0; i < yrc.length; i += 1) {
                if (yrc[i].start <= time) index = i
                else break
            }
            const beforeFirstLine = index < 0
            if (beforeFirstLine) index = 0
            const windowLines = yrc.slice(index, index + WINDOW_SIZE).map((line) => ({
                text: line.text,
                start: line.start,
                words: line.words,
                duration: 0,
            }))
            if (beforeFirstLine && windowLines.length) {
                // 前奏阶段显示歌名，第一句开始时自动切换
                windowLines.unshift(titleLine())
            }
            return {
                lines: windowLines,
                now: time,
                playing,
            }
        }
        const rawLines = playerStore.lyricsObjArr
        if (!Array.isArray(rawLines) || rawLines.length === 0 || isInstrumental(rawLines)) {
            return { lines: [titleLine()], now: time, playing }
        }
        const lines = getMergedLines() || []
        let index = -1
        for (let i = 0; i < lines.length; i += 1) {
            if (lines[i].start <= time) index = i
            else break
        }
        const beforeFirstLine = index < 0
        if (beforeFirstLine) index = 0
        const windowLines = lines.slice(index, index + WINDOW_SIZE)
        if (beforeFirstLine && windowLines.length) {
            windowLines.unshift(titleLine())
        }
        return {
            lines: windowLines,
            now: time,
            playing,
        }
    }

    // IPC 走结构化克隆：AMLL/KRC 的数据在 ref 里是响应式代理，必须先转成纯对象
    const toPlainLines = (lines) =>
        (Array.isArray(lines) ? lines : []).map((line) => ({
            text: line.text,
            start: line.start,
            duration: line.duration,
            words: Array.isArray(line.words)
                ? line.words.map((word) => ({ t: word.t, d: word.d, c: word.c }))
                : null,
        }))

    const send = (state) => {
        windowApi.setTaskbarLyric({
            lines: toPlainLines(state.lines),
            now: state.now || 0,
            playing: state.playing === true,
        })
    }

    const loadKugou = async (song) => {
        const songId = song?.id
        if (!songId || songId === krcSongId) return
        krcSongId = songId
        krcLines.value = null
        const cached = readKrcCache(songId)
        if (cached !== undefined) {
            krcLines.value = Array.isArray(cached) && cached.length ? cached : null
            return
        }
        if (typeof windowApi.getKugouLyric !== 'function') return
        const krc = await windowApi
            .getKugouLyric({
                title: song.name,
                artist: (song.ar || []).map((item) => item.name).join('/'),
                duration: (song.dt || 0) / 1000,
            })
            .catch(() => null)
        const lines = krc && sameSong(krc, song.name) ? parseKrc(krc) : null
        if (krcSongId !== songId) return
        // 只有真正拉到时才缓存：网络失败/接口抖动时下次换歌还能重试
        if (lines && lines.length) writeKrcCache(songId, lines)
        krcLines.value = lines
    }

    const loadAmll = async (songId) => {
        if (!songId || songId === amllSongId) return
        amllSongId = songId
        amllLines.value = null
        const lines = await fetchAmllLines(songId)
        // 拿到结果时如果已经换歌就丢弃
        if (amllSongId === songId) amllLines.value = Array.isArray(lines) && lines.length ? lines : null
    }

    let lastSongKey = null
    let pendingSongKey = null
    // 换歌瞬间 lyric 还是上一首的，必须等新歌词对象到位再渲染
    let lyricAtSongChange = null
    let lastSignature = null

    watch(
        // lyricsObjArr 必须一并监听：歌词解析完成时 lyric 可能早已赋值，只有数组会变
        () => [songKey(), playerStore.lyric, selfLyric.value, playerStore.lyricsObjArr, playerStore.progress, playerStore.playing, amllLines.value, krcLines.value],
        () => {
            const key = songKey()
            // 首次运行没有「上一首」，直接按当前数据渲染，避免启动时一直卡在等待新歌词
            const song = playerStore.songList?.[playerStore.currentIndex]
            if (lastSongKey === null) {
                lastSongKey = key
                void loadSelfLyric(song)
                void loadAmll(song?.id)
                void loadKugou(song)
            } else if (key !== lastSongKey) {
                lastSongKey = key
                void loadAmll(song?.id)
                void loadKugou(song)
                pendingSongKey = key
                lyricAtSongChange = playerStore.lyric
                lastSignature = null
                void loadSelfLyric(song)
                // 换歌立刻显示歌名（而不是残留上一首或长时间空白），等歌词到位再切换
                send({ lines: [titleLine()], now: 0, playing: false })
                return
            }
            if (pendingSongKey !== null) {
                // 网易云歌词或 AMLL 逐词歌词任一到位即可继续
                if (playerStore.lyric === lyricAtSongChange && !selfLyric.value && !amllLines.value && !krcLines.value) return
                pendingSongKey = null
                lyricAtSongChange = null
            }

            const state = readState()
            // 每 0.25s 同步一次时间基准；行窗口内容变化也会触发推送，覆盖层在两次推送之间自行切句与推进
            const signature = `${state.lines.map((line) => line.text).join('|')}#${Math.round((state.now || 0) * 4)}#${state.playing}#${krcLines.value ? 'k' : amllLines.value ? 'a' : 'y'}`
            if (signature === lastSignature) return
            lastSignature = signature
            send(state)
        },
        { immediate: true },
    )
}
