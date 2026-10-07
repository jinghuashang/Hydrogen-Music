<script setup>
import { ref, computed, onMounted, onUnmounted, onActivated, watch, nextTick } from 'vue'
import VueSlider from 'vue-slider-component'
import '../assets/css/slider.css'
import { getPersonalFM, getLyric, fmTrash } from '../api/song'
import SleepTimer from '../components/SleepTimer.vue'
import { addToList, addSong, pauseMusic, startMusic, changeProgress, changeProgressByDragStart, changeProgressByDragEnd, likeSong, songTime2 } from '../utils/player'
import { noticeOpen } from '../utils/dialog'
import { usePlayerStore } from '../store/playerStore'
import { useUserStore } from '../store/userStore'
import { storeToRefs } from 'pinia'

const playerStore = usePlayerStore()
const userStore = useUserStore()
const { progress, playing, time, songId, volume, currentMusic } = storeToRefs(playerStore)

// 心动页隐藏了底部 DOCK，音量调节需在本页直接作用于播放实例
watch(() => volume.value, () => {
  if (currentMusic.value) currentMusic.value.volume(volume.value)
})

const fmSongs = ref([])
const fmHistory = ref([])
const fmIndex = ref(0)
const loading = ref(false)

const currentFmSong = computed(() => fmSongs.value[fmIndex.value] || null)

function normSong(s) {
  if (!s || typeof s !== 'object') return s
  const ar = s.ar || (s.artists || []).map(a => typeof a === 'object' ? a : { id: 0, name: a })
  const al = (s.al && typeof s.al === 'object' && !Array.isArray(s.al)) ? s.al
    : (s.album && typeof s.album === 'object') ? s.album : {}
  return {
    ...s,
    ar: ar.length ? ar : [{ id: 0, name: '' }],
    // FM 接口部分返回用 duration 而非 dt 表示时长，统一映射
    dt: s.dt || s.duration || 0,
    al: {
      id: al.id || s.album?.id || (typeof s.al === 'number' ? s.al : 0),
      name: al.name || s.album?.name || '',
      picUrl: al.picUrl || al.blurPicUrl || al.coverImgUrl || s.album?.picUrl || s.album?.blurPicUrl || s.picUrl || s.coverUrl || '',
    },
  }
}

function getCoverUrl(song) {
  const raw = song?.al?.picUrl || song?.picUrl || ''
  if (!raw) return ''
  if (raw.startsWith('data:')) return raw
  const base = raw.split('?')[0]
  return base ? `${base}?param=1024y1024` : raw
}
function getArtistNames(ar) { return ar?.length ? ar.map(a => a?.name || a).join(' / ') : '' }

// 歌词解析
const lyricLines = ref([])
const currentLyricIdx = ref(-1)
// 罗马音/拼音（ABC 按钮）与 翻译（译 按钮）显示开关，与主歌词页同款；原文始终显示
const showRoma = ref(true)
const showTrans = ref(true)

function parseLyric(raw) {
  const re = /\[(\d{2}):(\d{2})\.(\d{2,3})\]/g
  const lines = []
  let m
  while ((m = re.exec(raw)) !== null) {
    const t = parseInt(m[1]) * 60 + parseInt(m[2]) + (m[3].length === 2 ? parseInt(m[3]) * 10 : parseInt(m[3])) / 1000
    const end = m.index + m[0].length
    const rest = raw.substring(end)
    const next = rest.search(/\[/)
    const text = (next === -1 ? rest : rest.substring(0, next)).trim()
    // 跳过空文本行，避免黑色高亮条落在空白处
    if (!text) continue
    lines.push({ time: t, text })
  }
  return lines
}

function syncLyric(seek) {
  if (!lyricLines.value.length) return
  let idx = -1
  for (let i = 0; i < lyricLines.value.length; i++) {
    if (seek >= lyricLines.value[i].time) idx = i
    else break
  }
  if (idx !== currentLyricIdx.value) {
    currentLyricIdx.value = idx
  }
}

watch(() => playerStore.progress, (v) => {
  if (playerStore.songId === currentFmSong.value?.id) syncLyric(v)
})

watch(currentFmSong, (s) => {
  currentLyricIdx.value = -1
  lyricLines.value = []
  if (s) loadFmLyric(s.id)
})

// 全局播放器自动切歌（歌曲播完/快捷键切歌）时，同步本页展示的 FM 歌曲，
// 避免"页面还显示上一首、下一首已经开始播放"的脱节
watch(songId, async (id) => {
  if (!id) return
  const idx = fmSongs.value.findIndex(s => s.id === id)
  if (idx === -1) return
  if (idx !== fmIndex.value) {
    const prev = fmSongs.value[fmIndex.value]
    if (prev && prev.id !== id) fmHistory.value.push(prev)
    fmIndex.value = idx
  }
  if (fmIndex.value >= fmSongs.value.length - 2) {
    await fetchMoreFmSongs()
  }
})

// 复刻全屏歌词页效果：整条歌词轨道随进度上滚，离当前行越远越模糊，切换按距离级联延迟
const lyricViewport = ref(null)
const trackOffset = ref(0)

function lyricLineStyle(idx) {
  const anchor = currentLyricIdx.value < 0 ? 0 : currentLyricIdx.value
  const style = { '--d': (Math.min(Math.abs(idx - anchor), 6) * 0.04) + 's' }
  if (currentLyricIdx.value < 0) return style
  const distance = Math.abs(idx - currentLyricIdx.value)
  style.filter = distance === 0 ? 'blur(0px)' : `blur(${Math.min(distance * 0.55, 2.2)}px)`
  return style
}

function updateTrackOffset() {
  const vp = lyricViewport.value
  // keep-alive 切走时组件脱离文档，clientHeight/offsetTop 全为 0，此时不测量（保留上次的有效偏移）
  if (!vp || !vp.isConnected) return
  if (currentLyricIdx.value < 0) {
    trackOffset.value = 0
    return
  }
  const active = vp.querySelector('.lyric-line.on')
  if (!active) {
    trackOffset.value = 0
    return
  }
  // 活动行停靠在视口约 38% 高度处（黑条大致居中偏上）
  const anchor = vp.clientHeight * 0.38
  trackOffset.value = anchor - (active.offsetTop + active.offsetHeight / 2)
}

watch(currentLyricIdx, () => nextTick(updateTrackOffset))
watch(lyricLines, () => nextTick(updateTrackOffset))
// keep-alive 切回页面时组件重新挂载到文档，重新校准滚动位置（期间行号未变不会触发上面的 watch）
onActivated(() => nextTick(updateTrackOffset))

async function loadFmSongs() {
  if (loading.value) return
  loading.value = true
  try {
    const res = await getPersonalFM()
    if (res.code === 200 && res.data?.length) {
      fmSongs.value = res.data.map(normSong)
      fmIndex.value = 0
    } else {
      noticeOpen('获取私人FM失败', 2)
    }
  } catch (_) { noticeOpen('获取私人FM失败', 2) }
  loading.value = false
}

async function loadFmLyric(id) {
  try {
    const res = await getLyric(id)
    const lines = parseLyric(res?.lrc?.lyric || '')
    const trans = parseLyric(res?.tlyric?.lyric || '')
    const roma = parseLyric(res?.romalrc?.lyric || '')
    // 网易云逐句翻译/罗马音时间戳与原文一致，按就近匹配（0.5s 内）合并到对应行
    if (trans.length) {
      for (const line of lines) {
        const t = trans.find(tr => Math.abs(tr.time - line.time) < 0.5)
        if (t) line.ttext = t.text
      }
    }
    if (roma.length) {
      for (const line of lines) {
        const r = roma.find(rr => Math.abs(rr.time - line.time) < 0.5)
        if (r) line.rtext = r.text
      }
    }
    lyricLines.value = lines
  } catch (_) { lyricLines.value = [] }
}

function playCurrentFm() {
  const song = currentFmSong.value
  if (!song) return
  const list = fmSongs.value.slice(fmIndex.value)
  addToList('heartbeat', list)
  addSong(song.id, 0, true)
}

function togglePlayFm() {
  if (playing.value && isFmPlaying.value) {
    pauseMusic()
  } else if (!playing.value && isFmPlaying.value && currentMusic.value) {
    startMusic()
  } else {
    playCurrentFm()
  }
}

async function fetchMoreFmSongs() {
  if (loading.value) return
  try {
    const res = await getPersonalFM()
    if (res.code === 200 && res.data?.length) {
      const newSongs = res.data.map(normSong).filter(s => !fmSongs.value.some(existing => existing.id === s.id))
      if (newSongs.length) {
        fmSongs.value.push(...newSongs)
        if (playerStore.listInfo?.type === 'heartbeat' && playerStore.songList) {
          playerStore.songList.push(...newSongs)
        }
      }
    }
  } catch (e) {
    console.warn('[Heartbeat] 预拉取下一批FM失败:', e)
  }
}

async function nextFm() {
  if (currentFmSong.value) fmHistory.value.push(currentFmSong.value)
  if (fmIndex.value < fmSongs.value.length - 1) {
    fmIndex.value++
    playCurrentFm()
    if (fmIndex.value >= fmSongs.value.length - 2) {
      fetchMoreFmSongs()
    }
  } else {
    loading.value = true
    try {
      const res = await getPersonalFM()
      if (res.code === 200 && res.data?.length) {
        const newSongs = res.data.map(normSong).filter(s => !fmSongs.value.some(existing => existing.id === s.id))
        if (newSongs.length) {
          fmSongs.value.push(...newSongs)
          fmIndex.value++
          playCurrentFm()
        } else {
          fmSongs.value = res.data.map(normSong)
          fmIndex.value = 0
          playCurrentFm()
        }
      }
    } finally {
      loading.value = false
    }
  }
}

function prevFm() {
  if (fmHistory.value.length > 0) {
    const prev = fmHistory.value.pop()
    fmSongs.value = [prev, ...fmSongs.value.slice(fmIndex.value)]
    fmIndex.value = 0
    playCurrentFm()
  }
}

// 不感兴趣：移入 FM 垃圾桶并自动切下一首
function trashCurrent() {
  const song = currentFmSong.value
  if (!song) return
  fmTrash(song.id).then(() => {
    noticeOpen('已加入不感兴趣，将不再推荐', 2)
    nextFm()
  }).catch(() => {
    noticeOpen('操作失败，跳过当前歌曲', 2)
    nextFm()
  })
}

// 进度条：点击/拖拽定位（仅当 FM 歌曲是正在播放的歌时可用）
const progressEl = ref(null)
let seeking = false
const seekProgress = ref(0)

const isFmPlaying = computed(() => songId.value === currentFmSong.value?.id)
const displayProgress = computed(() => {
  if (seeking) return seekProgress.value
  return isFmPlaying.value ? (progress.value || 0) : 0
})
const displayTime = computed(() => {
  if (isFmPlaying.value && time.value) return time.value
  return Math.floor((currentFmSong.value?.dt || currentFmSong.value?.duration || 0) / 1000)
})
const progressPct = computed(() => {
  if (!displayTime.value || displayTime.value <= 0) return 0
  return Math.min(100, (displayProgress.value / displayTime.value) * 100)
})

function getSeekTimeFromEvent(e) {
  const el = progressEl.value
  const total = displayTime.value || time.value
  if (!el || !total) return 0
  const rect = el.getBoundingClientRect()
  const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width))
  return ratio * total
}

function onSeekDown(e) {
  // 仅左键开始拖拽定位：侧键/中键/右键若触发，会在指针松开时把播放位置 seek 到鼠标处造成倒退
  if (e.button !== 0) return
  if (!isFmPlaying.value || !displayTime.value) return
  seeking = true
  changeProgressByDragStart()
  const targetTime = getSeekTimeFromEvent(e)
  seekProgress.value = targetTime
  window.addEventListener('pointermove', onSeekMove)
  window.addEventListener('pointerup', onSeekUp)
}

function onSeekMove(e) {
  if (seeking) {
    seekProgress.value = getSeekTimeFromEvent(e)
  }
}

function onSeekUp(e) {
  if (e.button !== 0) return
  if (!seeking) return
  seeking = false
  const targetTime = getSeekTimeFromEvent(e)
  seekProgress.value = targetTime
  changeProgressByDragEnd(targetTime)
  window.removeEventListener('pointermove', onSeekMove)
  window.removeEventListener('pointerup', onSeekUp)
}

// 喜欢（与全局播放器一致，作用于正在播放的这首歌）
const checkIsLike = computed(() => (id) => userStore.likelist.includes(id))

onMounted(() => {
  loadFmSongs()
  window.addEventListener('resize', updateTrackOffset)
})
onUnmounted(() => {
  window.removeEventListener('pointermove', onSeekMove)
  window.removeEventListener('pointerup', onSeekUp)
  window.removeEventListener('resize', updateTrackOffset)
})
</script>

<template>
  <div class="heartbeat-page">
    <!-- 加载/空状态：声波动画 -->
    <div class="fm-loading" v-if="!currentFmSong">
      <div class="eq"><span v-for="i in 7" :key="i"></span></div>
      <div class="loading-text">{{ loading ? 'LOADING' : 'FM EMPTY' }}</div>
    </div>

    <div class="fm-player" v-else>
      <!-- 页头：标签 + 点线 + 序号 -->
      <div class="fm-head">
        <span class="fm-tag">HEARTBEAT<i>/</i>私人FM</span>
        <span class="fm-dots"></span>
        <span class="fm-count">FM·{{ fmIndex + 1 }}</span>
      </div>

      <div class="fm-main">
        <!-- 左：大封面 -->
        <div class="fm-left">
          <div class="fm-cover">
            <span class="corner c1"></span><span class="corner c2"></span>
            <span class="corner c3"></span><span class="corner c4"></span>
            <Transition name="fm-fade" mode="out-in">
              <img :key="currentFmSong.id" :src="getCoverUrl(currentFmSong)" @error="$event.target.style.display='none'" alt="">
            </Transition>
          </div>
        </div>

        <!-- 右：标题 + 滚动歌词 -->
        <div class="fm-right">
          <Transition name="fm-fade" mode="out-in">
            <div class="fm-titles" :key="currentFmSong.id">
              <div class="fm-name">{{ currentFmSong.name }}</div>
              <div class="fm-sub">
                <span class="fm-artist">{{ getArtistNames(currentFmSong.ar) }}</span>
                <span class="fm-album" v-if="currentFmSong.al?.name">{{ currentFmSong.al.name }}</span>
              </div>
            </div>
          </Transition>

          <!-- 歌词显示开关（罗马音 ABC / 翻译 译，与主歌词页同款图标） -->
          <div class="fm-lyric-toolbar">
            <svg @click="showRoma = !showRoma" class="lyric-toggle" :class="{ off: !showRoma }" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024"><path fill="currentColor" d="M927.1 270.6c-19.9 0-36.1-16.2-36.1-36.1V83.7c0-6.2-5.2-11.5-11.5-11.5H144.6c-6.2 0-11.5 5.2-11.5 11.5v150.8c0 20-16.2 36.1-36.1 36.1s-36.1-16.2-36.1-36.1V83.7C60.9 37.5 98.5 0 144.6 0h734.9c46.1 0 83.7 37.5 83.7 83.7v150.8c0.1 20-16.1 36.1-36.1 36.1zM879.6 1024h-735c-46.1 0-83.7-37.5-83.7-83.7V732.7c0-20 16.2-36.1 36.1-36.1s36.1 16.2 36.1 36.1v207.6c0 6.2 5.2 11.5 11.5 11.5h734.9c6.2 0 11.5-5.2 11.5-11.5V732.7c0-20 16.2-36.1 36.1-36.1s36.1 16.2 36.1 36.1v207.6c0.1 46.2-37.5 83.7-83.6 83.7zM302.7 662.9c-7.7 0-14.6-2.4-20.8-7.1-6.2-4.8-10.3-10.8-12.4-18.3L254 579.6c-0.6-2.4-2-3.6-4.4-3.6H147.5c-2.1 0-3.4 1.2-4 3.6l-15.9 57.9c-2.1 7.4-6.1 13.5-12.2 18.3-6 4.8-12.9 7.1-20.6 7.1H79c-6.5 0-11.6-2.7-15.5-8-2.4-3.3-3.5-6.8-3.5-10.7 0-2.1 0.3-4.2 0.9-6.2l91.5-287.8c2.4-7.4 6.6-13.4 12.8-18s13.3-6.9 21.2-6.9H213c7.7 0 14.7 2.3 21 6.9s10.7 10.6 13.1 18L339 638c0.6 2.1 0.9 4.2 0.9 6.2 0 3.9-1.3 7.4-4 10.7-3.8 5.4-8.8 8-15 8h-18.2zM159.9 520.3c-0.3 0.9-0.2 1.7 0.2 2.5 0.4 0.7 1.1 1.1 2 1.1h73c0.9 0 1.6-0.4 2.2-1.1 0.6-0.7 0.7-1.6 0.4-2.5l-9.3-33.4c-3.8-13.4-9.1-33.2-15.9-59.5s-11.2-43-13.3-50.1c0-0.6-0.3-0.9-0.9-0.9-0.6 0-1 0.3-1.3 0.9-8.5 36.2-18 72.8-28.3 109.6l-8.8 33.4zM411.9 662.9c-7.1 0-13.2-2.6-18.3-7.8-5.2-5.2-7.7-11.4-7.7-18.5V351.5c0-7.1 2.6-13.3 7.7-18.5 5.2-5.2 11.3-7.8 18.3-7.8h84.9c80.8 0 121.2 27.8 121.2 83.3 0 15.7-4.1 30.4-12.2 44.1-8.1 13.7-18.8 23.2-32.1 28.5-0.9 0-1.3 0.4-1.3 1.3s0.3 1.3 0.9 1.3c18.9 4.8 33.9 13.8 45.1 27.2 11.2 13.4 16.8 30.9 16.8 52.6 0 32.7-11.9 57.4-35.8 74.2-23.9 16.8-55.1 25.2-93.7 25.2h-93.8z m41.2-203.6c0 2.1 1 3.1 3.1 3.1H492c20.6 0 36-3.9 46-11.6s15-18.6 15-32.5c0-14.5-4.9-25.1-14.8-31.6s-25-9.8-45.3-9.8h-36.7c-2 0-3.1 1-3.1 3.1v79.3z m0 148.4c0 2.1 1 3.1 3.1 3.1h43.3c47.2 0 70.7-17.1 70.7-51.2 0-16.3-5.9-28.2-17.7-35.6-11.8-7.4-29.5-11.1-53.1-11.1h-43.3c-2 0-3.1 1.2-3.1 3.6v91.2h0.1zM830.7 669.1c-21.2 0-41-3.8-59.5-11.4-18.4-7.6-34.6-18.6-48.6-33s-25.1-32.7-33.2-54.8c-8.1-22.1-12.2-47-12.2-74.6 0-27 4.1-51.8 12.4-74.2 8.3-22.4 19.5-41.1 33.8-55.9 14.3-14.9 30.9-26.3 49.7-34.3 18.9-8 38.9-12 60.1-12 28.3 0 54.4 8.8 78.3 26.3 6.5 4.5 9.7 11 9.7 19.6 0 6.5-2.2 12.5-6.6 17.8l-1.8 2.2c-4.4 5.3-10.3 8.3-17.7 8.9h-2.7c-6.2 0-11.8-1.6-16.8-4.9-13-8-26.7-12-41.1-12-25.9 0-47.2 10.5-63.9 31.4s-25 49.2-25 84.9c0 36.5 7.9 65.3 23.7 86.2s37 31.4 63.9 31.4c17.7 0 34.2-5.3 49.5-16 5-3.6 10.7-5.3 17.2-5.3h1.8c7.1 0.3 12.8 3.1 17.2 8.5l1.8 1.8c4.7 5.4 7.1 11.6 7.1 18.7 0 8.3-2.9 14.9-8.8 19.6-24.7 20.8-54.1 31.1-88.3 31.1z"/></svg>
            <svg @click="showTrans = !showTrans" class="lyric-toggle" :class="{ off: !showTrans }" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024"><path fill="currentColor" d="M128 64c-35.345655 0-64 28.654345-64 64v768c0 35.345655 28.654345 64 64 64h768c35.345655 0 64-28.654345 64-64v-768c0-35.345655-28.654345-64-64-64h-768z m0-64h768C966.692487 0 1024 57.307513 1024 128v768C1024 966.692487 966.692487 1024 896 1024h-768C57.307513 1024 0 966.692487 0 896v-768C0 57.307513 57.307513 0 128 0z m329.143025 251.428487h301.715127v68.571513c-18.020046 27.895172-58.368 67.967706-96.000589 96.000589 24.064 8.704 69.777949 13.274336 137.143026 13.71336l-13.714538 68.57269c-63.360883-7.297471-123.483807-31.818152-164.572102-54.858152-43.775411 21.120294-101.211218 41.41668-164.570924 54.856975l-27.429076-68.571513c56.378851-8.492138 100.279025-12.452782 137.143026-27.427898-28.031706-24.960883-54.747513-45.038345-68.571513-82.286051h-41.142437v-68.571513z m114.85749 68.571513c12.288 25.728294 22.271411 41.183632 47.998529 60.000515 31.873471-19.969177 45.072478-35.424515 60.048772-60.000515h-108.047301zM512 512h68.571513v-41.142437h68.556211V512h68.586814v68.571513h-68.586814v41.142436h109.729251v68.57269h-109.729251v109.712772H580.57269v-109.713949h-109.71395v-68.571513h109.71395V580.57269H512V512zM306.285462 223.999411c34.286345 22.113692 81.117278 54.858152 109.713949 82.286051l-54.856974 68.57269c-21.504-26.113177-54.527411-65.665471-95.999412-96.000589l41.142437-54.856974z m137.157149 397.714538v54.856975c-56.437701 53.431614-97.586023 90.002538-123.442611 109.715127l-36.000074-58.28561c10.752-9.600883 22.285536-25.042097 22.285536-37.714979V470.857563h-82.284873v-68.572689h150.857563V662.857563c28.631982-9.103007 51.494253-22.817545 68.584459-41.143614z"/></svg>
          </div>

          <!-- 歌词：整条轨道随进度上滚，当前行停在高亮条处 -->
          <div class="fm-lyric-list" ref="lyricViewport">
            <div class="lyric-track" :style="{ transform: `translateY(${trackOffset}px)` }">
              <p
                v-for="(line, idx) in lyricLines"
                :key="idx"
                class="lyric-line"
                :class="{ on: idx === currentLyricIdx }"
                :style="lyricLineStyle(idx)"
              ><span class="lyric-rtext" v-if="showRoma && line.rtext">{{ line.rtext }}</span><span class="lyric-text">{{ line.text }}</span><span class="lyric-ttext" v-if="showTrans && line.ttext">{{ line.ttext }}</span></p>
            </div>
          </div>
        </div>
      </div>

      <!-- 底部：时间码 + 细进度条 + 音量 + 控制 -->
      <div class="fm-bottom">
        <div class="fm-timecode">{{ songTime2(displayProgress) }} / {{ songTime2(displayTime) }}</div>
        <div class="fm-progress" ref="progressEl" @pointerdown="onSeekDown">
          <div class="fm-progress-line">
            <div class="fm-progress-fill" :style="{ width: progressPct + '%' }"></div>
            <div class="fm-progress-dot" :style="{ left: progressPct + '%' }"></div>
          </div>
        </div>
        <div class="fm-volume">
          <div class="volume-container">
            <vue-slider class="volume-slider" v-model="volume" :min="0" :max="1" :interval="0.01" :duration="0.3" tooltip="none"></vue-slider>
            <div class="volume-info">
              <div class="volume-lable">VOLUME</div>
              <div class="volume-num">{{ Math.round(volume * 100) }}</div>
            </div>
          </div>
        </div>
        <SleepTimer class="fm-sleep"></SleepTimer>
        <div class="fm-controls">
          <!-- 上一首 -->
          <svg @click="prevFm" :class="{ off: fmHistory.length === 0 }" class="ctrl" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="200" height="200" viewBox="0 0 200 200" fill="none"><defs><rect id="p0" x="0" y="0" width="200" height="200"/></defs><g transform="translate(0 0) rotate(0 100 100)"><mask id="m0" fill="white"><use xlink:href="#p0"/></mask><g mask="url(#m0)"><path style="stroke:currentColor;stroke-width:10" transform="translate(35 44) rotate(-90 67 53)" d="M133.6,106L66.8,0L0,106"/></g></g></svg>
          <!-- 暂停 -->
          <svg v-show="playing && isFmPlaying" @click="pauseMusic()" class="ctrl ctrl-play" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="200" height="200" viewBox="0 0 200 200" fill="none"><defs><rect id="p1" x="0" y="0" width="200" height="200"/></defs><g transform="translate(0 0) rotate(0 100 100)"><mask id="m1" fill="white"><use xlink:href="#p1"/></mask><g mask="url(#m1)"><path style="fill:currentColor;stroke:currentColor;stroke-width:8" transform="translate(152 24)" d="M0,0L0,152"/><path style="fill:currentColor;stroke:currentColor;stroke-width:8" transform="translate(48 24)" d="M0,0L0,152"/></g></g></svg>
          <!-- 播放 -->
          <svg v-show="!playing || !isFmPlaying" @click="togglePlayFm" class="ctrl ctrl-play" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="200" height="200" viewBox="0 0 200 200" fill="none"><defs><rect id="p3" x="0" y="0" width="200" height="200"/></defs><g transform="translate(0 0) rotate(0 100 100)"><mask id="m3" fill="white"><use xlink:href="#p3"/></mask><g mask="url(#m3)"><path style="stroke:currentColor;stroke-width:8" transform="translate(0 12) rotate(90 88 88)" d="M11.8,132L164.2,132L88,0L11.8,132Z"/></g></g></svg>
          <!-- 下一首 -->
          <svg @click="nextFm" :class="{ off: loading }" class="ctrl" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="200" height="200" viewBox="0 0 200 200" fill="none"><defs><rect id="p2" x="0" y="0" width="200" height="200"/></defs><g transform="translate(0 0) rotate(0 100 100)"><mask id="m2" fill="white"><use xlink:href="#p2"/></mask><g mask="url(#m2)"><path style="stroke:currentColor;stroke-width:10" transform="translate(35 44) rotate(90 67 53)" d="M133.6,106L66.8,0L0,106"/></g></g></svg>
          <!-- 喜欢：使用 dock 栏同款 UI（未喜欢空心黑，已喜欢红心） -->
          <svg t="1668786418014" v-if="userStore.likelist" @click="likeSong(true, currentFmSong.id)" v-show="!checkIsLike(currentFmSong.id)" class="ctrl ctrl-like" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" p-id="1417" width="200" height="200"><path d="M736.603 35.674c-87.909 0-169.647 44.1-223.447 116.819C459.387 79.756 377.665 35.674 289.708 35.674c-158.47 0-287.397 140.958-287.397 314.233 0 103.371 46.177 175.887 83.296 234.151 107.88 169.236 379.126 379.846 390.616 388.725 11.068 8.557 24.007 12.837 36.917 12.837 12.939 0 25.861-4.28 36.917-12.837 11.503-8.879 282.765-219.488 390.614-388.725C977.808 525.793 1024 453.277 1024 349.907 1023.999 176.632 895.071 35.674 736.603 35.674zM888.196 544.065C785.507 705.207 513.139 915.679 513.139 915.679S240.802 705.206 138.113 544.065C104.912 491.954 63.866 427.172 63.866 349.907c0-137.95 102.327-250.367 225.842-250.367 79.529 0 148.971 46.903 186.757 119.539 7.408 14.241 21.849 22.887 36.674 22.887 14.826 0 29.266-8.646 36.674-22.887 37.786-72.636 107.228-119.539 186.757-119.539 123.515 0 225.842 112.417 225.842 250.367 0 77.265-41.046 142.047-74.247 194.158z" fill="currentColor" p-id="1418"></path></svg>
          <svg t="1668786896650" v-if="userStore.likelist" @click="likeSong(false, currentFmSong.id)" v-show="checkIsLike(currentFmSong.id)" class="ctrl ctrl-like" viewBox="0 0 1025 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" p-id="9975" width="200" height="200"><path d="M1024.549 360.609c0-170.492-133.815-309.265-298.055-309.265-81.129 0-157.91 34.998-213.344 94.701-55.509-59.702-132.367-94.701-213.344-94.701C135.49 51.344 1.751 190.041 1.751 360.609c0 5.719 0.534 10.827 0.991 15.021-0.076 1.373-0.152 2.745-0.152 4.194 0 30.193 7.319 63.361 21.73 98.59 0.458 1.295 0.915 2.516 1.449 3.657 90.812 217.844 440.412 468.474 455.279 479.985 9.227 7.092 20.205 10.6 31.263 10.6 11.209 0 22.266-3.659 31.566-10.903 12.733-9.911 310.941-224.551 429.279-427.603 4.498-6.861 7.854-13.494 10.828-19.976 0.381-0.915 0.763-1.83 1.067-2.668 14.412-35.305 21.731-68.549 21.731-98.742 0-1.449-0.076-2.821-0.152-4.194 0.457-4.194 0.991-9.302 0.991-15.021z" fill="#EC4141" p-id="9976"></path></svg>
          <!-- 不感兴趣：移入 FM 垃圾桶并跳下一首 -->
          <svg @click="trashCurrent()" class="ctrl" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024"><path fill="currentColor" d="M512 64c-70.7 0-128 57.3-128 128H213.3c-47.1 0-85.3 38.2-85.3 85.3h768c0-47.1-38.2-85.3-85.3-85.3H640c0-70.7-57.3-128-128-128z m170.7 298.7v512H341.3v-512h-85.3v512c0 47.1 38.2 85.3 85.3 85.3h341.4c47.1 0 85.3-38.2 85.3-85.3v-512h-85.3z m-277.4 85.3h42.7v341.3h-42.7V448z m128 0h42.7v341.3h-42.7V448z m128 0h42.7v341.3h-42.7V448z"/></svg>
        </div>
      </div>
    </div>

    <!-- 左下角水印 -->
    <div class="fm-watermark">A&nbsp;DAILY&nbsp;MUSIC&nbsp;JOURNEY</div>
  </div>
</template>

<style scoped lang="scss">
/* 与项目统一的浅色语言：白底 + 细黑框 + 黑字细线，保留塞壬唱片的布局结构 */
.heartbeat-page {
  position: relative;
  height: calc(100% - 2.6vh);
  margin-bottom: 2.6vh;
  display: flex;
  flex-direction: column;
  padding: 3vh 3.5vw 4.6vh;
  box-sizing: border-box;
  overflow: hidden;
  color: #1a1a1a;
  border: 1px solid rgba(0, 0, 0, 0.55);
  background:
    radial-gradient(ellipse at 18% 0%, rgba(0, 0, 0, 0.025), transparent 55%),
    repeating-linear-gradient(0deg, transparent 0 46px, rgba(0, 0, 0, 0.022) 46px 47px),
    repeating-linear-gradient(90deg, transparent 0 46px, rgba(0, 0, 0, 0.022) 46px 47px),
    rgba(255, 255, 255, 0.55);
}

/* ---------- 加载/空状态 ---------- */
.fm-player {
  /* 内容容器：撑满面板剩余高度，让主区 flex:1 / 封面 height:100% 有参照 */
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.fm-loading {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2.4vh;
  .eq {
    display: flex;
    align-items: center;
    gap: 6Px;
    height: 4vh;
    span {
      width: 4Px;
      height: 100%;
      background: rgba(26, 26, 26, 0.85);
      animation: eq-bar 0.9s ease-in-out infinite alternate;
      &:nth-child(1) { animation-delay: 0s; }
      &:nth-child(2) { animation-delay: 0.12s; }
      &:nth-child(3) { animation-delay: 0.24s; }
      &:nth-child(4) { animation-delay: 0.36s; }
      &:nth-child(5) { animation-delay: 0.48s; }
      &:nth-child(6) { animation-delay: 0.6s; }
      &:nth-child(7) { animation-delay: 0.72s; }
    }
  }
  .loading-text {
    font-size: 1.6vh; font-weight: bold;
    letter-spacing: 0.6vh;
    color: rgba(26, 26, 26, 0.4);
  }
}
@keyframes eq-bar {
  from { transform: scaleY(0.18); }
  to { transform: scaleY(1); }
}

/* ---------- 页头 ---------- */
.fm-head {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 2vw;
  .fm-tag {
    font-size: 1.8vh; font-weight: bold;
    letter-spacing: 0.35vh;
    color: #1a1a1a;
    white-space: nowrap;
    i { font-style: normal; color: rgba(0, 0, 0, 0.35); margin: 0 0.6vh; }
  }
  .fm-dots {
    flex: 1;
    height: 0;
    border-top: 2Px dotted rgba(0, 0, 0, 0.25);
  }
  .fm-count {
    font-size: 1.6vh; font-weight: bold;
    letter-spacing: 0.3vh;
    color: rgba(26, 26, 26, 0.45);
    white-space: nowrap;
  }
}

/* ---------- 主体两栏（作为一个整体在页面中等比例垂直居中） ---------- */
.fm-main {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 4.5vw;
  min-height: 0;
  padding-top: 2vh;
}

.fm-left {
  flex-shrink: 0;
  align-self: stretch;
  display: flex;
  /* 封面宽度受限（矮窗口）时，在整列中垂直居中 */
  align-items: center;
}

.fm-cover {
  position: relative;
  /* 与右侧栏同一高度公式：高度取"主区高度"与"42vw"的较小值（下限 320px），
     保证任何窗口尺寸下都是正方形且与右侧文字块等高同步缩放 */
  height: clamp(320px, 42vw, 100%);
  aspect-ratio: 1 / 1;
  background: rgba(0, 0, 0, 0.04);
  border: 1px solid rgba(0, 0, 0, 0.35);
  img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }
  .corner {
    width: 1.4vh;
    height: 1.4vh;
    position: absolute;
    z-index: 2;
    border: 0 solid #1a1a1a;
    pointer-events: none;
  }
  .c1 { top: -5Px; left: -5Px; border-top-width: 2Px; border-left-width: 2Px; }
  .c2 { top: -5Px; right: -5Px; border-top-width: 2Px; border-right-width: 2Px; }
  .c3 { bottom: -5Px; right: -5Px; border-bottom-width: 2Px; border-right-width: 2Px; }
  .c4 { bottom: -5Px; left: -5Px; border-bottom-width: 2Px; border-left-width: 2Px; }
}

.fm-right {
  flex: 1;
  min-width: 0;
  /* 与封面同一高度公式：歌名/作者/专辑与封面始终等高、同步居中缩放，
     顶部内边距保证文字起始位置不高于封面最上沿 */
  height: clamp(320px, 42vw, 100%);
  padding-top: 2vh;
  display: flex;
  flex-direction: column;
}

.fm-titles {
  flex-shrink: 0;
  .fm-name {
    text-align: left;
    font-size: 3.8vh; line-height: 1.15; font-weight: bold;
    letter-spacing: 0.12vh;
    color: #1a1a1a;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .fm-sub {
    margin-top: 1.2vh;
    display: flex;
    align-items: baseline;
    overflow: hidden;
    white-space: nowrap;
    text-align: left;
    .fm-artist {
      font-size: 1.9vh; font-weight: bold;
      color: rgba(26, 26, 26, 0.6);
      flex-shrink: 0;
    }
    .fm-album {
      margin-left: 1.6vh;
      font-size: 1.6vh; font-weight: bold;
      color: rgba(26, 26, 26, 0.32);
      overflow: hidden;
      text-overflow: ellipsis;
    }
  }
  &::after {
    content: '';
    display: block;
    margin-top: 2.4vh;
    height: 1Px;
    background: rgba(0, 0, 0, 0.16);
  }
}

  .fm-lyric-toolbar {
    flex-shrink: 0;
    display: flex;
    flex-direction: row;
    justify-content: flex-end;
    align-items: center;
    gap: 1.8vh;
    margin-top: 1.2vh;
    .lyric-toggle {
      width: 2.2vh;
      height: 2.2vh;
      color: #1a1a1a;
      cursor: pointer;
      transition: 0.2s;
      &:hover { opacity: 0.6; }
      &.off { color: rgba(26, 26, 26, 0.28); }
    }
  }
/* 歌词：整条轨道随进度平滑上滚，当前行停在黑条处；
   离当前行越远越模糊，切换按行距级联延迟（与全屏歌词页同款） */
.fm-lyric-list {
  flex: 1;
  min-height: 0;
  position: relative;
  overflow: hidden;
  margin-top: 1vh;

  .lyric-track {
    position: relative;
    /* 用视口单位而非百分比：百分比相对宽度，宽窗口时会把首行推得过低 */
    padding: 20vh 0 24vh;
    transition: transform 0.45s cubic-bezier(0.3, 0.79, 0.55, 0.99);
    will-change: transform;
  }

  .lyric-line {
    position: relative;
    text-align: left;
    font-size: 2vh;
    font-weight: bold;
    color: rgba(26, 26, 26, 0.55);
    padding: 0.7vh 1.4vh;
    margin: 0 0 2.6vh 0;
    overflow: hidden;
    &::before {
      content: '';
      position: absolute;
      inset: 0;
      background: #000;
      transform: scaleX(0);
      transform-origin: left center;
      transition: transform 0.35s cubic-bezier(0.3, 0.79, 0.55, 0.99);
      transition-delay: var(--d, 0s);
    }
    .lyric-text, .lyric-rtext, .lyric-ttext {
      position: relative;
      z-index: 1;
      display: block;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      transition: color 0.3s, filter 0.3s;
      transition-delay: var(--d, 0s);
    }
    .lyric-rtext {
      font-size: 1.5vh;
      margin-bottom: 0.3vh;
    }
    .lyric-ttext {
      font-size: 1.5vh;
      margin-top: 0.3vh;
    }
    &.on {
      .lyric-text, .lyric-rtext, .lyric-ttext { color: #fff; }
      .lyric-ttext, .lyric-rtext { opacity: 0.85; }
      &::before { transform: scaleX(1); }
    }
  }
}

/* ---------- 底部：时间码 + 进度 + 音量 + 控制 ---------- */
.fm-bottom {
  flex-shrink: 0;
  margin-top: 2vh;
  margin-bottom: 1vh;
  display: flex;
  align-items: center;
  gap: 2vw;

  .fm-timecode {
    font-size: 1.7vh; font-weight: bold;
    letter-spacing: 0.18vh;
    color: rgba(26, 26, 26, 0.8);
    white-space: nowrap;
  }

  .fm-progress {
    flex: 1;
    cursor: pointer;
    padding: 1.2vh 0;
    .fm-progress-line {
      position: relative;
      height: 2Px;
      background: rgba(0, 0, 0, 0.18);
      .fm-progress-fill {
        height: 100%;
        background: #1a1a1a;
      }
      .fm-progress-dot {
        position: absolute;
        top: 50%;
        width: 8Px;
        height: 8Px;
        border-radius: 50%;
        background: #1a1a1a;
        transform: translate(-50%, -50%);
        transition: opacity 0.2s;
        opacity: 0;
      }
    }
    &:hover .fm-progress-dot { opacity: 1; }
  }

  .fm-volume {
    /* DOCK 栏（MusicWidget）同款音量控件：结构、类名、样式逐字一致 */
    width: 120Px;
    flex-shrink: 0;
    .volume-container {
      width: 100%;
      height: 7Px;
      position: relative;
      .volume-slider {
        height: 7Px !important;
        box-shadow: 0 0 0 0.5Px black !important;
      }
      .volume-info {
        display: flex;
        flex-direction: row;
        align-items: center;
        position: absolute;
        top: -10Px;
        left: 0;
        .volume-lable, .volume-num {
          font: 8Px Geometos;
        }
        .volume-lable {
          margin-right: 6Px;
          color: rgb(106, 106, 106);
        }
      }
    }
  }

  .fm-sleep { flex-shrink: 0; }

  .fm-controls {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    gap: 2.6vh;
    .ctrl {
      width: 2.2vh;
      height: 2.2vh;
      color: #1a1a1a;
      cursor: pointer;
      transition: 0.15s;
      &:hover { opacity: 0.55; }
      &.off { opacity: 0.15; cursor: default; &:hover { opacity: 0.15; } }
    }
    .ctrl-play { width: 2.9vh; height: 2.9vh; }
    .ctrl-like {
      color: rgba(26, 26, 26, 0.75);
      &.liked { color: #e5404f; &:hover { opacity: 1; } }
    }
  }
}

/* ---------- 水印 ---------- */
.fm-watermark {
  position: absolute;
  left: 3.5vw;
  bottom: 1.4vh;
  font-size: 1.7vh; font-weight: bold;
  letter-spacing: 1vw;
  color: rgba(0, 0, 0, 0.1);
  pointer-events: none;
  white-space: nowrap;
}

/* 封面/标题切换过渡 */
.fm-fade-enter-active, .fm-fade-leave-active { transition: opacity 0.3s, transform 0.3s; }
.fm-fade-enter-from { opacity: 0; transform: translateY(1vh); }
.fm-fade-leave-to { opacity: 0; transform: translateY(-1vh); }
</style>
