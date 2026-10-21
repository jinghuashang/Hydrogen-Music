<script setup>
import { computed, nextTick, onActivated, onBeforeUnmount, onDeactivated, onMounted, ref, watch } from 'vue'
import { RecycleScroller } from 'vue-virtual-scroller'
import 'vue-virtual-scroller/dist/vue-virtual-scroller.css'
import VueSlider from 'vue-slider-component'
import '../assets/css/slider.css'
import { storeToRefs } from 'pinia'
import { useListenTogetherStore } from '../store/listenTogetherStore'
import { usePlayerStore } from '../store/playerStore'
import { useUserStore } from '../store/userStore'
import { getLyric } from '../api/song'
import {
  changeProgress,
  changeProgressByDragEnd,
  changeProgressByDragStart,
  pauseMusic,
  playLast,
  playNext,
  songTime2,
  startMusic,
} from '../utils/player'
import { dialogOpen, noticeOpen } from '../utils/dialog'
import { buildListenTogetherShareLink, parseListenTogetherInput } from '../utils/listenTogether'

const lt = useListenTogetherStore()
const playerStore = usePlayerStore()
const userStore = useUserStore()

const {
  inRoom,
  roomId,
  creatorId,
  users,
  creating,
  joining,
  leaving,
  syncing,
  recovering,
  connected,
  playlistIds,
  lastSyncAt,
  lastError,
  applyingRemote,
} = storeToRefs(lt)

const {
  songList,
  songId,
  playing,
  progress,
  time,
  volume,
  playMode,
  currentMusic,
  localBase64Img,
} = storeToRefs(playerStore)

const joinInput = ref('')
const progressEl = ref(null)
const seeking = ref(false)
const seekProgress = ref(0)

// 参考心动页：滚动歌词、罗马音/翻译开关、按当前行整体上滚
const lyricLines = ref([])
const currentLyricIdx = ref(-1)
const showRoma = ref(true)
const showTrans = ref(true)
const lyricViewport = ref(null)
const trackOffset = ref(0)

const currentSong = computed(
  () => playerStore.songList?.[playerStore.currentIndex] || null,
)
const isRoomSong = computed(
  () => !!currentSong.value?.id && playlistIds.value.includes(Number(currentSong.value.id)),
)
const artistNames = computed(() => artistNamesOf(currentSong.value))
const coverUrl = computed(() => {
  const song = currentSong.value
  if (!song) return ''
  if (song.type === 'local') return localBase64Img.value || ''
  const raw = song.al?.picUrl || song.picUrl || ''
  if (!raw) return ''
  if (raw.startsWith('data:')) return raw
  return `${raw.split('?')[0]}?param=512y512`
})

const displayTime = computed(() => {
  const dt = Number(currentSong.value?.dt || 0)
  if (dt > 0) return Math.floor(dt / 1000)
  return isRoomSong.value ? Number(time.value || 0) : 0
})
const displayProgress = computed(() => {
  if (seeking.value) return seekProgress.value
  // 房间页的进度条跟随全局播放器；即使当前歌曲暂时未共享，播放状态也必须真实可见
  return currentSong.value ? Number(progress.value || 0) : 0
})
const progressPct = computed(() => {
  if (!displayTime.value || displayTime.value <= 0) return 0
  return Math.min(100, Math.max(0, (displayProgress.value / displayTime.value) * 100))
})

const isHost = computed(() => {
  const uid = Number(userStore.user?.userId || 0)
  if (uid && Number(creatorId.value)) return uid === Number(creatorId.value)
  return lt.role === 'host'
})

const statusText = computed(() => {
  if (!inRoom.value) return 'IDLE'
  if (applyingRemote.value) return 'APPLYING'
  if (connected.value) return 'SYNCED'
  return 'CONNECTING'
})

const lastSyncLabel = computed(() => {
  if (!lastSyncAt.value) return '—'
  return new Date(lastSyncAt.value).toLocaleTimeString('zh-CN', { hour12: false })
})

const playModeLabel = computed(() => {
  const labels = ['顺序播放', '列表循环', '单曲循环', '随机播放']
  return labels[Number(playMode.value)] || '列表循环'
})

const inviteLink = computed(() =>
  buildListenTogetherShareLink({
    roomId: roomId.value,
    inviterId: creatorId.value,
    songId: currentSong.value?.id,
  }),
)

const members = computed(() => {
  const list = Array.isArray(users.value) ? [...users.value] : []
  const self = userStore.user
  if (self?.userId && !list.some((user) => Number(user.userId) === Number(self.userId))) {
    list.unshift({
      userId: self.userId,
      nickname: self.nickname,
      avatarUrl: self.avatarUrl,
    })
  }
  return list
})

const queueItems = computed(() => {
  const shared = new Set((playlistIds.value || []).map((id) => Number(id)))
  return (songList.value || [])
    .map((song, index) => ({
      ...song,
      _ltKey: `${song.id || 'local'}-${index}`,
      _index: index,
    }))
    // 房间队列只展示真正共享出去的歌曲，避免把未同步的本地/后加歌曲算进 TRACKS
    .filter((item) => !shared.size || shared.has(Number(item.id)))
})

const busy = computed(
  () => creating.value || joining.value || recovering.value || leaving.value,
)

function artistNamesOf(song) {
  const ar = song?.ar || song?.artists || []
  const names = ar
    .map((artist) => (typeof artist === 'object' ? artist?.name : artist))
    .filter(Boolean)
  return names.join(' / ')
}

function parseLyric(raw) {
  const re = /\[(\d{2}):(\d{2})\.(\d{2,3})\]/g
  const lines = []
  let m
  while ((m = re.exec(raw)) !== null) {
    const t =
      parseInt(m[1]) * 60 +
      parseInt(m[2]) +
      (m[3].length === 2 ? parseInt(m[3]) * 10 : parseInt(m[3])) / 1000
    const end = m.index + m[0].length
    const rest = raw.substring(end)
    const next = rest.search(/\[/)
    const text = (next === -1 ? rest : rest.substring(0, next)).trim()
    if (!text) continue
    lines.push({ time: t, text })
  }
  return lines
}

let lyricSongId = 0
async function loadLyric(id) {
  lyricSongId = Number(id || 0)
  lyricLines.value = []
  currentLyricIdx.value = -1
  trackOffset.value = 0
  if (!id) return
  try {
    const res = await getLyric(id)
    if (lyricSongId !== Number(id)) return
    const lines = parseLyric(res?.lrc?.lyric || '')
    const trans = parseLyric(res?.tlyric?.lyric || '')
    const roma = parseLyric(res?.romalrc?.lyric || '')
    if (trans.length) {
      for (const line of lines) {
        const hit = trans.find((item) => Math.abs(item.time - line.time) < 0.5)
        if (hit) line.ttext = hit.text
      }
    }
    if (roma.length) {
      for (const line of lines) {
        const hit = roma.find((item) => Math.abs(item.time - line.time) < 0.5)
        if (hit) line.rtext = hit.text
      }
    }
    lyricLines.value = lines
    syncLyric(progress.value)
  } catch (_) {
    lyricLines.value = []
  }
}

function syncLyric(seek) {
  if (!lyricLines.value.length) return
  let idx = -1
  for (let i = 0; i < lyricLines.value.length; i++) {
    if (seek >= lyricLines.value[i].time) idx = i
    else break
  }
  if (idx !== currentLyricIdx.value) currentLyricIdx.value = idx
}

let lyricClock = null

function currentLyricTime() {
  const howl = currentMusic.value
  if (howl && Number(songId.value) === Number(currentSong.value?.id)) {
    try {
      const time = howl.seek()
      if (Number.isFinite(time) && time > 0.05) return time
    } catch (_) {}
  }
  return Number(progress.value || 0)
}

function tickLyricClock() {
  if (!currentSong.value) return
  if (Number(songId.value) !== Number(currentSong.value.id)) return
  syncLyric(currentLyricTime())
}

function startLyricClock() {
  if (lyricClock) return
  tickLyricClock()
  // progress store 每秒才更新一次；歌词单独用 120ms 时钟读 Howl 实际位置
  lyricClock = setInterval(tickLyricClock, 120)
}

function stopLyricClock() {
  if (lyricClock) {
    clearInterval(lyricClock)
    lyricClock = null
  }
}

function lyricLineStyle(idx) {
  const anchor = currentLyricIdx.value < 0 ? 0 : currentLyricIdx.value
  const style = { '--d': Math.min(Math.abs(idx - anchor), 6) * 0.04 + 's' }
  if (currentLyricIdx.value < 0) return style
  const distance = Math.abs(idx - currentLyricIdx.value)
  style.filter = distance === 0 ? 'blur(0px)' : `blur(${Math.min(distance * 0.55, 2.2)}px)`
  return style
}

function updateTrackOffset() {
  const vp = lyricViewport.value
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
  const anchor = vp.clientHeight * 0.42
  trackOffset.value = anchor - (active.offsetTop + active.offsetHeight / 2)
}

watch(
  () => currentSong.value?.id,
  (id) => {
    if (id) loadLyric(id)
    else {
      lyricSongId = 0
      lyricLines.value = []
      currentLyricIdx.value = -1
      trackOffset.value = 0
    }
  },
  { immediate: true },
)

watch(
  () => progress.value,
  (value) => {
    if (Number(songId.value) === Number(currentSong.value?.id)) syncLyric(value)
  },
)

watch(currentLyricIdx, () => nextTick(updateTrackOffset))
watch(lyricLines, () => nextTick(updateTrackOffset))
onActivated(() => nextTick(updateTrackOffset))

async function doCreate() {
  if (busy.value) return
  await lt.createRoom()
}

async function doJoin() {
  if (busy.value || !joinInput.value) return
  const parsed = parseListenTogetherInput(joinInput.value)
  if (!parsed) {
    noticeOpen('请输入有效的房间号或邀请链接', 2)
    return
  }
  const ok = await lt.joinRoom(parsed)
  if (ok) joinInput.value = ''
}

function playRoomSong(index) {
  lt.playRoomSong(index)
}

function resumeMusic() {
  const howl = currentMusic.value
  const expected = Number(progress.value || 0)
  // 某些情况下底层 audio 会被重置到 0，但 store 进度仍是暂停位置：
  // 恢复播放前把 seek 拉回暂停位置，避免“声音从头、进度条不动”。
  if (howl && expected > 0.5) {
    try {
      const actual = Number(howl.seek())
      if (!Number.isFinite(actual) || actual < 0.2) howl.seek(expected)
    } catch (_) {}
  }
  startMusic()
}

function togglePlay() {
  if (!currentSong.value) {
    if (songList.value?.length) lt.playRoomSong(0)
    return
  }
  if (playing.value) {
    pauseMusic()
    return
  }
  if (!isRoomSong.value) {
    // 当前歌曲还没进共享队列：先让它进房间，再按真实进度继续播放
    lt.publishCurrentSong()
  }
  if (!currentMusic.value) {
    const index = (songList.value || []).findIndex(
      (song) => Number(song.id) === Number(songId.value),
    )
    lt.playRoomSong(index >= 0 ? index : 0)
    return
  }
  resumeMusic()
}

function prevSong() {
  if (songList.value?.length) playLast()
}

function nextSong() {
  if (songList.value?.length) playNext()
}

function getSeekTimeFromEvent(event) {
  const el = progressEl.value
  if (!el || !displayTime.value) return 0
  const rect = el.getBoundingClientRect()
  const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width))
  return ratio * displayTime.value
}

function onSeekDown(event) {
  if (event.button !== 0) return
  if (!isRoomSong.value || !displayTime.value) return
  seeking.value = true
  changeProgressByDragStart()
  seekProgress.value = getSeekTimeFromEvent(event)
  window.addEventListener('pointermove', onSeekMove)
  window.addEventListener('pointerup', onSeekUp)
}

function onSeekMove(event) {
  if (seeking.value) seekProgress.value = getSeekTimeFromEvent(event)
}

function onSeekUp(event) {
  if (event.button !== 0 || !seeking.value) return
  seeking.value = false
  const target = getSeekTimeFromEvent(event)
  seekProgress.value = target
  changeProgressByDragEnd(target)
  lt.reportSeek(target)
  window.removeEventListener('pointermove', onSeekMove)
  window.removeEventListener('pointerup', onSeekUp)
}

function confirmLeave() {
  const host = isHost.value
  dialogOpen(
    host ? '结束一起听' : '退出一起听',
    host ? '房间会立即解散，另一位成员将停止同步。' : '退出后将停止与房间的播放同步。',
    (ok) => {
      if (ok) lt.leaveRoom()
    },
  )
}

function syncNow() {
  lt.resync()
}

function pushList() {
  lt.syncPlaylistToRoom('REPLACE', { notify: true })
}

async function copyText(text) {
  if (!text) return false
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch (_) {}
  try {
    const textarea = document.createElement('textarea')
    textarea.value = text
    textarea.style.position = 'fixed'
    textarea.style.opacity = '0'
    document.body.appendChild(textarea)
    textarea.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(textarea)
    return ok
  } catch (_) {
    return false
  }
}

async function copyInvite() {
  const ok = await copyText(inviteLink.value)
  noticeOpen(ok ? '邀请链接已复制' : '复制失败，请手动选择链接', 2)
}

watch(volume, (value) => {
  if (currentMusic.value) currentMusic.value.volume(value)
})

let lastRecoverAt = 0
function restoreRoom() {
  if (Date.now() - lastRecoverAt < 3000) return
  lastRecoverAt = Date.now()
  lt.recoverRoom()
}

onMounted(restoreRoom)
onActivated(restoreRoom)
onMounted(startLyricClock)
onActivated(startLyricClock)
onDeactivated(stopLyricClock)
onBeforeUnmount(() => {
  stopLyricClock()
  window.removeEventListener('pointermove', onSeekMove)
  window.removeEventListener('pointerup', onSeekUp)
})
</script>

<template>
  <div class="together-page">
    <div class="lt-head">
      <span class="lt-tag">LISTEN TOGETHER<i>/</i>一起听</span>
      <span class="lt-dots"></span>
      <span class="lt-status" :class="{ online: connected, applying: applyingRemote }">
        <i class="status-dot"></i>{{ statusText }}
      </span>
    </div>

    <div v-if="!inRoom" class="lt-lobby">
      <section class="lobby-copy">
        <div class="lobby-kicker">A SHARED LISTENING ROOM</div>
        <h1>一起听<span>同一首歌，同一个此刻</span></h1>
        <p>
          创建房间或用邀请链接加入，成员共享播放列表与播放进度。切歌、暂停、拖动进度都会同步到房间另一端。
        </p>
        <ol class="lobby-steps">
          <li><span>01</span>用当前播放列表创建房间</li>
          <li><span>02</span>把邀请链接发给网易云好友</li>
          <li><span>03</span>在房间里一起切歌、暂停与拖动进度</li>
        </ol>
        <div class="lobby-note">
          <span class="note-line"></span>
          双人房间 · 官方协议 · 自动恢复上次房间
        </div>
      </section>

      <div class="lobby-actions">
        <section class="action-card action-create">
          <div class="card-index">01 / HOST</div>
          <h2>创建房间</h2>
          <p>把当前正在听的队列带进房间，生成邀请链接。</p>
          <button class="lt-btn primary" :disabled="busy" @click="doCreate">
            {{ creating ? 'CREATING…' : '创建一起听房间' }}
          </button>
          <div v-if="songList?.length" class="action-hint">
            将共享 {{ songList.length }} 首歌曲
          </div>
          <div v-else class="action-hint">当前没有播放列表，创建后可在房间内同步</div>
        </section>

        <section class="action-card">
          <div class="card-index">02 / GUEST</div>
          <h2>加入房间</h2>
          <p>粘贴好友发来的网易云邀请链接，或直接输入房间号。</p>
          <input
            v-model.trim="joinInput"
            class="lt-input"
            placeholder="邀请链接 / 房间号"
            @keyup.enter="doJoin"
          />
          <button class="lt-btn" :disabled="busy || !joinInput" @click="doJoin">
            {{ joining ? 'JOINING…' : '加入房间' }}
          </button>
          <div class="action-hint">只填房间号时，会通过 room/check 自动补全房主 ID</div>
        </section>

        <div v-if="recovering" class="lobby-foot">正在检查账号已有房间…</div>
      </div>
    </div>

    <template v-else>
      <div class="room-bar">
        <div class="room-id">
          <span class="room-label">ROOM</span>
          <span class="room-value">{{ roomId }}</span>
          <span class="room-role">{{ isHost ? 'HOST' : 'GUEST' }}</span>
        </div>
        <div class="room-bar-actions">
          <button class="lt-btn ghost" :disabled="syncing" @click="syncNow">
            {{ syncing ? 'SYNCING…' : '重新同步' }}
          </button>
          <button class="lt-btn ghost danger" :disabled="leaving" @click="confirmLeave">
            {{ leaving ? 'LEAVING…' : isHost ? '结束房间' : '退出房间' }}
          </button>
        </div>
      </div>

      <div class="room-grid">
        <section class="now-card">
          <div class="now-head">
            <span class="card-index">NOW PLAYING</span>
            <span class="now-source" :class="{ local: !isRoomSong }">
              {{ isRoomSong ? 'SHARED' : 'LOCAL' }}
            </span>
          </div>

          <div class="now-main">
            <div class="now-cover">
              <Transition name="lt-fade" mode="out-in">
                <img
                  v-if="coverUrl"
                  :key="currentSong?.id || 'none'"
                  :src="coverUrl"
                  alt=""
                  @error="$event.target.style.display = 'none'"
                />
                <div v-else class="cover-fallback">LT</div>
              </Transition>
              <span class="corner c1"></span>
              <span class="corner c2"></span>
              <span class="corner c3"></span>
              <span class="corner c4"></span>
            </div>

            <div class="now-info">
              <Transition name="lt-fade" mode="out-in">
                <div class="now-titles" :key="currentSong?.id || 'empty'">
                  <h2 class="now-name">{{ currentSong?.name || '等待歌曲' }}</h2>
                  <div class="now-artist">{{ artistNames || '—' }}</div>
                  <div class="now-album">{{ currentSong?.al?.name || '' }}</div>
                </div>
              </Transition>

              <div class="lyric-toolbar">
                <button
                  class="lyric-toggle"
                  :class="{ off: !showRoma }"
                  title="显示/隐藏罗马音"
                  @click="showRoma = !showRoma"
                >ABC</button>
                <button
                  class="lyric-toggle"
                  :class="{ off: !showTrans }"
                  title="显示/隐藏翻译"
                  @click="showTrans = !showTrans"
                >译</button>
              </div>

              <div class="lyric-viewport" ref="lyricViewport">
                <div class="lyric-track" :style="{ transform: `translateY(${trackOffset}px)` }">
                  <p
                    v-for="(line, idx) in lyricLines"
                    :key="idx"
                    class="lyric-line"
                    :class="{ on: idx === currentLyricIdx }"
                    :style="lyricLineStyle(idx)"
                  >
                    <span v-if="showRoma && line.rtext" class="lyric-rtext">{{ line.rtext }}</span>
                    <span class="lyric-text">{{ line.text }}</span>
                    <span v-if="showTrans && line.ttext" class="lyric-ttext">{{ line.ttext }}</span>
                  </p>
                  <p v-if="!lyricLines.length" class="lyric-empty">
                    {{ currentSong ? '暂无歌词' : '等待歌曲' }}
                  </p>
                </div>
              </div>

            </div>
          </div>

          <div class="now-bottom">
            <div class="now-progress">
              <div class="timecode">
                {{ songTime2(displayProgress) }} / {{ songTime2(displayTime) }}
              </div>
              <div class="lt-progress" ref="progressEl" @pointerdown="onSeekDown">
                <div class="lt-progress-line">
                  <div class="lt-progress-fill" :style="{ width: progressPct + '%' }"></div>
                  <div class="lt-progress-dot" :style="{ left: progressPct + '%' }"></div>
                </div>
              </div>
            </div>

            <div class="now-volume">
              <div class="volume-container">
                <VueSlider
                  class="volume-slider"
                  v-model="volume"
                  :min="0"
                  :max="1"
                  :interval="0.01"
                  :duration="0.3"
                  tooltip="none"
                ></VueSlider>
                <div class="volume-info">
                  <span>VOLUME</span>
                  <span>{{ Math.round(volume * 100) }}</span>
                </div>
              </div>
            </div>

            <div class="now-controls">
              <button class="ctrl-btn" aria-label="上一首" @click="prevSong">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path
                    d="M15 4.5 7.5 12 15 19.5"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.4"
                    stroke-linecap="square"
                  />
                </svg>
              </button>
              <button class="ctrl-btn play" aria-label="播放/暂停" @click="togglePlay">
                <svg v-if="playing" viewBox="0 0 24 24" aria-hidden="true">
                  <path
                    d="M9 5v14M15 5v14"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.6"
                    stroke-linecap="square"
                  />
                </svg>
                <svg v-else viewBox="0 0 24 24" aria-hidden="true">
                  <path
                    d="M8 4.8 19 12 8 19.2Z"
                    fill="currentColor"
                    stroke="currentColor"
                    stroke-width="0.6"
                    stroke-linejoin="round"
                  />
                </svg>
              </button>
              <button class="ctrl-btn" aria-label="下一首" @click="nextSong">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path
                    d="M9 4.5 16.5 12 9 19.5"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.4"
                    stroke-linecap="square"
                  />
                </svg>
              </button>
            </div>
          </div>
        </section>

        <aside class="side-col">
          <section class="side-card members-card">
            <div class="side-head">
              <span class="card-index">IN THE ROOM</span>
              <span class="side-count">{{ members.length }} / 2</span>
            </div>
            <div class="member-list">
              <div v-for="member in members" :key="member.userId" class="member">
                <img
                  v-if="member.avatarUrl"
                  :src="member.avatarUrl + '?param=64y64'"
                  alt=""
                />
                <div v-else class="member-avatar">
                  {{ (member.nickname || '?').slice(0, 1) }}
                </div>
                <div class="member-meta">
                  <span class="member-name">{{ member.nickname || member.nickName || '听友' }}</span>
                  <span class="member-role">
                    {{ Number(member.userId) === Number(creatorId) ? 'HOST' : 'GUEST' }}
                  </span>
                </div>
                <span class="member-online"></span>
              </div>
              <div v-if="!members.length" class="empty-line">等待成员加入…</div>
            </div>
          </section>

          <section class="side-card invite-card">
            <div class="side-head">
              <span class="card-index">INVITE</span>
            </div>
            <p class="invite-link">{{ inviteLink || '房间链接生成中…' }}</p>
            <button class="lt-btn" :disabled="!inviteLink" @click="copyInvite">
              复制邀请链接
            </button>
            <div class="action-hint">
              好友在网易云 App 打开后即可加入；本页也可直接粘贴房间号。
            </div>
          </section>

          <section class="side-card sync-card">
            <div class="side-head">
              <span class="card-index">SYNC</span>
              <span class="sync-state" :class="{ online: connected }">{{ statusText }}</span>
            </div>
            <dl class="sync-meta">
              <div><dt>最后同步</dt><dd>{{ lastSyncLabel }}</dd></div>
              <div><dt>共享歌曲</dt><dd>{{ playlistIds.length }} 首</dd></div>
              <div><dt>播放模式</dt><dd>{{ playModeLabel }}</dd></div>
            </dl>
            <button
              class="lt-btn ghost"
              :disabled="syncing || !songList?.length"
              @click="pushList"
            >
              {{ syncing ? '同步中…' : '同步当前播放列表' }}
            </button>
            <div v-if="lastError" class="action-hint error">{{ lastError }}</div>
          </section>
        </aside>
      </div>

      <section class="queue-card">
        <div class="queue-head">
          <span class="card-index">SHARED QUEUE<i>/</i>共享队列</span>
          <span class="queue-count">{{ queueItems.length }} TRACKS</span>
        </div>
        <div class="queue-body">
          <RecycleScroller
            v-if="queueItems.length"
            class="queue-scroller"
            :items="queueItems"
            :item-size="48"
            key-field="_ltKey"
            v-slot="{ item }"
          >
            <div
              class="queue-item"
              :class="{
                playing: Number(songId) === Number(item.id),
                local: item.type === 'local',
              }"
              @dblclick="playRoomSong(item._index)"
            >
              <span class="queue-index">{{ String(item._index + 1).padStart(2, '0') }}</span>
              <span v-if="Number(songId) === Number(item.id)" class="queue-eq">
                <i></i><i></i><i></i>
              </span>
              <span v-else class="queue-eq-placeholder"></span>
              <div class="queue-meta">
                <span class="queue-name">{{ item.name || item.localName }}</span>
                <span class="queue-artist">{{ artistNamesOf(item) }}</span>
              </div>
              <span v-if="item.type === 'local'" class="queue-local-tag">LOCAL</span>
              <span class="queue-time">{{ songTime2(Math.floor((item.dt || 0) / 1000)) }}</span>
              <button class="queue-play" aria-label="播放" @click.stop="playRoomSong(item._index)">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5l11 7-11 7z" /></svg>
              </button>
            </div>
          </RecycleScroller>
          <div v-else class="queue-empty">
            房间还没有共享歌曲。房主点击「同步当前播放列表」把队列带进来。
          </div>
        </div>
      </section>
    </template>

    <div class="lt-watermark">SAME&nbsp;SONG&nbsp;/&nbsp;SAME&nbsp;MOMENT</div>
  </div>
</template>

<style scoped lang="scss">
.together-page {
  position: relative;
  min-height: calc(100% - 2.6vh);
  margin-bottom: 2.6vh;
  padding: 3vh 3.2vw 4.4vh;
  box-sizing: border-box;
  overflow: hidden;
  color: #1a1a1a;
  text-align: left;
  border: 1px solid rgba(0, 0, 0, 0.55);
  background:
    radial-gradient(ellipse at 18% 0%, rgba(0, 0, 0, 0.025), transparent 55%),
    repeating-linear-gradient(0deg, transparent 0 46px, rgba(0, 0, 0, 0.022) 46px 47px),
    repeating-linear-gradient(90deg, transparent 0 46px, rgba(0, 0, 0, 0.022) 46px 47px),
    rgba(255, 255, 255, 0.55);

  button:focus,
  button:focus-visible {
    outline: none;
  }
}

/* ---------- 页头 ---------- */
.lt-head {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 2vw;
  .lt-tag {
    font-size: 1.8vh;
    font-weight: bold;
    letter-spacing: 0.35vh;
    color: #1a1a1a;
    white-space: nowrap;
    i {
      font-style: normal;
      color: rgba(0, 0, 0, 0.35);
      margin: 0 0.6vh;
    }
  }
  .lt-dots {
    flex: 1;
    height: 0;
    border-top: 2Px dotted rgba(0, 0, 0, 0.25);
  }
  .lt-status {
    display: inline-flex;
    align-items: center;
    gap: 0.8vh;
    font-size: 1.5vh;
    font-weight: bold;
    letter-spacing: 0.28vh;
    color: rgba(26, 26, 26, 0.45);
    white-space: nowrap;
    .status-dot {
      width: 7Px;
      height: 7Px;
      border-radius: 50%;
      border: 1px solid rgba(0, 0, 0, 0.55);
      background: transparent;
    }
    &.online .status-dot {
      background: #1a1a1a;
      animation: lt-pulse 2s ease-in-out infinite;
    }
    &.applying .status-dot {
      background: rgba(0, 0, 0, 0.45);
    }
  }
}

@keyframes lt-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.35; }
}

/* ---------- 大厅 ---------- */
.lt-lobby {
  margin-top: 4.4vh;
  display: grid;
  grid-template-columns: minmax(0, 1.05fr) minmax(300px, 0.95fr);
  gap: 4vw;
  align-items: start;
}

.lobby-copy {
  .lobby-kicker {
    font-size: 1.4vh;
    font-weight: bold;
    letter-spacing: 0.55vh;
    color: rgba(26, 26, 26, 0.38);
  }
  h1 {
    margin: 1.6vh 0 0;
    font-size: clamp(44px, 7vh, 82px);
    line-height: 0.95;
    letter-spacing: 0.4vh;
    font-weight: bold;
    span {
      display: block;
      margin-top: 1.8vh;
      font-size: 2vh;
      line-height: 1.5;
      letter-spacing: 0.12vh;
      color: rgba(26, 26, 26, 0.55);
    }
  }
  p {
    margin: 3vh 0 0;
    max-width: 36em;
    font-size: 1.55vh;
    line-height: 1.9;
    color: rgba(26, 26, 26, 0.7);
  }
}

.lobby-steps {
  list-style: none;
  margin: 4vh 0 0;
  padding: 0;
  border-top: 1Px solid rgba(0, 0, 0, 0.16);
  max-width: 34em;
  li {
    display: flex;
    align-items: baseline;
    gap: 1.6vh;
    padding: 1.55vh 0;
    border-bottom: 1Px solid rgba(0, 0, 0, 0.1);
    font-size: 1.55vh;
    font-weight: bold;
    color: rgba(26, 26, 26, 0.78);
    span {
      font-size: 1.25vh;
      letter-spacing: 0.2vh;
      color: rgba(26, 26, 26, 0.35);
      flex-shrink: 0;
    }
  }
}

.lobby-note {
  margin-top: 3vh;
  display: flex;
  align-items: center;
  gap: 1.2vh;
  font-size: 1.3vh;
  letter-spacing: 0.16vh;
  color: rgba(26, 26, 26, 0.4);
  .note-line {
    width: 4vh;
    height: 1Px;
    background: rgba(0, 0, 0, 0.3);
  }
}

.lobby-actions {
  display: flex;
  flex-direction: column;
  gap: 1.8vh;
}

.action-card {
  border: 1px solid rgba(0, 0, 0, 0.38);
  background: rgba(255, 255, 255, 0.5);
  padding: 2.6vh 1.8vw 2.4vh;
  .card-index {
    font-size: 1.2vh;
    font-weight: bold;
    letter-spacing: 0.42vh;
    color: rgba(26, 26, 26, 0.38);
  }
  h2 {
    margin: 1.4vh 0 0;
    font-size: 2.8vh;
    letter-spacing: 0.12vh;
  }
  p {
    margin: 1.2vh 0 2.2vh;
    font-size: 1.4vh;
    line-height: 1.7;
    color: rgba(26, 26, 26, 0.6);
  }
  .lt-btn {
    width: 100%;
  }
  .action-hint {
    margin-top: 1.4vh;
  }
}

.action-create {
  background: #141414;
  border-color: #141414;
  color: rgba(255, 255, 255, 0.94);
  .card-index,
  p,
  .action-hint {
    color: rgba(255, 255, 255, 0.52);
  }
  .lt-btn.primary {
    background: rgba(255, 255, 255, 0.94);
    color: #111;
    border-color: rgba(255, 255, 255, 0.94);
    &:hover:not(:disabled) {
      background: transparent;
      color: #fff;
    }
  }
}

.lt-btn {
  height: 4.4vh;
  min-height: 34px;
  padding: 0 1.8vh;
  border: 1px solid #1a1a1a;
  border-radius: 0;
  background: transparent;
  color: #1a1a1a;
  font: inherit;
  font-size: 1.4vh;
  font-weight: bold;
  letter-spacing: 0.14vh;
  cursor: pointer;
  transition: 0.18s;
  &:hover:not(:disabled) {
    background: #1a1a1a;
    color: #fff;
  }
  &:disabled {
    opacity: 0.3;
    cursor: default;
  }
  &.primary {
    background: #1a1a1a;
    color: #fff;
    &:hover:not(:disabled) {
      background: transparent;
      color: #1a1a1a;
    }
  }
  &.ghost {
    height: 3.6vh;
    min-height: 30px;
    font-size: 1.3vh;
    padding: 0 1.4vh;
  }
  &.danger:hover:not(:disabled) {
    background: #8f2b32;
    border-color: #8f2b32;
  }
}

.lt-input {
  width: 100%;
  box-sizing: border-box;
  height: 4.4vh;
  min-height: 34px;
  padding: 0 1.2vh;
  margin-bottom: 1.2vh;
  border: 1px solid rgba(0, 0, 0, 0.35);
  border-radius: 0;
  background: rgba(255, 255, 255, 0.6);
  color: #1a1a1a;
  font: inherit;
  font-size: 1.4vh;
  outline: none;
  &::placeholder {
    color: rgba(26, 26, 26, 0.35);
  }
  &:focus {
    border-color: #1a1a1a;
    background: #fff;
  }
}

.action-hint {
  font-size: 1.2vh;
  line-height: 1.6;
  letter-spacing: 0.06vh;
  color: rgba(26, 26, 26, 0.42);
  &.error {
    color: #a13b42;
  }
}

.lobby-foot {
  font-size: 1.3vh;
  letter-spacing: 0.2vh;
  color: rgba(26, 26, 26, 0.4);
}

/* ---------- 房间顶部 ---------- */
.room-bar {
  margin-top: 2.4vh;
  padding-bottom: 1.4vh;
  border-bottom: 1Px solid rgba(0, 0, 0, 0.18);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 2vw;
  .room-id {
    display: flex;
    align-items: baseline;
    gap: 1.2vh;
    min-width: 0;
    .room-label {
      font-size: 1.2vh;
      font-weight: bold;
      letter-spacing: 0.4vh;
      color: rgba(26, 26, 26, 0.38);
    }
    .room-value {
      font-size: 2.3vh;
      font-weight: bold;
      letter-spacing: 0.18vh;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .room-role {
      padding: 0.35vh 0.9vh;
      border: 1px solid rgba(0, 0, 0, 0.4);
      font-size: 1.1vh;
      font-weight: bold;
      letter-spacing: 0.2vh;
      color: rgba(26, 26, 26, 0.6);
    }
  }
  .room-bar-actions {
    display: flex;
    align-items: center;
    gap: 1.2vh;
    flex-shrink: 0;
  }
}

/* ---------- 房间主区 ---------- */
.room-grid {
  margin-top: 2.2vh;
  display: grid;
  grid-template-columns: minmax(0, 1.15fr) minmax(290px, 0.85fr);
  gap: 2.2vw;
  align-items: stretch;
}

.now-card {
  border: 1px solid rgba(0, 0, 0, 0.38);
  background: rgba(255, 255, 255, 0.5);
  padding: 2vh 1.7vw;
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.now-head,
.side-head,
.queue-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1vw;
}

.card-index {
  font-size: 1.2vh;
  font-weight: bold;
  letter-spacing: 0.42vh;
  color: rgba(26, 26, 26, 0.4);
  i {
    font-style: normal;
    color: rgba(0, 0, 0, 0.25);
    margin: 0 0.5vh;
  }
}

.now-source {
  font-size: 1.1vh;
  font-weight: bold;
  letter-spacing: 0.2vh;
  padding: 0.3vh 0.8vh;
  border: 1px solid rgba(0, 0, 0, 0.35);
  color: rgba(26, 26, 26, 0.6);
  &.local {
    border-style: dashed;
    color: rgba(26, 26, 26, 0.38);
  }
}

.now-main {
  flex: 1;
  display: flex;
  align-items: stretch;
  gap: 2.2vw;
  padding-top: 2.2vh;
  min-width: 0;
}

.now-cover {
  position: relative;
  flex-shrink: 0;
  align-self: center;
  width: auto;
  height: clamp(260px, 34vh, 380px);
  aspect-ratio: 1 / 1;
  border: 1px solid rgba(0, 0, 0, 0.35);
  background: rgba(0, 0, 0, 0.04);
  overflow: hidden;
  img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }
  .cover-fallback {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 5vh;
    font-weight: bold;
    letter-spacing: 0.5vh;
    color: rgba(26, 26, 26, 0.25);
  }
  .corner {
    width: 1.3vh;
    height: 1.3vh;
    position: absolute;
    z-index: 2;
    border: 0 solid #1a1a1a;
    pointer-events: none;
  }
  .c1 { top: 5Px; left: 5Px; border-top-width: 2Px; border-left-width: 2Px; }
  .c2 { top: 5Px; right: 5Px; border-top-width: 2Px; border-right-width: 2Px; }
  .c3 { bottom: 5Px; right: 5Px; border-bottom-width: 2Px; border-right-width: 2Px; }
  .c4 { bottom: 5Px; left: 5Px; border-bottom-width: 2Px; border-left-width: 2Px; }
}

.now-info {
  flex: 1;
  min-width: 0;
  min-height: clamp(260px, 34vh, 380px);
  display: flex;
  flex-direction: column;
  .now-titles {
    flex-shrink: 0;
    padding-bottom: 1.1vh;
    border-bottom: 1Px solid rgba(0, 0, 0, 0.14);
  }
  .now-name {
    margin: 0;
    font-size: clamp(22px, 3.2vh, 38px);
    line-height: 1.18;
    letter-spacing: 0.06vh;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .now-artist {
    margin-top: 1.2vh;
    font-size: 1.7vh;
    font-weight: bold;
    color: rgba(26, 26, 26, 0.62);
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .now-album {
    margin-top: 0.8vh;
    font-size: 1.35vh;
    color: rgba(26, 26, 26, 0.34);
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
}

.lyric-toolbar {
  flex-shrink: 0;
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: 0.9vh;
  padding-top: 0.9vh;
  .lyric-toggle {
    height: 2.4vh;
    min-height: 20px;
    padding: 0 0.7vh;
    border: 1px solid rgba(0, 0, 0, 0.3);
    border-radius: 0;
    background: transparent;
    color: #1a1a1a;
    font: inherit;
    font-size: 1.05vh;
    font-weight: bold;
    letter-spacing: 0.1vh;
    cursor: pointer;
    transition: 0.15s;
    &.off {
      opacity: 0.28;
    }
    &:hover {
      opacity: 0.6;
    }
  }
}

.lyric-viewport {
  flex: 1;
  min-height: 96px;
  max-height: 25vh;
  position: relative;
  overflow: hidden;
  margin-top: 0.4vh;
  .lyric-track {
    position: relative;
    padding: 10vh 0 12vh;
    transition: transform 0.3s cubic-bezier(0.3, 0.79, 0.55, 0.99);
    will-change: transform;
  }
  .lyric-line {
    position: relative;
    text-align: left;
    font-size: 1.7vh;
    font-weight: bold;
    color: rgba(26, 26, 26, 0.55);
    padding: 0.5vh 1.1vh;
    margin: 0 0 1.8vh 0;
    overflow: hidden;
    &::before {
      content: '';
      position: absolute;
      inset: 0;
      background: #000;
      transform: scaleX(0);
      transform-origin: left center;
      transition: transform 0.22s cubic-bezier(0.3, 0.79, 0.55, 0.99);
      transition-delay: var(--d, 0s);
    }
    .lyric-text,
    .lyric-rtext,
    .lyric-ttext {
      position: relative;
      z-index: 1;
      display: block;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      transition: color 0.18s, filter 0.18s;
      transition-delay: var(--d, 0s);
    }
    .lyric-rtext,
    .lyric-ttext {
      font-size: 1.3vh;
    }
    .lyric-rtext {
      margin-bottom: 0.2vh;
    }
    .lyric-ttext {
      margin-top: 0.2vh;
    }
    &.on {
      .lyric-text,
      .lyric-rtext,
      .lyric-ttext {
        color: #fff;
      }
      .lyric-rtext,
      .lyric-ttext {
        opacity: 0.85;
      }
      &::before {
        transform: scaleX(1);
      }
    }
  }
  .lyric-empty {
    position: relative;
    z-index: 1;
    margin: 3vh 0 0;
    text-align: center;
    font-size: 1.35vh;
    letter-spacing: 0.14vh;
    color: rgba(26, 26, 26, 0.32);
  }
}

.now-bottom {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 2vw;
  margin-top: 1.8vh;
}

.now-progress {
  position: relative;
  flex: 1;
  min-width: 0;
  .timecode {
    position: absolute;
    top: -1.7vh;
    left: 0;
    font-size: 1.35vh;
    font-weight: bold;
    letter-spacing: 0.14vh;
    color: rgba(26, 26, 26, 0.62);
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.18s;
  }
  &:hover .timecode {
    opacity: 1;
  }
  .lt-progress {
    cursor: pointer;
    padding: 0.8vh 0;
    .lt-progress-line {
      position: relative;
      height: 2Px;
      background: rgba(0, 0, 0, 0.18);
      transition: height 0.18s;
      .lt-progress-fill {
        height: 100%;
        background: #1a1a1a;
      }
      .lt-progress-dot {
        position: absolute;
        top: 50%;
        width: 8Px;
        height: 8Px;
        border-radius: 50%;
        background: #1a1a1a;
        transform: translate(-50%, -50%);
        opacity: 0;
        transition: opacity 0.2s;
      }
    }
    &:hover .lt-progress-line {
      height: 4Px;
    }
    &:hover .lt-progress-dot {
      opacity: 1;
    }
  }
}

@media (hover: none) {
  .now-progress .timecode {
    opacity: 1;
  }
}

.now-volume {
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
      align-items: center;
      justify-content: space-between;
      position: absolute;
      top: -11Px;
      left: 0;
      width: 100%;
      font: 8Px Geometos;
      color: rgb(106, 106, 106);
      span:last-child {
        color: #1a1a1a;
      }
    }
  }
}

.now-controls {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 2.4vh;
  .ctrl-btn {
    width: 3.1vh;
    height: 3.1vh;
    padding: 0;
    border: 0;
    border-radius: 0;
    background: transparent;
    color: #1a1a1a;
    cursor: pointer;
    transition: opacity 0.15s;
    display: flex;
    align-items: center;
    justify-content: center;
    svg {
      width: 100%;
      height: 100%;
      display: block;
      overflow: visible;
    }
    &:hover {
      background: transparent;
      color: #1a1a1a;
      opacity: 0.55;
    }
    &.play {
      width: 3.6vh;
      height: 3.6vh;
      background: transparent;
      color: #1a1a1a;
      border: 0;
      &:hover {
        background: transparent;
        color: #1a1a1a;
        opacity: 0.55;
      }
    }
  }
}

/* ---------- 右侧栏 ---------- */
.side-col {
  display: flex;
  flex-direction: column;
  gap: 1.5vh;
  min-width: 0;
}

.side-card {
  border: 1px solid rgba(0, 0, 0, 0.38);
  background: rgba(255, 255, 255, 0.42);
  padding: 1.8vh 1.3vw;
  .side-count,
  .sync-state {
    font-size: 1.15vh;
    font-weight: bold;
    letter-spacing: 0.18vh;
    color: rgba(26, 26, 26, 0.45);
  }
  .sync-state.online {
    color: #1a1a1a;
  }
  .lt-btn {
    width: 100%;
  }
}

.member-list {
  margin-top: 1.4vh;
  display: flex;
  flex-direction: column;
  gap: 1vh;
}

.member {
  display: flex;
  align-items: center;
  gap: 1.2vh;
  padding: 0.9vh 0.8vh;
  border-bottom: 1Px solid rgba(0, 0, 0, 0.08);
  &:last-child {
    border-bottom: none;
  }
  img,
  .member-avatar {
    width: 3.4vh;
    height: 3.4vh;
    min-width: 26px;
    min-height: 26px;
    border-radius: 50%;
    border: 1px solid rgba(0, 0, 0, 0.3);
    object-fit: cover;
  }
  .member-avatar {
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 1.4vh;
    font-weight: bold;
    background: rgba(0, 0, 0, 0.06);
  }
  .member-meta {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 0.35vh;
    .member-name {
      font-size: 1.45vh;
      font-weight: bold;
      overflow: hidden;
      white-space: nowrap;
      text-overflow: ellipsis;
    }
    .member-role {
      font-size: 1.05vh;
      letter-spacing: 0.2vh;
      color: rgba(26, 26, 26, 0.4);
    }
  }
  .member-online {
    width: 6Px;
    height: 6Px;
    border-radius: 50%;
    background: #1a1a1a;
    flex-shrink: 0;
  }
}

.empty-line {
  padding: 1.4vh 0;
  font-size: 1.3vh;
  color: rgba(26, 26, 26, 0.38);
}

.invite-link {
  margin: 1.2vh 0 1.4vh;
  padding: 1vh;
  border: 1px dashed rgba(0, 0, 0, 0.28);
  background: rgba(0, 0, 0, 0.025);
  font-size: 1.15vh;
  line-height: 1.6;
  color: rgba(26, 26, 26, 0.6);
  word-break: break-all;
  user-select: text;
  min-height: 4.6vh;
}

.sync-meta {
  margin: 1.2vh 0 1.6vh;
  display: flex;
  flex-direction: column;
  gap: 0.8vh;
  div {
    display: flex;
    justify-content: space-between;
    gap: 1vw;
    font-size: 1.3vh;
  }
  dt {
    color: rgba(26, 26, 26, 0.42);
  }
  dd {
    margin: 0;
    font-weight: bold;
    color: rgba(26, 26, 26, 0.8);
  }
}

/* ---------- 共享队列 ---------- */
.queue-card {
  margin-top: 2.2vh;
  border: 1px solid rgba(0, 0, 0, 0.38);
  background: rgba(255, 255, 255, 0.42);
  padding: 1.8vh 1.7vw 1.4vh;
}

.queue-count {
  font-size: 1.15vh;
  font-weight: bold;
  letter-spacing: 0.18vh;
  color: rgba(26, 26, 26, 0.42);
}

.queue-body {
  margin-top: 1.2vh;
  height: 32vh;
  min-height: 210px;
}

.queue-scroller {
  height: 100%;
}

.queue-item {
  display: grid;
  grid-template-columns: 4.2vh 2.4vh minmax(0, 1fr) auto 6.4vh 3.2vh;
  align-items: center;
  gap: 1.2vh;
  height: 48px;
  padding: 0 0.8vw;
  border-bottom: 1Px solid rgba(0, 0, 0, 0.08);
  cursor: default;
  transition: background-color 0.15s;
  &:hover {
    background: rgba(0, 0, 0, 0.035);
  }
  &.playing {
    background: rgba(0, 0, 0, 0.055);
    .queue-name,
    .queue-index {
      color: #1a1a1a;
    }
  }
  &.local {
    opacity: 0.62;
  }
  .queue-index {
    font-size: 1.15vh;
    font-weight: bold;
    letter-spacing: 0.12vh;
    color: rgba(26, 26, 26, 0.35);
    font-variant-numeric: tabular-nums;
  }
  .queue-meta {
    min-width: 0;
    display: flex;
    align-items: baseline;
    gap: 1vh;
    overflow: hidden;
    .queue-name {
      font-size: 1.4vh;
      font-weight: bold;
      color: rgba(26, 26, 26, 0.82);
      overflow: hidden;
      white-space: nowrap;
      text-overflow: ellipsis;
      flex-shrink: 0;
      max-width: 60%;
    }
    .queue-artist {
      font-size: 1.2vh;
      color: rgba(26, 26, 26, 0.42);
      overflow: hidden;
      white-space: nowrap;
      text-overflow: ellipsis;
    }
  }
  .queue-local-tag {
    padding: 0.2vh 0.6vh;
    border: 1px dashed rgba(0, 0, 0, 0.3);
    font-size: 0.95vh;
    letter-spacing: 0.14vh;
    color: rgba(26, 26, 26, 0.42);
  }
  .queue-time {
    font-size: 1.15vh;
    color: rgba(26, 26, 26, 0.38);
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
  .queue-play {
    width: 2.6vh;
    height: 2.6vh;
    padding: 0.45vh;
    border: 1px solid rgba(0, 0, 0, 0.28);
    border-radius: 0;
    background: transparent;
    color: #1a1a1a;
    cursor: pointer;
    opacity: 0;
    transition: 0.15s;
    svg {
      width: 100%;
      height: 100%;
      fill: currentColor;
    }
    &:hover {
      background: #1a1a1a;
      color: #fff;
    }
  }
  &:hover .queue-play,
  &.playing .queue-play {
    opacity: 1;
  }
}

.queue-eq,
.queue-eq-placeholder {
  width: 2.4vh;
  height: 2vh;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  gap: 2Px;
}
.queue-eq i {
  display: block;
  width: 2Px;
  height: 100%;
  background: #1a1a1a;
  transform-origin: bottom;
  animation: lt-eq 0.8s ease-in-out infinite alternate;
  &:nth-child(2) { animation-delay: 0.18s; }
  &:nth-child(3) { animation-delay: 0.36s; }
}
@keyframes lt-eq {
  from { transform: scaleY(0.22); }
  to { transform: scaleY(1); }
}

.queue-empty {
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 2vh;
  text-align: center;
  font-size: 1.4vh;
  line-height: 1.8;
  color: rgba(26, 26, 26, 0.38);
}

/* ---------- 水印 ---------- */
.lt-watermark {
  position: absolute;
  left: 3.2vw;
  bottom: 1.4vh;
  font-size: 1.6vh;
  font-weight: bold;
  letter-spacing: 1vw;
  color: rgba(0, 0, 0, 0.09);
  pointer-events: none;
  white-space: nowrap;
}

/* 封面/标题切换 */
.lt-fade-enter-active,
.lt-fade-leave-active {
  transition: opacity 0.28s, transform 0.28s;
}
.lt-fade-enter-from {
  opacity: 0;
  transform: translateY(1vh);
}
.lt-fade-leave-to {
  opacity: 0;
  transform: translateY(-1vh);
}

/* ---------- 响应式 ---------- */
@media (max-width: 1120px) {
  .lt-lobby {
    grid-template-columns: 1fr;
    gap: 3vh;
  }
  .room-grid {
    grid-template-columns: 1fr;
  }
  .side-col {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}

@media (max-width: 820px) {
  .now-main {
    flex-direction: column;
    align-items: flex-start;
  }
  .now-cover {
    width: min(52vw, 300px);
    height: auto;
  }
  .now-info {
    width: 100%;
    height: auto;
    min-height: 0;
  }
  .side-col {
    display: flex;
  }
  .room-bar {
    flex-direction: column;
    align-items: flex-start;
    gap: 1.4vh;
  }
  .now-bottom {
    flex-wrap: wrap;
    gap: 1.2vh 2vw;
  }
  .now-progress {
    flex-basis: 100%;
  }
  .now-volume {
    margin-left: auto;
  }
  .queue-item {
    grid-template-columns: 3.4vh 2.2vh minmax(0, 1fr) 5.6vh 3vh;
    .queue-local-tag {
      display: none;
    }
  }
}
</style>
