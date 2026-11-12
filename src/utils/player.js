import pinia from '../store/pinia'
import { Howl } from 'howler'
import dayjs from 'dayjs';
import { noticeOpen } from './dialog'
import { isHydrogenWeb, getBiliCookieForApi } from './webProfileNas'
import { getMusicUrl, likeMusic, getLyric, scrobble } from '../api/song'
import { search } from '../api/other'
import { isLogin } from './authority'
import { getCloudLyric } from '../api/cloud'
import { getLikelist } from '../api/user'
import { useUserStore } from '../store/userStore'
import { usePlayerStore } from '../store/playerStore'
import { onTaskbarState } from './taskbarLyric'
import { useLibraryStore } from '../store/libraryStore'
import { useOtherStore } from '../store/otherStore'
import { storeToRefs } from 'pinia'
import duration from 'dayjs/plugin/duration'

const otherStore = useOtherStore()
const userStore = useUserStore()
const libraryStore = useLibraryStore(pinia)
const playerStore = usePlayerStore(pinia)
const { libraryInfo } = storeToRefs(libraryStore)
const { currentMusic, playing, progress, volume, quality, playMode, songList, shuffledList, shuffleIndex, listInfo, songId, currentIndex, time, playlistWidgetShow, playerChangeSong, lyric, lyricsObjArr, lyricShow, lyricEle, isLyricDelay, widgetState, localBase64Img, musicVideo, currentMusicVideo, musicVideoDOM, videoIsPlaying, playerShow, lyricBlur, coverUrl} = storeToRefs(playerStore)

let isProgress = false
let musicProgress = null
let loadLast = true
let playModeOne = false //为true代表顺序播放已全部结束
let currentTiming = null
let videoCheckInterval = null
let playFailCount = 0 //连续播放失败计数，用于停止不可用列表的自动跳歌死循环

let desktopLyricProgressTimer = null
// 任务栏歌词每帧算好的逐字数据（含 words），桌面歌词复用同一份，避免二次解析
let latestTaskbarState = null
onTaskbarState((state) => { latestTaskbarState = state })

export function startDesktopLyricSyncLoop() {
    clearInterval(desktopLyricProgressTimer)
    syncDesktopLyric()
    desktopLyricProgressTimer = setInterval(() => {
        // 暂停也要推送：窗口用 syncTime + playing 外推进度，停推会让进度继续涨
        if (currentMusic.value) {
            syncDesktopLyric()
        }
    }, 100)
    // 窗口创建/恢复时主进程会请求一帧，避免开窗瞬间只有占位文本
    if (typeof window !== 'undefined' && windowApi?.onDesktopLyricRequestSync) {
        windowApi.onDesktopLyricRequestSync(() => syncDesktopLyric())
    }
    // 桌面歌词悬浮工具栏的播放控制
    if (typeof window !== 'undefined' && windowApi?.onDesktopLyricMainAction) {
        windowApi.onDesktopLyricMainAction((action) => {
            if (action === 'togglePlay') playing.value ? pauseMusic() : startMusic()
            else if (action === 'prev') playLast()
            else if (action === 'next') playNext()
        })
    }
}

export function stopDesktopLyricSyncLoop() {
    clearInterval(desktopLyricProgressTimer)
    syncDesktopLyric()
}


const regNewLine = /\n/
const regTime = /\[\d{2}:\d{2}\.\d{2,3}\]?/

function extractLyricLineText(line, match) {
    const bracketIdx = line.indexOf(']', match.index)
    const start = bracketIdx !== -1 ? bracketIdx + 1 : match.index + match[0].length
    return line.substring(start).replace(/\[\d{2}:\d{2}\.\d{2,3}\]?/g, '').trim()
}

function formatLyricTimeSeconds(timeStr) {
    const regMin = /.*:/
    const regSec = /:.*\./
    const regMs = /\./

    if (timeStr.indexOf('.') === -1) timeStr = timeStr.replace(/(.*):/, '$1.')
    const min = parseInt(timeStr.match(regMin)[0].slice(0, 2))
    let sec = parseInt(timeStr.match(regSec)[0].slice(1, 3))
    const ms = timeStr.slice(timeStr.match(regMs).index + 1, timeStr.match(regMs).index + 3)
    if (min !== 0) sec += min * 60
    return Number(sec + '.' + ms)
}


let parsedFromLyric = null

export function ensureLyricParsed() {
    if (!lyric.value?.lrc?.lyric) return
    // 只解析"当前这首歌"一次：靠 store 字段是否为空判断会在切歌后沿用上一首的歌词
    if (parsedFromLyric === lyric.value) return
    parsedFromLyric = lyric.value
    const lrcText = lyric.value.lrc.lyric
    const cur = (songList.value || [])[currentIndex.value]
    const curDt = cur?.dt ? Math.trunc(cur.dt / 1000) : (time.value || 0)

    if (lrcText.indexOf('[') === -1) {
        const lineArr = lrcText.split(regNewLine)
        const parsed = []
        lineArr.forEach(item => {
            if (item.trim()) parsed.push({ lyric: item.trim(), time: 0 })
        })
        parsed.push({ lyric: '', time: curDt })
        lyricsObjArr.value = parsed
        return
    }

    const arr = lrcText.split(regNewLine)
    const tarr = (lyric.value.tlyric && lyric.value.tlyric.lyric) ? lyric.value.tlyric.lyric.split(regNewLine) : null
    const rarr = (lyric.value.romalrc && lyric.value.romalrc.lyric) ? lyric.value.romalrc.lyric.split(regNewLine) : null

    const lyricArr = []
    for (let i = 0; i < arr.length; i++) {
        if (!arr[i]) continue
        const lyctime = arr[i].match(regTime)
        if (!lyctime) continue
        const obj = {}
        obj.lyric = extractLyricLineText(arr[i], lyctime)
        if (!obj.lyric) continue
        if (obj.lyric.indexOf('纯音乐') !== -1) {
            lyricsObjArr.value = [
                { lyric: '纯音乐，请欣赏', time: 0 },
                { lyric: '', time: curDt }
            ]
            return
        }
        if (tarr && obj.lyric.indexOf('作词') === -1 && obj.lyric.indexOf('作曲') === -1) {
            for (let j = 0; j < tarr.length; j++) {
                if (!tarr[j]) continue
                const tTimeCore = lyctime[0].replace(/\]$/, '')
                if (tarr[j].indexOf(tTimeCore) !== -1) {
                    const tMatch = tarr[j].match(regTime)
                    obj.tlyric = tMatch ? extractLyricLineText(tarr[j], tMatch) : ''
                    if (!obj.tlyric) { tarr.splice(j, 1); j--; continue }
                    tarr.splice(j, 1)
                    break
                }
            }
        }
        if (rarr && obj.lyric.indexOf('作词') === -1 && obj.lyric.indexOf('作曲') === -1) {
            for (let k = 0; k < rarr.length; k++) {
                if (!rarr[k]) continue
                const rTimeCore = lyctime[0].replace(/\]$/, '')
                if (rarr[k].indexOf(rTimeCore) !== -1) {
                    const rMatch = rarr[k].match(regTime)
                    obj.rlyric = rMatch ? extractLyricLineText(rarr[k], rMatch) : ''
                    if (!obj.rlyric) { rarr.splice(k, 1); k--; continue }
                    rarr.splice(k, 1)
                    break
                }
            }
        }
        obj.time = lyctime ? formatLyricTimeSeconds(lyctime[0].replace(/[\[\]]/g, '')) : 0
        if (obj.lyric !== '') lyricArr.push(obj)
    }
    lyricArr.sort((x, y) => x.time - y.time)
    lyricsObjArr.value = lyricArr
}


function pickTaskbarWords(text) {
    if (!latestTaskbarState || !Array.isArray(latestTaskbarState.lines)) return null
    const hit = latestTaskbarState.lines.find((line) => line.text === text)
    return hit && Array.isArray(hit.words) && hit.words.length ? hit.words : null
}

export function syncDesktopLyric() {
    if (!windowApi?.sendDesktopLyricData) return
    const cur = (songList.value || [])[currentIndex.value]
    if (!cur) {
        windowApi.sendDesktopLyricData({
            title: '',
            artist: '',
            currentLrc: '',
            transLrc: '',
            romaLrc: '',
            nextLrc: '',
            lineStartTime: 0,
            lineDuration: 0,
            playing: false,
            progress: 0,
            duration: 0,
            syncTime: Date.now(),
        })
        return
    }

    const seekTime = (currentMusic.value ? currentMusic.value.seek() : progress.value) || 0
    let curText = ''
    let curTrans = ''
    let curRoma = ''
    let nextText = ''
    let lineStartTime = 0
    let lineDuration = 4.0

    // 歌词解析统一由 Lyric.vue 负责（它同时维护 lyricType）。
    // 播放器侧再解析一次会与它交替写 lyricsObjArr，导致行号错乱（显示成"作词:xxx"这类首行）。

    if (Array.isArray(lyricsObjArr.value) && lyricsObjArr.value.length) {
        const arr = lyricsObjArr.value
        // 加入 150ms 的声学起音提前量补偿，使得歌词切行动作与人声发音完全同步！
        const effectiveSeek = seekTime + 0.15
        let idx = -1
        for (let i = 0; i < arr.length; i++) {
            if (effectiveSeek >= arr[i].time) idx = i
            else break
        }
        if (idx >= 0 && idx < arr.length) {
            curText = arr[idx].lyric || ''
            curTrans = arr[idx].tlyric || ''
            curRoma = arr[idx].rlyric || arr[idx].romalrc || ''
            lineStartTime = arr[idx].time || 0

            const nextLine = arr[idx + 1]
            if (nextLine && nextLine.time > lineStartTime) {
                lineDuration = nextLine.time - lineStartTime
                nextText = nextLine.lyric || ''
            } else {
                lineDuration = Math.max(2.0, Math.min(6.0, (time.value || 0) - lineStartTime))
            }
        } else if (arr.length > 0) {
            lineStartTime = 0
            lineDuration = arr[0].time || 4.0
            nextText = arr[0].lyric || ''
        }
    }

    windowApi.sendDesktopLyricData({
        title: cur.name || cur.songName || cur.fileName || '',
        artist: (cur.ar || []).map(a => a?.name).filter(Boolean).join('/') || cur.artist || '',
        currentLrc: curText || (cur.name || cur.songName || cur.fileName || 'Hydrogen Music'),
        transLrc: curTrans,
        romaLrc: curRoma,
        nextLrc: nextText,
        lineStartTime,
        lineDuration,
        words: pickTaskbarWords(curText),
        // 直接复用任务栏每帧算好的行窗口与当前时间，
        // 避免两套独立推算导致桌面歌词比任务栏/人声更靠前
        lines: latestTaskbarState && Array.isArray(latestTaskbarState.lines) ? latestTaskbarState.lines : null,
        now: latestTaskbarState ? latestTaskbarState.now : null,
        playing: playing.value,
        progress: seekTime,
        duration: time.value || 0,
        syncTime: Date.now(),
    })
}

// --- 网易云听歌记录同步 (Scrobble) ---
let scrobbleState = {
    songId: null,
    name: '',
    artist: '',
    sourceId: 0,
    duration: 0,
    listenedSeconds: 0,
    lastPlayTime: null,
    startplaySent: false,
    scrobbled: false,
}

// 刷新并结算当前听歌记录（切歌或播放结束时触发）
export function flushScrobble(forceEnd = false) {
    if (!isLogin() || !scrobbleState.songId) return

    // 如果正在播放，先累加当前片段的听歌时间
    if (scrobbleState.lastPlayTime) {
        const delta = (Date.now() - scrobbleState.lastPlayTime) / 1000
        scrobbleState.listenedSeconds += delta
        scrobbleState.lastPlayTime = forceEnd ? null : Date.now()
    }

    const { songId: sId, name, artist, sourceId, duration, listenedSeconds, scrobbled } = scrobbleState
    if (scrobbled) return

    // 触发打卡条件：
    // 1. 播放结束 (forceEnd 为 true 且听了至少 5 秒)
    // 2. 切歌时已听满 30 秒或总时长的 50%
    const isDurationValid = duration > 0 ? listenedSeconds >= Math.min(30, duration * 0.5) : listenedSeconds >= 30
    if (forceEnd ? listenedSeconds >= 5 : isDurationValid) {
        const reportTime = forceEnd && duration > 0
            ? Math.max(Math.floor(listenedSeconds), Math.floor(duration))
            : Math.floor(listenedSeconds)

        scrobble({
            id: sId,
            name: name || '',
            artist: artist || '',
            sourceid: sourceId || 0,
            time: reportTime,
            total: duration || reportTime || 180,
            action: 'play',
        }).catch((err) => {
            console.warn('[scrobble] 同步播放记录失败:', err?.message || err)
        })
        scrobbleState.scrobbled = true
    }
}

// 初始化新歌曲的打卡上下文
function initScrobble(song) {
    flushScrobble(false)
    if (!song || song.type === 'local' || !song.id) {
        scrobbleState = {
            songId: null,
            name: '',
            artist: '',
            sourceId: 0,
            duration: 0,
            listenedSeconds: 0,
            lastPlayTime: null,
            startplaySent: false,
            scrobbled: false,
        }
        return
    }

    let srcId = 0
    if (listInfo.value && listInfo.value.id && !isNaN(Number(listInfo.value.id))) {
        srcId = Number(listInfo.value.id)
    }

    const artistName = (song.ar || song.artists || []).map(a => a?.name || a).filter(Boolean).join('/')

    scrobbleState = {
        songId: song.id,
        name: song.name || '',
        artist: artistName || '',
        sourceId: srcId,
        duration: song.dt ? Math.floor(song.dt / 1000) : 0,
        listenedSeconds: 0,
        lastPlayTime: null,
        startplaySent: false,
        scrobbled: false,
    }
}

// 播放时开始/恢复计时
function markScrobblePlay() {
    if (!scrobbleState.songId) return
    if (!scrobbleState.startplaySent && isLogin()) {
        scrobble({
            id: scrobbleState.songId,
            name: scrobbleState.name,
            artist: scrobbleState.artist,
            sourceid: scrobbleState.sourceId || 0,
            time: 0,
            total: scrobbleState.duration || 180,
            action: 'startplay',
        }).catch(() => {})
        scrobbleState.startplaySent = true
    }
    scrobbleState.lastPlayTime = Date.now()
}

// 暂停时累加时长
function markScrobblePause() {
    if (!scrobbleState.songId || !scrobbleState.lastPlayTime) return
    const delta = (Date.now() - scrobbleState.lastPlayTime) / 1000
    scrobbleState.listenedSeconds += delta
    scrobbleState.lastPlayTime = null
}

// 单曲循环重新打卡
function resetScrobbleForLoop() {
    if (!scrobbleState.songId) return
    scrobbleState.scrobbled = false
    scrobbleState.listenedSeconds = 0
    scrobbleState.startplaySent = false
    scrobbleState.lastPlayTime = Date.now()
}

// 统一处理"当前歌曲无法播放"：清理状态 + 自动跳下一首；连续失败达到列表长度时停止
/** 命中风控冷却：不参与"连续失败"计数，也不再自动切歌打扰用户 */
function pauseForRisk() {
    clearInterval(musicProgress)
    playing.value = false
    windowApi.playOrPauseMusicCheck(false)
    // 关键：必须停掉上一首的 Howl。界面已经切到新歌，若旧音频继续出声，
    // 就会出现「显示的是初恋、听到的是出现又离开」这种歌与声音不一致
    try {
        if (currentMusic.value) {
            currentMusic.value.unload()
            currentMusic.value = null
        }
    } catch (_) {}
    progress.value = 0
    noticeOpen('网易云风控冷却中，请稍后重试', 2)
}

function skipUnplayable(msg) {
    clearInterval(musicProgress)
    playing.value = false
    windowApi.playOrPauseMusicCheck(false)
    // 必须先卸载上一首：否则旧 Howl 会继续出声，出现「界面已是新歌、声音还是上一首」的错乱
    if(currentMusic.value) currentMusic.value.unload()
    currentMusic.value = null
    lyric.value = null
    scrobbleState = {
        songId: null,
        name: '',
        artist: '',
        sourceId: 0,
        duration: 0,
        listenedSeconds: 0,
        lastPlayTime: null,
        startplaySent: false,
        scrobbled: false,
    }
    noticeOpen(msg, 2)
    playFailCount++
    const listLength = (songList.value || []).length
    if(listLength && playFailCount >= listLength) {
        playFailCount = 0
        noticeOpen('连续多首歌曲无法播放，已停止自动切歌', 2)
        return
    }
    playNext()
}

export function loadLastSong() {
    if(loadLast) {
        windowApi.getLastPlaylist().then(list => {
            if(list) {
                songList.value = list.songList
                shuffledList.value = list.shuffledList
            }
            if(songList.value && songList.value.length) {
                // 持久化的索引可能超出恢复后的列表长度，先收敛避免启动即越界
                if(currentIndex.value == null || currentIndex.value < 0 || currentIndex.value >= songList.value.length) {
                    currentIndex.value = 0
                }
                if(playMode.value == 3) {
                    const sl = shuffledList.value || []
                    if(shuffleIndex.value == null || shuffleIndex.value < 0 || shuffleIndex.value >= sl.length) {
                        shuffleIndex.value = 0
                    }
                }
                if(songList.value[currentIndex.value].type == 'local') getSongUrl(songList.value[currentIndex.value].id, currentIndex.value, false, true)
                else getSongUrl(songList.value[currentIndex.value].id, currentIndex.value, false, false)
                if(musicVideo.value) loadMusicVideo(songList.value[currentIndex.value].id)
            }
        })
    }
}

export function play(url, autoplay) {
    if(currentMusic.value) {
        currentMusic.value.unload()
    }
    currentMusic.value = new Howl({
        src: url,
        autoplay: autoplay,
        html5: true,
        preload: true,
        format: ['mp3', 'flac'],
        loop: (playMode.value == 2),
        volume: volume.value,
        xhr: {
            method: 'GET',
            withCredentials: true,
        },
        onend: function() {
            clearInterval(musicProgress)
            flushScrobble(true)
            if(playMode.value == 0 && currentIndex.value < songList.value.length - 1) { playNext();return } //顺序播放
            if(playMode.value == 0 && currentIndex.value == songList.value.length - 1) { playing.value = false;playModeOne = true;windowApi.playOrPauseMusicCheck(playing.value);return } //顺序播放结束暂停状态
            if(playMode.value == 1) { playNext();return } //列表循环
            if(playMode.value == 3) { playNext() } //随机播放(为列表循环)
            if(playMode.value == 2) {
                clearLycAnimation()
                resetScrobbleForLoop()
            } // 单曲循环播放结束时清除歌词动画并重置打卡
        },
        onloaderror: function() {
            skipUnplayable('歌曲加载失败')
        },
        onplayerror: function() {
            skipUnplayable('歌曲播放失败')
        }
    })
    currentMusic.value.once('load', () => {
        const actual = currentMusic.value.duration()
        // 时长校验：解灰/第三方源可能匹配到别的录音，时长明显不符时判为错源并跳过
        const expected = ((songList.value || [])[currentIndex.value]?.dt || 0) / 1000
        if(expected > 30 && actual > 0 && Math.abs(actual - expected) > Math.max(20, expected * 0.15)) {
            skipUnplayable('音源与歌曲时长不符，已跳过')
            return
        }
        time.value = Math.floor(actual)
        playFailCount = 0
        if(loadLast) {
            currentMusic.value.volume(0)
            currentMusic.value.seek(progress.value)
            loadLast = false
        }
        playerChangeSong.value = false
    })
    currentMusic.value.on('play', () => {
        playFailCount = 0
        markScrobblePlay()
        currentMusic.value.fade(0,volume.value,200)
        startProgress()
        playing.value = true
        windowApi.playOrPauseMusicCheck(playing.value)
    })
    currentMusic.value.on('pause', () => {
        clearInterval(musicProgress)
        markScrobblePause()
        playing.value = false
        windowApi.playOrPauseMusicCheck(playing.value)
        currentMusic.value.fade(volume.value,0,200)
    })
    currentMusic.value.on('stop', () => {
        clearInterval(musicProgress)
        markScrobblePause()
        playing.value = false
        windowApi.playOrPauseMusicCheck(playing.value)
    })
}

export function startProgress() {
    clearInterval(musicProgress)
    startDesktopLyricSyncLoop()
    if(!currentMusic.value) return
    progress.value = currentMusic.value.seek()
    musicProgress = setInterval(() => {
        if(currentMusic.value && currentMusic.value.seek() < time.value)
            progress.value = currentMusic.value.seek()
    }, 1000);
}

export function setId(id, index) {
    if(playMode.value != 3) {
        songId.value = id
        currentIndex.value = index
    } else {
        songId.value = id
        shuffleIndex.value = index
        currentIndex.value = (songList.value || []).findIndex((song) => song.id === songId.value)
    }
}

export function addToList(listType, songlist, sourceId) {
    listInfo.value = {
        id: sourceId ? sourceId : (listType == 'rec' ? 'rec' : (libraryInfo.value ? libraryInfo.value.id : 'none')),
        type: listType
    }
    songList.value = songlist.slice()
    savePlaylist()
}

export function localMusicHandle(list, isToNext) {
    let addList = []
    list.forEach(song => {
        let ar = []
        if(song.common.artists)
            song.common.artists.forEach(artist => {
                ar.push({
                    id: 'local',
                    name: artist
                })
            })
        else {
            ar.push({
                id: 'local',
                name: 'NONE'
            })
        }
        addList.push(
            {
                id: song.id,
                ar: ar,
                url: song.dirPath,
                name: song.common.title,
                localName: song.common.localTitle,
                type: 'local',
                dt: Math.floor(song.format.duration * 1000),
                sampleRate: song.format.sampleRate / 1000,
                bitsPerSample: song.format.bitsPerSample,
                bitrate: Math.round(song.format.bitrate / 1000),
            }
        )
    });
    if(isToNext) return addList[0]
    return addList
}

export function addLocalMusicTOList(listType, localMusicList, playId, playIndex) {
    listInfo.value = {
        id: 'local',
        type: listType
    }
    
    songList.value = localMusicHandle(localMusicList, false)
    addSong(playId, playIndex, true, true)
    savePlaylist()
}
export function startLocalMusicVideo() {
    clearInterval(videoCheckInterval)
    videoCheckInterval = setInterval(() => {
        if(!currentMusic.value) return
        musicVideoCheck(currentMusic.value.seek())
    }, 200);
}
export function unloadMusicVideo() {
    if (videoCheckInterval) {
        clearInterval(videoCheckInterval)
        videoCheckInterval = null
    }
    currentMusicVideo.value = null
    videoIsPlaying.value = false
    playerShow.value = true
}
export function loadMusicVideo(id) {
    if(currentMusicVideo.value) unloadMusicVideo()
    const mvPayload = { id, method: 'verify' }
    if (isHydrogenWeb()) {
        const c = getBiliCookieForApi()
        if (c) mvPayload.clientBiliCookie = c.replace(/;+$/, '')
    }
    windowApi.musicVideoIsExists(mvPayload).then(result => {
        if(result == '404') {
            videoCheckInterval = null
            noticeOpen('未找到视频文件', 2)
            unloadMusicVideo()
        } else if(result) {
            currentMusicVideo.value = result.data
            if (result.data.streamBaseUrl || result.data.path) startLocalMusicVideo()
        } else {
            videoCheckInterval = null
            unloadMusicVideo()
        }
    })
}

export function addSong(id, index, autoplay, isLocal) {
    flushScrobble(false)
    clearInterval(musicProgress)
    progress.value = 0
    if(lyricShow.value) {
        lyricShow.value = false
        playerChangeSong.value = true
    }
    setId(id, index)
    if(musicVideo.value) loadMusicVideo(id)

    const cur = (songList.value || [])[currentIndex.value]
    if(!cur) {
        noticeOpen('播放列表为空', 2)
        return
    }
    if(cur.type == 'local') isLocal = true
    else isLocal = false

    if(currentMusic.value && volume.value != 0) {
        currentMusic.value.fade(volume.value,0,200)
        currentMusic.value.once('fade', () => {
            getSongUrl(id, index, autoplay, isLocal)
            return
        })
        if(currentMusic.value.state() == 'loading' || currentMusic.value.state() == 'unloaded') {
            currentMusic.value.unload()
            getSongUrl(id, index, autoplay, isLocal)
        }
    } else {
        getSongUrl(id, index, autoplay, isLocal)
    }
}

export function setSongLevel(level) {
    const cur = (songList.value || [])[currentIndex.value]
    if(!cur) return
    if(level == 'standard') cur.level = cur.l
    else if(level == 'higher') cur.level = cur.m
    else if(level == 'exhigh') cur.level = cur.h
    else if(level == 'lossless') cur.level = cur.sq
    else if(level == 'hires') cur.level = cur.hr
    cur.quality = level
}
export async function getLocalLyric(filePath) {
    const lyric = await windowApi.getLocalMusicLyric(filePath)
    if(lyric) return lyric
    else return false
}
export function setSongToWindows() {
    const cur = (songList.value || [])[currentIndex.value]
    if(!cur) return
    if(cur.type != 'local') {
        coverUrl.value = cur.al?.picUrl ? cur.al.picUrl + '?param=128y128' : null
    } else {
        if(!localBase64Img.value) coverUrl.value = null
        else coverUrl.value = localBase64Img.value
    }
    if ('mediaSession' in navigator) {
        navigator.mediaSession.metadata = new MediaMetadata({
          title: [cur.name],
          artist: [cur.ar.map(a => a.name)],
          artwork: [
            { src: coverUrl.value }
          ]
        });
    } else {
        return
    }
}
// 歌词补全计划：当本地/云盘或无歌词歌曲播放时，搜索匹配网易云曲库歌词自动补全
// 歌词补全的频控：同一首只查一次，且全局 2s 冷却，
// 避免快速切歌/本地曲库连续跳过时把 /cloudsearch 打爆（405 操作频繁）
const lyricLookupAt = new Map()
const LYRIC_LOOKUP_DEDUPE_MS = 10 * 60 * 1000
const LYRIC_LOOKUP_COOLDOWN_MS = 2000
let lyricLookupLastAt = 0

export async function completeMissingLyric(song, currentTargetId, force = false, token = null) {
    if (!song) return
    if (!force && !playerStore.lyricCompletion) return
    const lookupKey = String(song.id || song.url || song.name || song.localName || '')
    if (!lookupKey) return
    const lastAt = lyricLookupAt.get(lookupKey)
    const nowTs = Date.now()
    if (lastAt && nowTs - lastAt < LYRIC_LOOKUP_DEDUPE_MS) return
    if (nowTs - lyricLookupLastAt < LYRIC_LOOKUP_COOLDOWN_MS) return
    lyricLookupLastAt = nowTs
    lyricLookupAt.set(lookupKey, nowTs)
    let rawName = song.songName || song.name || song.localName || song.title || song.fileName || ''
    let cleanName = rawName
        .replace(/\.[^/.]+$/, '')
        .replace(/_EM$/i, '')
        .replace(/\s*\(Explicit\)/i, '')
        .replace(/\s*\(Lost Paradise\)/i, '')
        .replace(/\s*\(Spring Has Begun\)/i, '')
        .replace(/[-_]\s*$/g, '')
        .trim()
    if (!cleanName) return

    let rawArtist = ''
    if (Array.isArray(song.ar)) {
        rawArtist = song.ar.map(a => a?.name).filter(n => n && n !== 'NONE' && n !== 'local' && n !== '未知艺术家').join(' ')
    } else if (Array.isArray(song.artists)) {
        rawArtist = song.artists.map(a => a?.name || a).filter(n => n && n !== 'NONE' && n !== 'local' && n !== '未知艺术家').join(' ')
    } else if (typeof song.artist === 'string' && song.artist !== '未知艺术家') {
        rawArtist = song.artist
    }

    // 若文件名包含 "歌手 - 歌名" 或 "歌名 - 歌手" 分隔，智能解析补充
    if (!rawArtist && cleanName.includes(' - ')) {
        const parts = cleanName.split(' - ')
        if (parts.length === 2) {
            cleanName = parts[0].trim()
            rawArtist = parts[1].trim()
        }
    }

    const keywords = `${cleanName} ${rawArtist}`.trim()
    if (!keywords) return

    try {
        const searchRes = await search({ keywords, limit: 5, type: 1 }, { silent: true })
        const songs = searchRes?.result?.songs || []
        if (!songs.length) return

        // 不再直接取搜索结果第一条：名字/时长对不上时会套用别的歌的歌词
        const norm = (v) => String(v || '').toLowerCase().replace(/[\s\-_（）()《》【】\[\]]/g, '')
        const targetName = norm(cleanName)
        const targetDt = Number(song.dt || 0)
        const matchedSong = songs.find((item) => {
            if (!item || !item.id) return false
            const name = norm(item.name)
            const nameOk = !!name && (name === targetName || name.includes(targetName) || targetName.includes(name))
            const dtOk = !targetDt || !item.dt
                ? true
                : Math.abs(item.dt - targetDt) <= Math.max(10000, targetDt * 0.15)
            // 歌手也要对得上：同名翻唱/合辑经常时长一致，只比名字会套上原唱歌词
            const targetArtist = norm(rawArtist)
            const candidateArtists = (item.ar || item.artists || [])
                .map((a) => norm(a && (a.name || a)))
                .filter(Boolean)
            const artistOk = !targetArtist || !candidateArtists.length
                ? true
                : candidateArtists.some((a) => a.includes(targetArtist) || targetArtist.includes(a))
            return nameOk && dtOk && artistOk
        }) || null
        if (!matchedSong) {
            console.warn('[completeMissingLyric] 无可靠匹配，跳过补全')
            return
        }

        const foundLyric = await getLyric(matchedSong.id)
        if (token != null && token !== lyricToken) return
        if (foundLyric?.lrc?.lyric) {
            // 防竞态：确认当前播放歌曲未被切走
            if (songId.value === currentTargetId || currentTargetId == null) {
                lyricsObjArr.value = null // 重置触发 Lyric.vue 重新解析
                lyric.value = foundLyric
                if (!lyricShow.value && !widgetState.value) {
                    lyricShow.value = true
                    playerChangeSong.value = false
                }
            }
        }
    } catch (e) {
        console.warn('[completeMissingLyric] 歌词补全搜索失败:', e?.message || e)
    }
}

/**
 * 部分歌曲的 /lyric/new 返回的是逐行 JSON 富文本（{"t":0,"c":[{"tx":"作词: "}]}），
 * 前端 LRC 解析器读不了；这里统一转回标准 LRC 文本。
 */
function normalizeLyricPayload(payload) {
    if (!payload || typeof payload !== 'object') return payload
    // 注意歌词可能是「混合格式」：前几行是 JSON 富文本，后面是普通 LRC 行，
    // 所以逐行判断，能解析成 JSON 的才转换，其余原样保留
    const toLrc = (text) => {
        if (typeof text !== 'string') return text
        let converted = 0
        const rows = text.split('\n').map((row) => {
            const trimmed = row.trim()
            if (!trimmed.startsWith('{')) return row
            try {
                const line = JSON.parse(trimmed)
                const ms = Math.max(0, Number(line.t) || 0)
                const content = (line.c || []).map((part) => part.tx || '').join('')
                const mm = String(Math.floor(ms / 60000)).padStart(2, '0')
                const ss = String(Math.floor((ms % 60000) / 1000)).padStart(2, '0')
                const xxx = String(Math.floor(ms % 1000)).padStart(3, '0')
                converted += 1
                return `[${mm}:${ss}.${xxx}]${content}`
            } catch (_) {
                return row
            }
        })
        return converted ? rows.join('\n') : text
    }
    const next = { ...payload }
    if (next.lrc && typeof next.lrc.lyric === 'string') {
        next.lrc = { ...next.lrc, lyric: toLrc(next.lrc.lyric) }
    }
    return next
}

// 歌词请求令牌：切歌/连续跳过时，旧的异步结果必须作废，否则会出现
// 「封面与歌名没变但歌词在跳」的串台现象
let lyricToken = 0
let lastLyricKey = ''

// 歌词加载：云盘歌曲（id ≥ 8e8）无歌词时回退到云盘歌词接口；未命中时支持歌词补全计划
function loadLyric(id, song) {
    const curSong = song || (songList.value || [])[currentIndex.value]
    // 每次写入新歌词都先清空解析结果，否则 Lyric.vue 只在 lyricsObjArr 为空时才重新解析，
    // 小窗/播放页会一直沿用上一首的歌词（任务栏歌词同样会显示错行）
    const token = ++lyricToken
    const applyLyric = (next) => {
        // 已经切歌，丢弃过期结果
        if (token !== lyricToken) return
        clearLoading()
        lyricsObjArr.value = null
        lyric.value = normalizeLyricPayload(next)
        // 播放页开着时歌词区应自动就绪（恢复播放时不会走 getSongUrl 里的那段）
        if (!lyricShow.value && !widgetState.value) {
            lyricShow.value = true
            playerChangeSong.value = false
        }
    }
    playerStore.lyricLoading = true
    const clearLoading = () => { playerStore.lyricLoading = false }
    // 兜底：任何异常都不该让空态一直隐藏
    setTimeout(clearLoading, 6000)
    getLyric(id).then(songLiric => {
        if (songLiric?.lrc?.lyric) {
            applyLyric(songLiric)
            return
        }
        if (id >= 800000000 && userStore.user) {
            getCloudLyric({ uid: userStore.user.userId, sid: id }).then(res => {
                const lrc = res?.data?.lyric || res?.lyric || ''
                if (lrc) {
                    applyLyric({ lrc: { lyric: lrc } })
                } else {
                    applyLyric(songLiric)
                    completeMissingLyric(curSong, id, false, token)
                }
            }).catch(() => {
                applyLyric(songLiric)
                completeMissingLyric(curSong, id, false, token)
            })
        } else {
            applyLyric(songLiric)
            completeMissingLyric(curSong, id, false, token)
        }
    }).catch(() => {
        completeMissingLyric(curSong, id, false, token)
    })
}

/** 主进程 IPC 直连 UNM 兜底：无 URL / 仅试听 / 请求失败时调用 */
async function tryUnblockFallback(id) {
    try {
        const song = (songList.value || [])[currentIndex.value]
        if (song && song.name) {
            console.log(`[unblock] Trying IPC fallback for: ${song.name} (id=${id})`)
            return await windowApi.unblockSongUrl({
                id,
                name: song.name,
                artist: song.ar ? song.ar.map(a => a.name).join('/') : '',
                album: song.al ? song.al.name : '',
                duration: song.dt || 0,
            })
        }
    } catch (e) {
        console.error('[unblock] IPC fallback error:', e)
    }
    return null
}

/** 探测音频体积（字节，失败返回 null）：用于在试听片段与替代音源之间择优 */
async function probeAudioSize(url) {
    try {
        const options = { headers: { Range: 'bytes=0-1' } }
        if (typeof AbortSignal !== 'undefined' && AbortSignal.timeout) options.signal = AbortSignal.timeout(4000)
        const res = await fetch(url, options)
        const range = res.headers.get('content-range')
        if (range && range.includes('/')) {
            const total = Number(range.split('/').pop())
            if (Number.isFinite(total) && total > 0) return total
        }
        const len = Number(res.headers.get('content-length'))
        return Number.isFinite(len) && len > 0 ? len : null
    } catch (_) {
        return null
    }
}

/** 处理 /song/url/v1 结果：完整音源直接播放；空 URL / 仅试听则尝试 UNM 兜底 */
async function playBySongInfo(songInfo, id, autoplay, unblockOn) {
    const info = songInfo?.data?.[0]
    const isTrial = !!info?.freeTrialInfo
    if (info?.url && !isTrial) {
        play(info.url, autoplay)
        setSongLevel(info.level)
        return
    }
    if (!unblockOn) {
        skipUnplayable(isTrial ? '该歌曲仅支持试听' : '当前歌曲无法播放')
        return
    }
    if (isTrial) noticeOpen('该歌曲仅可试听 30 秒，正在尝试其他音源', 2)
    const fallbackUrl = await tryUnblockFallback(id)
    if (fallbackUrl) {
        if (!isTrial) {
            play(fallbackUrl, autoplay)
            return
        }
        // 试听场景：替代音源若明显偏小（部分源只给十几秒片段），不如保留 30 秒试听
        const fallbackSize = await probeAudioSize(fallbackUrl)
        if (fallbackSize != null && fallbackSize < 500 * 1024) {
            play(info.url, autoplay)
            setSongLevel(info.level)
            return
        }
        play(fallbackUrl, autoplay)
        return
    }
    if (isTrial && info.url) {
        // 兜底失败时仍播放试听片段，避免直接跳过
        play(info.url, autoplay)
        setSongLevel(info.level)
    } else {
        skipUnplayable('当前歌曲无法播放')
    }
}

export async function getSongUrl(id, index, autoplay, isLocal) {
    const cur = (songList.value || [])[currentIndex.value]
    // 切歌瞬间先清空歌词：否则新歌取址/取歌词期间会一直显示上一首的歌词，
    // 与已更新的封面/歌名错位（快速连点下一首时尤其明显）。
    // 同一首歌的重复调用（预取/重试）不再清空，避免把刚拿到的歌词又抹掉。
    const lyricKey = String(id) + ':' + String(index)
    if (lyricKey !== lastLyricKey) {
        lastLyricKey = lyricKey
        lyricToken += 1
        lyric.value = null
        lyricsObjArr.value = null
        playerStore.lyricLoading = true
    }
    initScrobble(cur)
    if(cur) windowApi.setWindowTile(cur.name + " - " + (cur.ar?.[0]?.name || ''))
    if(isLocal) {
        windowApi.getLocalMusicImage(songList.value[currentIndex.value].url).then(base64 => {
            localBase64Img.value = base64
            setSongToWindows()
        })
        play(songList.value[currentIndex.value].url, autoplay)
        // 加载本地歌词（令牌防止快速跳过时后到的结果覆盖当前歌）
        const localToken = ++lyricToken
        playerStore.lyricLoading = true
        const localLyric = await getLocalLyric(songList.value[currentIndex.value].url)
        if(localLyric) {
            lyric.value = { lrc: { lyric: localLyric } }
        } else {
            lyric.value = null
            lyricsObjArr.value = null
            // 本地文件通常没有内嵌/sidecar 歌词，强制补全一次（内部有去重与 2s 冷却）
            completeMissingLyric(cur, id, true, localToken).finally(() => { playerStore.lyricLoading = false })
        }
        if(!lyricShow.value && !widgetState.value) {
            lyricShow.value = true
            playerChangeSong.value = false
        }
        return
    }
    setSongToWindows()
    const unblockOn = await windowApi.getSettings().then(s => s?.unblock?.enabled !== false).catch(() => true)
    // 不再用 check/music 决定分支（VIP 曲同样返回 success，导致拿不到完整 URL 时不会尝试解灰），统一以 URL 结果为准
    getMusicUrl(id, quality.value).then(songInfo => {
        playBySongInfo(songInfo, id, autoplay, unblockOn)
    }).catch(async (err) => {
        const risk = err?._riskBlocked || err?.code === -460 || err?.response?.data?.code === -460
        if (risk) { pauseForRisk(); return }
        // 请求失败同样尝试 IPC 兜底
        const fallbackUrl = unblockOn ? await tryUnblockFallback(id) : null
        if (fallbackUrl) play(fallbackUrl, autoplay)
        else skipUnplayable('当前歌曲无法播放')
    })
    loadLyric(id, cur)
}

export function startMusic() {
    if(!currentMusic.value) {
        // 当前没有可用音源（加载失败/风控暂停）：先重试当前这首，
        // 用户点播放的意图是「继续这一首」，不应该直接跳到下一首
        const cur = (songList.value || [])[currentIndex.value]
        if (cur) {
            getSongUrl(cur.id, currentIndex.value, true, cur.type === 'local')
        } else if(songList.value && songList.value.length) {
            playNext()
        }
        return
    }
    if(playMode.value == 0 && currentIndex.value == songList.value.length - 1 && playModeOne && currentMusic.value.seek() == 0) {playNext();playModeOne = false;return}
    if(!playing.value) {
        currentMusic.value.play()
    }
    if(lyricShow.value) {
        isLyricDelay.value = false
        const forbidDelayTimer =  setTimeout(() => {
            isLyricDelay.value = true
            clearTimeout(forbidDelayTimer)
        }, 700);
    }
    if(videoIsPlaying.value) {
        musicVideoDOM.value.play()
        if (currentMusicVideo.value && (currentMusicVideo.value.streamBaseUrl || currentMusicVideo.value.path)) {
            startLocalMusicVideo()
        }
    }
}
export function pauseMusic() {
    clearInterval(musicProgress)
    if(currentMusic.value && playing.value) {
        currentMusic.value.fade(volume.value,0,200)
        currentMusic.value.once('fade', () => {
            currentMusic.value.pause()
            playing.value = false
        })
    }
    if(videoIsPlaying.value) {
        musicVideoDOM.value.pause()
        if (videoCheckInterval) {
            clearInterval(videoCheckInterval)
            videoCheckInterval = null
        }
    }
}

export function playLast() {
    if(!songList.value || !songList.value.length) return
    if(playMode.value == 3 && (!shuffledList.value || !shuffledList.value.length)) return
    let id = null
    let index = null
    if(playMode.value != 3) {
        if(currentIndex.value - 1 < 0) {
            index = songList.value.length - 1
            id = songList.value[index].id
        } else {
            id = songList.value[currentIndex.value - 1].id
            index = currentIndex.value - 1
        }
    }
    if(playMode.value == 3) {
        if(shuffleIndex.value - 1 < 0) {
            index = shuffledList.value.length - 1
            id = shuffledList.value[index].id
        } else {
            index = shuffleIndex.value - 1
            id = shuffledList.value[index].id
        }
    }
    addSong(id, index, true)
}
export function playNext() {
    if(!songList.value || !songList.value.length) return
    if(playMode.value == 3 && (!shuffledList.value || !shuffledList.value.length)) return
    let id = null
    let index = null
    if(playMode.value != 3) {
        if(songList.value.length - 1 == currentIndex.value) {
            index = 0
            id = songList.value[index].id
        } else {
            index = currentIndex.value + 1
            id = songList.value[index].id
        }
    }
    if(playMode.value == 3) {
        if(shuffleIndex.value == shuffledList.value.length - 1) {
            index = 0
            id = shuffledList.value[index].id
        } else {
            index = shuffleIndex.value + 1
            id = shuffledList.value[index].id
        }
    }
    addSong(id, index, true)
}
const clearLycAnimation = () => {
    isLyricDelay.value = false
    for (let i = 0; i < lyricEle.value.length; i++) {
      lyricEle.value[i].style.transitionDelay = 0 + 's'
      if(lyricBlur.value) lyricEle.value[i].firstChild.style.setProperty("filter", "blur(0)");
    }
    const forbidDelayTimer =  setTimeout(() => {
        isLyricDelay.value = true
        clearTimeout(forbidDelayTimer)
    }, 600);
  }
export function changeProgress(toTime) {
    if(!widgetState.value && lyricShow.value && lyricEle.value) clearLycAnimation()
    if(videoIsPlaying.value) {
        musicVideoCheck(toTime, true)
    }
    progress.value = toTime
    if(currentMusic.value) currentMusic.value.seek(toTime)
}
//控制拖拽进度条
export function changeProgressByDragStart() {
    clearInterval(musicProgress)
}
export function changeProgressByDragEnd(toTime) {
    changeProgress(toTime)
    if(playing.value) startProgress()
}
// ------------
export function changePlayMode() {
    if(playMode.value != 3) playMode.value += 1
    else playMode.value = 0

    if(currentMusic.value) {
        if(playMode.value == 2) currentMusic.value.loop(true)
        else currentMusic.value.loop(false)
    }
    if(playMode.value == 3) {
        setShuffledList()
    } else {
        shuffledList.value = null
        shuffleIndex.value = null
    }
    windowApi.changeTrayMusicPlaymode(playMode.value)
}

export function playAll(listType, list) {
    if(!list || !list.length) {
        noticeOpen('列表为空', 2)
        return
    }
    if(playMode.value == 3) {
        addToList(listType, list)
        setShuffledList(true)
        addSong(shuffledList.value[0].id, 0, true)
    } else {
        addToList(listType, list)
        addSong(songList.value[0].id, 0, true)
    }
}

export function setShuffledList(isplayAll) { 
    shuffledList.value = shuffle(songList.value, isplayAll)
    shuffleIndex.value = 0
 }

function shuffle(arr, isplayAll) { // 随机打乱数组
    let _arr = arr.slice() // 调用数组副本，不改变原数组
    for (let i = 0; i < _arr.length; i++) {
      let j = getRandomInt(0, i)
      let t = _arr[i]
      _arr[i] = _arr[j]
      _arr[j] = t
    }
    if(!isplayAll) {
        let currentSongIndex = (_arr || []).findIndex((song) => song.id === songId.value) //在打乱的列表中找到当前播放歌曲删除并添加至队列顶部
        if(currentSongIndex != -1) _arr.splice(currentSongIndex, 1)
        const cur = (songList.value || [])[currentIndex.value]
        if(cur) _arr.unshift(cur)
    }
    return _arr
  }
function getRandomInt(min, max) { // 获取min到max的一个随机数，包含min和max本身
    return Math.floor(Math.random() * (max - min + 1) + min)
}

export function likeSong(like, targetId) {
    // 支持指定歌曲（如心动页对 FM 当前曲点赞），缺省时作用于全局正在播放的歌
    const target = targetId ?? songId.value
    likeMusic(target, like).then(result => {
        if(result.code == 200) {
            getLikelist(userStore.user.userId).then(res => {
                userStore.likelist = res.ids
            }).catch(() => {})
            otherStore.addPlaylistShow = false
            libraryStore.needTimestamp.push('/playlist/detail')
            libraryStore.needTimestamp.push('/playlist/track/all')
            setTimeout(() => {
                libraryStore.needTimestamp = libraryStore.needTimestamp.filter(t => t !== '/playlist/detail' && t !== '/playlist/track/all')
            }, 130000)
            if(libraryStore.listType1 == 0 && libraryStore.listType2 == 0) {
                document.getElementById('myPlaylist')?.click()
            }
        } else {
            noticeOpen("喜欢/取消喜欢 音乐失败！", 2)
        }
    }).catch(() => {
        noticeOpen("喜欢/取消喜欢 音乐失败！", 2)
    })
}

export function addToNext(nextSong, autoplay) {
    if(!songList.value) songList.value = []
    if(nextSong.id == songId.value) return

    const si = (songList.value || []).findIndex((song) => song.id === nextSong.id)
    if(si != -1) {
        songList.value.splice(si, 1)
        if(si < currentIndex.value) currentIndex.value--
    }
    songList.value.splice(currentIndex.value == null ? 0 : currentIndex.value + 1, 0, nextSong)

    if(playMode.value == 3 && shuffledList.value) {
        const shufflei = (shuffledList.value || []).findIndex((song) => song.id === nextSong.id)
        if(shufflei != -1) {
            shuffledList.value.splice(shufflei, 1)
            // 与随机队列的游标比较（原实现误用 currentIndex，会破坏随机队列顺序）
            if(shufflei < shuffleIndex.value) shuffleIndex.value--
        }
        shuffledList.value.splice((shuffleIndex.value == null ? -1 : shuffleIndex.value) + 1, 0, nextSong)
    }
    if(autoplay) playNext()
    else noticeOpen('已添加至下一首', 2)
    if(songList.value.length == 1) addSong(nextSong.id, 0, autoplay)
}
export function addToNextLocal(song, autoplay) {
    addToNext(localMusicHandle([song], true), autoplay)
}
export function savePlaylist() {
    let list = {
        songList: songList.value,
        shuffledList: shuffledList.value
    }
    windowApi.saveLastPlaylist(JSON.stringify(list))
}
export function songTime(dt) {
    dayjs.extend(duration)
    if(dt) {
        if ( dt == 0 || dt == "--") return dt;
        const day = dayjs.duration(dt)
        let str = "";
        if (day.hours() > 0) {
            str += day.hours() + ':' + day.minutes().toString().padStart(2, '0') + ':'
        } else {
            str += day.minutes() + ':'
        }
        str += day.seconds().toString().padStart(2, '0')
        return str;
    }
}
export function songTime2(time) {
    let min = Math.floor(time / 60)
    let sec = Math.floor(time % 60)
    if(sec == 60) {
        sec = 0
        min++
    }
    if(min < 10) min = '0' + min
    if(sec < 10) sec = '0' + sec
    return min + ':' + sec
}
// 睡眠定时器：倒计时结束后淡出并暂停
let sleepTimer = null
let sleepDeadline = null
export function setSleepTimer(minutes) {
    clearTimeout(sleepTimer)
    if (!minutes) {
        sleepDeadline = null
        noticeOpen('睡眠定时已取消', 2)
        return
    }
    sleepDeadline = Date.now() + minutes * 60 * 1000
    noticeOpen(`将在 ${minutes} 分钟后停止播放`, 2)
    sleepTimer = setTimeout(() => {
        sleepDeadline = null
        if (currentMusic.value && playing.value) {
            currentMusic.value.fade(volume.value, 0, 3000)
            setTimeout(() => {
                pauseMusic()
                if (currentMusic.value) currentMusic.value.volume(volume.value)
            }, 3200)
        }
        noticeOpen('睡眠定时已到，停止播放', 2)
    }, minutes * 60 * 1000)
}
export function cancelSleepTimer() {
    clearTimeout(sleepTimer)
    sleepDeadline = null
}
export function sleepTimerRemain() {
    return sleepDeadline ? Math.max(0, sleepDeadline - Date.now()) : null
}

/**
 * 音乐视频监测
 */
export function musicVideoCheck(seek, update) {
    if (playerStore.webHomeSplitEmbed) {
        if (videoIsPlaying.value) {
            videoIsPlaying.value = false
            playerShow.value = true
        }
        currentTiming = null
        try {
            musicVideoDOM.value?.pause()
        } catch (_) {}
        return
    }
    if(musicVideo.value && currentMusicVideo.value && !videoIsPlaying.value || update) {
        for (let i = 0; i < currentMusicVideo.value.timing.length; i++) {
            if(seek >= currentMusicVideo.value.timing[i].start && seek < currentMusicVideo.value.timing[i].end) {
                if(playing.value) musicVideoDOM.value.play()
                const vt = currentMusicVideo.value.timing[i].videoTiming + seek - currentMusicVideo.value.timing[i].start
                musicVideoDOM.value.currentTime = vt
                if(Math.abs(musicVideoDOM.value.currentTime - vt) > 1) return
                currentTiming = currentMusicVideo.value.timing[i]
                if (playing.value) videoIsPlaying.value = true
                // 仅迷你条模式下自动「切到视频层」；全屏播放器 (!widgetState) 下勿收起，否则封面进入播放页后会被立刻加上 player-hide
                // 仅在歌曲实际播放时才隐藏搜索栏，避免初始化时 seek=0 导致标题被 title-player 覆盖
                if (!update && widgetState.value && playing.value) playerShow.value = false
                return
            }
        }
        videoIsPlaying.value = false
        playerShow.value = true
        musicVideoDOM.value.pause()
    } else if(videoIsPlaying.value && currentTiming) {
        if(seek > currentTiming.end) {
            videoIsPlaying.value = false
            playerShow.value = true
            currentTiming = null
        }
    }
}


window.addEventListener('mousedown', (e) => {
    // 仅响应主键（左键）：侧键等非主键按下不进入进度条拖动
    if(e.button !== 0) return
    // 语义命中：统一识别进度条黑区/白区/头部，不再依赖 DOM 层级巧合
    if(e.target?.closest?.('#widget-progress')) {
      changeProgressByDragStart()
      isProgress = true
    }
})

window.addEventListener('mouseup', (e) => {
  if(e.button !== 0) return
  if(isProgress) {
      changeProgressByDragEnd(progress.value)
      isProgress = false
  }
})

// 拖拽中窗口失焦（如指针在窗口外松开）会丢失 mouseup：兜底结束拖拽并恢复进度刷新，避免进度停在旧值后被误 seek
window.addEventListener('blur', () => {
  if(!isProgress) return
  isProgress = false
  if(playing.value) startProgress()
})

window.addEventListener('click', (e) => {
  // 目标控件可能尚未渲染，统一做存在性判断
  const contains = (cls) => {
    const el = document.getElementsByClassName(cls)[0]
    return el ? el.contains(e.target) : false
  }
  if(playlistWidgetShow.value) {
      if(!contains('playlist-widget') && !contains('music-control') && !contains('music-other') && !contains('playlist-widget-player') && !contains('song-control') && !contains('contextMune') && e.target.className?.baseVal != 'item-delete')
        playlistWidgetShow.value = false
  }
  if(otherStore.contextMenuShow) otherStore.contextMenuShow = false
  const videoPlayer = document.getElementById('videoPlayer')
  if(!otherStore.videoIsBlur && otherStore.videoPlayerShow && videoPlayer && !videoPlayer.contains(e.target)) otherStore.videoIsBlur = true
  else if(otherStore.videoIsBlur && otherStore.videoPlayerShow && videoPlayer?.contains(e.target) && !contains('plyr__controls')) otherStore.videoIsBlur = false
  const userHead = document.getElementsByClassName('user-head')[0]
  if(userStore.appOptionShow && userHead && !userHead.contains(e.target)) userStore.appOptionShow = false
})
windowApi.playOrPauseMusic((event) => {
    if(playing.value) pauseMusic()
    else startMusic()
})
windowApi.lastOrNextMusic((event, option) => {
    if(option == 'last') playLast()
    else if(option == 'next') playNext()
})
windowApi.changeMusicPlaymode((event, mode) => {
    if(playMode.value != mode) playMode.value = mode
    if(currentMusic.value) {
        if(playMode.value == 2) currentMusic.value.loop(true)
        else currentMusic.value.loop(false)
    }
    if(playMode.value == 3) {
        setShuffledList()
    } else {
        shuffledList.value = null
        shuffleIndex.value = null
    }
})
windowApi.volumeUp(() => {
    if(volume.value + 0.1 < 1) volume.value += 0.1
    else volume.value = 1
    if(currentMusic.value) currentMusic.value.volume(volume.value)
})
windowApi.volumeDown(() => {
    if(volume.value - 0.1 > 0) volume.value -= 0.1
    else volume.value = 0
    if(currentMusic.value) currentMusic.value.volume(volume.value)
})
windowApi.musicProcessControl((event, mode) => {
    if(!currentMusic.value) return
    if(mode == 'forward') {
        if(progress.value + 3 < currentMusic.value.duration()) progress.value += 3
        else progress.value = currentMusic.value.duration()
    } else if(mode == 'back') {
        if(progress.value - 3 > 0) progress.value -= 3
        else progress.value = 0
    }
    if(videoIsPlaying.value) {
        musicVideoCheck(progress.value, true)
    }
    currentMusic.value.seek(progress.value)
})
windowApi.playOrPauseMusicCheck(playing.value)
windowApi.changeTrayMusicPlaymode(playMode.value)
windowApi.beforeQuit(() => {
    //关闭之前清除下载管理中的状态
    windowApi.downloadPause('shutdown')
    let list = {
        songList: songList.value,
        shuffledList: shuffledList.value
    }
    windowApi.exitApp(JSON.stringify(list))
})
if ('mediaSession' in navigator) {
    navigator.mediaSession.setActionHandler('previoustrack', () => {
      playLast()
    });
    navigator.mediaSession.setActionHandler('nexttrack', () => {
      playNext()
    });
    navigator.mediaSession.setActionHandler('play', () => {
       startMusic();
    });
    navigator.mediaSession.setActionHandler('pause', () => {
      pauseMusic()
    });
}