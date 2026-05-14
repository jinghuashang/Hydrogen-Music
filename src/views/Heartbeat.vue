<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import { getPersonalFM, getLyric } from '../api/song'
import { addToList, addSong, pauseMusic, startMusic } from '../utils/player'
import { noticeOpen } from '../utils/dialog'
import { usePlayerStore } from '../store/playerStore'
import { storeToRefs } from 'pinia'

const playerStore = usePlayerStore()
const { progress, playing } = storeToRefs(playerStore)

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
    al: {
      id: al.id || s.album?.id || (typeof s.al === 'number' ? s.al : 0),
      name: al.name || s.album?.name || '',
      picUrl: al.picUrl || al.blurPicUrl || al.coverImgUrl || s.album?.picUrl || s.album?.blurPicUrl || s.picUrl || s.coverUrl || '',
    },
  }
}

function getCoverUrl(song) { return song?.al?.picUrl || '' }
function getArtistNames(ar) { return ar?.length ? ar.map(a => a?.name || a).join(' / ') : '' }

// 歌词 - 解析+只展示5行(前2 当前 后2)
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

const visibleLyrics = computed(() => {
  const all = lyricLines.value
  if (!all.length) return []
  const cur = Math.max(0, currentLyricIdx.value)
  const start = Math.max(0, cur - 2)
  return all.slice(start, start + 5)
})

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

onMounted(() => { loadFmSongs() })
</script>

<template>
  <div class="heartbeat-page">
    <div class="fm-loading" v-if="loading && !currentFmSong">LOADING</div>

    <div class="fm-player" v-if="currentFmSong && !loading">
      <!-- 封面 -->
      <div class="fm-cover">
        <img :src="getCoverUrl(currentFmSong) + '?param=300y300'" @error="$event.target.style.display='none'" alt="">
      </div>

      <!-- 歌曲信息 -->
      <div class="fm-info">
        <div class="fm-name">{{ currentFmSong.name }}</div>
        <div class="fm-artist">{{ getArtistNames(currentFmSong.ar) }}</div>
        <div class="fm-album" v-if="currentFmSong.al?.name">{{ currentFmSong.al.name }}</div>
      </div>

      <!-- 歌词 5行 -->
      <div class="fm-lyric-list">
        <div class="lyric-placeholder" v-for="i in 5" :key="i">
          <p
            v-if="visibleLyrics[i-1] !== undefined"
            class="lyric-line"
            :class="{ on: lyricLines.indexOf(visibleLyrics[i-1]) === currentLyricIdx }"
          >{{ visibleLyrics[i-1].text }}</p>
        </div>
      </div>

      <!-- 控制 - dock 风格 -->
      <div class="fm-controls">
        <!-- 上一首 -->
        <svg @click="prevFm" :class="{ off: fmHistory.length === 0 }" class="ctrl" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="200" height="200" viewBox="0 0 200 200" fill="none"><defs><rect id="p0" x="0" y="0" width="200" height="200"/></defs><g transform="translate(0 0) rotate(0 100 100)"><mask id="m0" fill="white"><use xlink:href="#p0"/></mask><g mask="url(#m0)"><path style="stroke:#000;stroke-width:8" transform="translate(35 44) rotate(-90 67 53)" d="M133.6,106L66.8,0L0,106"/></g></g></svg>
        <!-- 暂停 -->
        <svg v-show="playing" @click="pauseMusic()" class="ctrl ctrl-play" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="200" height="200" viewBox="0 0 200 200" fill="none"><defs><rect id="p1" x="0" y="0" width="200" height="200"/></defs><g transform="translate(0 0) rotate(0 100 100)"><mask id="m1" fill="white"><use xlink:href="#p1"/></mask><g mask="url(#m1)"><path style="fill:#000;stroke:#000;stroke-width:8" transform="translate(152 24)" d="M0,0L0,152"/><path style="fill:#000;stroke:#000;stroke-width:8" transform="translate(48 24)" d="M0,0L0,152"/></g></g></svg>
        <!-- 播放 -->
        <svg v-show="!playing" @click="playCurrentFm" class="ctrl ctrl-play" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="200" height="200" viewBox="0 0 200 200" fill="none"><defs><rect id="p3" x="0" y="0" width="200" height="200"/></defs><g transform="translate(0 0) rotate(0 100 100)"><mask id="m3" fill="white"><use xlink:href="#p3"/></mask><g mask="url(#m3)"><path style="stroke:#000;stroke-width:8" transform="translate(0 12) rotate(90 88 88)" d="M11.8,132L164.2,132L88,0L11.8,132Z"/></g></g></svg>
        <!-- 下一首 -->
        <svg @click="nextFm" :class="{ off: loading }" class="ctrl" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="200" height="200" viewBox="0 0 200 200" fill="none"><defs><rect id="p2" x="0" y="0" width="200" height="200"/></defs><g transform="translate(0 0) rotate(0 100 100)"><mask id="m2" fill="white"><use xlink:href="#p2"/></mask><g mask="url(#m2)"><path style="stroke:#000;stroke-width:8" transform="translate(35 44) rotate(90 67 53)" d="M133.6,106L66.8,0L0,106"/></g></g></svg>
      </div>
    </div>
  </div>
</template>

<style scoped lang="scss">
$dock: 120Px;

.heartbeat-page {
  height: calc(100% - $dock);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: flex-start;
  padding-top: 6Px;
  overflow: hidden;
}

.fm-player {
  width: 100%;
  max-width: 480Px;
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6Px;
}

.fm-cover {
  width: 150Px; height: 150Px; flex-shrink: 0;
  border: 1px solid rgba(0,0,0,0.1);
  img { width: 100%; height: 100%; object-fit: cover; display: block; }
}

.fm-info {
  text-align: center; width: 100%; flex-shrink: 0;
  .fm-name {
    font: 16Px SourceHanSansCN-Bold; color: #1a1a1a; padding: 0 16Px;
    overflow: hidden; white-space: nowrap; text-overflow: ellipsis;
  }
  .fm-artist { font: 12Px SourceHanSansCN-Bold; color: #555; }
  .fm-album { font: 11Px SourceHanSansCN-Bold; color: #999; }
}

// 歌词 - 固定5行
.fm-lyric-list {
  flex: 1; display: flex; flex-direction: column; justify-content: center; align-items: center;
  width: 100%; min-height: 0;
  .lyric-placeholder {
    height: 32Px; display: flex; align-items: center;
    .lyric-line {
      font: 13Px SourceHanSansCN-Bold; color: #aaa; transition: 0.25s; white-space: nowrap;
      &.on { color: #1a1a1a; font-size: 15Px; }
    }
  }
}

// 控制 - dock 栏同款
.fm-controls {
  flex-shrink: 0; display: flex; align-items: center; gap: 28Px;
  padding: 4Px 0 14Px 0;
  .ctrl {
    width: 28Px; height: 28Px; cursor: pointer; transition: 0.15s;
    &:hover { opacity: 0.5; }
    &.off { opacity: 0.1; cursor: default; &:hover { opacity: 0.1; } }
  }
  .ctrl-play { width: 38Px; height: 38Px; }
}

.fm-loading { font: 14Px SourceHanSansCN-Bold; color: #aaa; margin-top: 40Px; }
</style>
