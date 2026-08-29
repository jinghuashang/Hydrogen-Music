<script setup>
import { ref, computed, onMounted, onUnmounted, watch, nextTick } from 'vue'
import VueSlider from 'vue-slider-component'
import '../assets/css/slider.css'
import { getPersonalFM, getLyric } from '../api/song'
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

function getCoverUrl(song) { return song?.al?.picUrl || '' }
function getArtistNames(ar) { return ar?.length ? ar.map(a => a?.name || a).join(' / ') : '' }

// 歌词解析
const lyricLines = ref([])
const currentLyricIdx = ref(-1)

function parseLyric(raw) {
  const re = /\[(\d{2}):(\d{2})\.(\d{2,3})\]/g
  const lines = []
  let m
  while ((m = re.exec(raw)) !== null) {
    const t = parseInt(m[1]) * 60 + parseInt(m[2]) + (m[3].length === 2 ? parseInt(m[3]) * 10 : parseInt(m[3])) / 1000
    const end = m.index + m[0].length
    const rest = raw.substring(end)
    const next = rest.search(/\[/)
    lines.push({ time: t, text: (next === -1 ? rest : rest.substring(0, next)).trim() })
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
watch(songId, (id) => {
  if (!id) return
  const idx = fmSongs.value.findIndex(s => s.id === id)
  if (idx === -1 || idx === fmIndex.value) return
  const prev = fmSongs.value[fmIndex.value]
  if (prev && prev.id !== id) fmHistory.value.push(prev)
  fmIndex.value = idx
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
  if (!vp) return
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
    lyricLines.value = parseLyric(res?.lrc?.lyric || '')
  } catch (_) { lyricLines.value = [] }
}

function playCurrentFm() {
  const song = currentFmSong.value
  if (!song) return
  const list = fmSongs.value.slice(fmIndex.value)
  addToList('heartbeat', list)
  addSong(song.id, 0, true)
}

function nextFm() {
  if (fmIndex.value < fmSongs.value.length - 1) {
    if (currentFmSong.value) fmHistory.value.push(currentFmSong.value)
    fmIndex.value++
    playCurrentFm()
  } else {
    if (currentFmSong.value) fmHistory.value.push(currentFmSong.value)
    loadFmSongs().then(() => { if (currentFmSong.value) playCurrentFm() })
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

// 进度条：点击/拖拽定位（仅当 FM 歌曲是正在播放的歌时可用）
const progressEl = ref(null)
let seeking = false
// 全局 progress/time 属于"正在播放的歌"；若 FM 歌曲未在播放（如刚进页面还在放上一首），不显示其实时进度
const isFmPlaying = computed(() => songId.value === currentFmSong.value?.id)
const displayProgress = computed(() => isFmPlaying.value ? (progress.value || 0) : 0)
const displayTime = computed(() => {
  if (isFmPlaying.value && time.value) return time.value
  return Math.floor((currentFmSong.value?.dt || currentFmSong.value?.duration || 0) / 1000)
})
const progressPct = computed(() => {
  if (!displayTime.value || displayTime.value <= 0) return 0
  return Math.min(100, displayProgress.value / displayTime.value * 100)
})

function seekFromEvent(e) {
  const el = progressEl.value
  if (!el || !time.value) return
  const rect = el.getBoundingClientRect()
  const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width))
  changeProgress(ratio * time.value)
}
function onSeekMove(e) { if (seeking) seekFromEvent(e) }
function onSeekUp(e) {
  if (!seeking) return
  seeking = false
  seekFromEvent(e)
  changeProgressByDragEnd(progress.value)
  window.removeEventListener('pointermove', onSeekMove)
  window.removeEventListener('pointerup', onSeekUp)
}
function onSeekDown(e) {
  if (!isFmPlaying.value || !time.value) return
  seeking = true
  changeProgressByDragStart()
  seekFromEvent(e)
  window.addEventListener('pointermove', onSeekMove)
  window.addEventListener('pointerup', onSeekUp)
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
              <img :key="currentFmSong.id" :src="getCoverUrl(currentFmSong) + '?param=500y500'" @error="$event.target.style.display='none'" alt="">
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

          <!-- 歌词：整条轨道随进度上滚，当前行停在高亮条处 -->
          <div class="fm-lyric-list" ref="lyricViewport">
            <div class="lyric-track" :style="{ transform: `translateY(${trackOffset}px)` }">
              <p
                v-for="(line, idx) in lyricLines"
                :key="idx"
                class="lyric-line"
                :class="{ on: idx === currentLyricIdx }"
                :style="lyricLineStyle(idx)"
              ><span class="lyric-text">{{ line.text }}</span></p>
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
        <div class="fm-controls">
          <!-- 上一首 -->
          <svg @click="prevFm" :class="{ off: fmHistory.length === 0 }" class="ctrl" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="200" height="200" viewBox="0 0 200 200" fill="none"><defs><rect id="p0" x="0" y="0" width="200" height="200"/></defs><g transform="translate(0 0) rotate(0 100 100)"><mask id="m0" fill="white"><use xlink:href="#p0"/></mask><g mask="url(#m0)"><path style="stroke:currentColor;stroke-width:10" transform="translate(35 44) rotate(-90 67 53)" d="M133.6,106L66.8,0L0,106"/></g></g></svg>
          <!-- 暂停 -->
          <svg v-show="playing" @click="pauseMusic()" class="ctrl ctrl-play" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="200" height="200" viewBox="0 0 200 200" fill="none"><defs><rect id="p1" x="0" y="0" width="200" height="200"/></defs><g transform="translate(0 0) rotate(0 100 100)"><mask id="m1" fill="white"><use xlink:href="#p1"/></mask><g mask="url(#m1)"><path style="fill:currentColor;stroke:currentColor;stroke-width:8" transform="translate(152 24)" d="M0,0L0,152"/><path style="fill:currentColor;stroke:currentColor;stroke-width:8" transform="translate(48 24)" d="M0,0L0,152"/></g></g></svg>
          <!-- 播放 -->
          <svg v-show="!playing" @click="playCurrentFm" class="ctrl ctrl-play" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="200" height="200" viewBox="0 0 200 200" fill="none"><defs><rect id="p3" x="0" y="0" width="200" height="200"/></defs><g transform="translate(0 0) rotate(0 100 100)"><mask id="m3" fill="white"><use xlink:href="#p3"/></mask><g mask="url(#m3)"><path style="stroke:currentColor;stroke-width:8" transform="translate(0 12) rotate(90 88 88)" d="M11.8,132L164.2,132L88,0L11.8,132Z"/></g></g></svg>
          <!-- 下一首 -->
          <svg @click="nextFm" :class="{ off: loading }" class="ctrl" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="200" height="200" viewBox="0 0 200 200" fill="none"><defs><rect id="p2" x="0" y="0" width="200" height="200"/></defs><g transform="translate(0 0) rotate(0 100 100)"><mask id="m2" fill="white"><use xlink:href="#p2"/></mask><g mask="url(#m2)"><path style="stroke:currentColor;stroke-width:10" transform="translate(35 44) rotate(90 67 53)" d="M133.6,106L66.8,0L0,106"/></g></g></svg>
          <!-- 喜欢：始终显示，作用于当前 FM 歌曲 -->
          <svg v-if="userStore.likelist" @click="likeSong(!checkIsLike(currentFmSong.id), currentFmSong.id)" class="ctrl ctrl-like" :class="{ liked: checkIsLike(currentFmSong.id) }" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="200" height="200"><path fill="currentColor" d="M736.603 35.674c-87.909 0-169.647 44.1-223.447 116.819C459.387 79.756 377.665 35.674 289.708 35.674c-158.47 0-287.397 140.958-287.397 314.233 0 103.371 46.177 175.887 83.296 234.151 107.88 169.236 379.126 379.846 390.616 388.725 11.068 8.557 24.007 12.837 36.917 12.837 12.939 0 25.861-4.28 36.917-12.837 11.503-8.879 282.765-219.488 390.614-388.725C977.808 525.793 1024 453.277 1024 349.907 1023.999 176.632 895.071 35.674 736.603 35.674z"/></svg>
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
    font: 1.6vh 'Bender-Bold', monospace;
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
    font: 1.8vh 'Gilroy-ExtraBold', Arial, sans-serif;
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
    font: 1.6vh 'Bender-Bold', monospace;
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
    font: 3.8vh/1.15 'SourceHanSansCN-Bold';
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
      font: 1.9vh 'SourceHanSansCN-Bold';
      color: rgba(26, 26, 26, 0.6);
      flex-shrink: 0;
    }
    .fm-album {
      margin-left: 1.6vh;
      font: 1.6vh 'SourceHanSansCN-Bold';
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
    padding: 38% 0 40%;
    transition: transform 0.45s cubic-bezier(0.3, 0.79, 0.55, 0.99);
    will-change: transform;
  }

  .lyric-line {
    position: relative;
    text-align: left;
    font: 2vh 'SourceHanSansCN-Bold';
    color: rgba(26, 26, 26, 0.55);
    padding: 0.7vh 1.4vh;
    margin: 0 0 1.6vh 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
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
    .lyric-text {
      position: relative;
      z-index: 1;
      transition: color 0.3s, filter 0.3s;
      transition-delay: var(--d, 0s);
    }
    &.on {
      .lyric-text { color: #fff; }
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
    font: 1.7vh 'Bender-Bold', monospace;
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
  font: 1.7vh 'Gilroy-ExtraBold', Arial, sans-serif;
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
