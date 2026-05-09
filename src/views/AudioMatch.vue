<script setup>
import { ref, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { useRouter } from 'vue-router'
import { noticeOpen } from '../utils/dialog'
import { audioMatch } from '../api/audioMatch'
import { usePlayerStore } from '../store/playerStore'
import { useUserStore } from '../store/userStore'

const router = useRouter()
const playerStore = usePlayerStore()
const userStore = useUserStore()

const DURATION = 3

const status = ref('idle')
const countdown = ref(0)
const canvasRef = ref(null)
const results = ref([])
const logs = ref([])
const error = ref('')

let audioCtx = null
let recorderNode = null
let micSourceNode = null
let micStream = null
let bufferHealth = ref(0)
let audioBuffer = null
let rafId = null
let countdownTimer = null
let scriptsLoaded = false

function log(msg) {
  logs.value.push(`[${new Date().toLocaleTimeString()}] ${msg}`)
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script')
    s.src = src
    s.onload = resolve
    s.onerror = () => reject(new Error(`Failed to load ${src}`))
    document.head.appendChild(s)
  })
}

async function ensureScripts() {
  if (scriptsLoaded) return
  await loadScript('./afp.wasm.js')
  await loadScript('./afp.js')
  scriptsLoaded = true
}

async function initAudio() {
  if (audioCtx) return true
  try {
    audioCtx = new AudioContext({ sampleRate: 8000 })
    await audioCtx.audioWorklet.addModule('./rec.js')
    recorderNode = new AudioWorkletNode(audioCtx, 'timed-recorder')

    recorderNode.port.onmessage = (event) => {
      switch (event.data.message) {
        case 'finished':
          onRecordingFinished(event.data.recording)
          break
        case 'bufferhealth':
          bufferHealth.value = event.data.health
          audioBuffer = event.data.recording
          break
        case '[rec.js] Recording started':
          log('录音已开始')
          break
        case '[rec.js] Recording finished':
          log('录音完成，正在生成指纹...')
          break
      }
    }

    micStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        autoGainControl: false,
        noiseSuppression: false,
        latency: 0,
      },
    })
    micSourceNode = audioCtx.createMediaStreamSource(micStream)
    micSourceNode.connect(recorderNode)
    recorderNode.connect(audioCtx.destination)
    log('麦克风已就绪')
    return true
  } catch (e) {
    console.error('[AudioMatch] init error', e)
    error.value = e.name === 'NotAllowedError'
      ? '麦克风权限被拒绝，请在浏览器设置中允许访问麦克风'
      : '初始化音频失败：' + e.message
    log('初始化失败：' + e.message)
    return false
  }
}

function startRecording() {
  if (!recorderNode) return
  status.value = 'recording'
  countdown.value = DURATION
  results.value = []
  error.value = ''
  bufferHealth.value = 0
  audioBuffer = null

  recorderNode.port.postMessage({ message: 'start', duration: DURATION })

  countdownTimer = setInterval(() => {
    countdown.value = Math.max(0, countdown.value - 0.1)
    if (countdown.value <= 0) clearInterval(countdownTimer)
  }, 100)

  startCanvas()
}

async function onRecordingFinished(recording) {
  stopCanvas()
  clearInterval(countdownTimer)
  countdown.value = 0
  status.value = 'processing'
  log('正在查询识别结果...')

  try {
    const sampleBuffer = new Float32Array(recording.subarray(0, DURATION * 8000))
    const FP = await GenerateFP(sampleBuffer)
    log('指纹生成完成，正在请求 API...')

    const resp = await audioMatch(DURATION, FP)
    if (!resp || !resp.data || !resp.data.result || resp.data.result.length === 0) {
      status.value = 'no-result'
      log('未识别到匹配的歌曲')
      return
    }

    results.value = resp.data.result
    status.value = 'done'
    log(`识别完成，共 ${resp.data.result.length} 个结果`)
  } catch (e) {
    console.error('[AudioMatch] match error', e)
    error.value = '识别请求失败：' + (e.message || '未知错误')
    status.value = 'error'
    log('识别失败：' + e.message)
  }
}

function onClickRecognize() {
  if (status.value === 'recording' || status.value === 'processing') return
  if (!recorderNode) {
    initAudio().then((ok) => {
      if (ok) startRecording()
    })
  } else {
    startRecording()
  }
}

async function onClickPlay(song) {
  try {
    const { getMusicUrl } = await import('../api/song')
    const res = await getMusicUrl(song.id, 'exhigh')
    if (res.data?.[0]?.url) {
      playerStore.play(res.data[0].url, {
        id: song.id,
        name: song.name,
        artist: song.ar || song.artists || [],
        album: song.al || song.album || {},
        picUrl: (song.al || song.album)?.picUrl || '',
      })
    } else {
      noticeOpen('无法获取播放链接', 2)
    }
  } catch (e) {
    noticeOpen('播放失败', 2)
  }
}

function startCanvas() {
  const canvas = canvasRef.value
  if (!canvas) return
  const ctx = canvas.getContext('2d')
  const draw = () => {
    const w = canvas.clientWidth
    const h = canvas.clientHeight
    canvas.width = w
    canvas.height = h
    ctx.clearRect(0, 0, w, h)
    if (audioBuffer) {
      ctx.fillStyle = 'rgba(0,0,0,0.15)'
      for (let x = 0; x < w * bufferHealth.value; x++) {
        const y = audioBuffer[Math.ceil((x / w) * audioBuffer.length)]
        const z = Math.abs(y) * h / 2
        ctx.fillRect(x, h / 2 - (y > 0 ? z : 0), 1, Math.max(z, 1))
      }
    }
    rafId = requestAnimationFrame(draw)
  }
  draw()
}

function stopCanvas() {
  if (rafId) cancelAnimationFrame(rafId)
  rafId = null
}

function formatArtists(song) {
  const artists = song.ar || song.artists || []
  return artists.map((a) => a.name).join(' / ')
}

function formatAlbum(song) {
  return (song.al || song.album)?.name || ''
}

function formatTime(ms) {
  if (!ms && ms !== 0) return ''
  const s = Math.floor(ms / 1000)
  const m = Math.floor(s / 60)
  const sec = s % 60
  return `${m}:${String(sec).padStart(2, '0')}`
}

onMounted(async () => {
  await ensureScripts()
})

onBeforeUnmount(() => {
  stopCanvas()
  clearInterval(countdownTimer)
  if (micSourceNode) {
    try { micSourceNode.disconnect() } catch {}
  }
  if (micStream) {
    micStream.getTracks().forEach((t) => t.stop())
  }
  if (audioCtx && audioCtx.state !== 'closed') {
    audioCtx.close().catch(() => {})
  }
})
</script>

<template>
  <div class="audio-match" v-if="userStore.audioMatchPage">
    <div class="match-left">
      <div class="match-title">
        <div class="title-tip"></div>
        <div class="title-name">听歌识曲</div>
      </div>
      <div class="match-panel">
        <div class="panel-content">
          <div class="mic-area">
            <div
              class="mic-btn"
              :class="{ 'mic-recording': status === 'recording', 'mic-processing': status === 'processing' }"
              @click="onClickRecognize"
            >
              <svg v-if="status !== 'processing'" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M12 1C10.34 1 9 2.34 9 4V12C9 13.66 10.34 15 12 15C13.66 15 15 13.66 15 12V4C15 2.34 13.66 1 12 1Z" fill="currentColor"/>
                <path d="M17 12C17 14.76 14.76 17 12 17C9.24 17 7 14.76 7 12H5C5 15.53 7.61 18.43 11 18.92V22H13V18.92C16.39 18.43 19 15.53 19 12H17Z" fill="currentColor"/>
              </svg>
              <div v-else class="loading-spinner"></div>
            </div>
            <div class="countdown" v-if="status === 'recording'">
              {{ countdown.toFixed(1) }}s
            </div>
            <div class="mic-hint" v-if="status === 'idle'">点击开始识别</div>
            <div class="mic-hint" v-if="status === 'recording'">正在聆听...</div>
            <div class="mic-hint" v-if="status === 'processing'">识别中...</div>
          </div>
          <canvas ref="canvasRef" class="waveform" :class="{ 'waveform-active': status === 'recording' }"></canvas>
          <div class="error-msg" v-if="error">{{ error }}</div>
        </div>
        <div class="panel-footer">
          <div class="footer-line"></div>
          <div class="footer-title">AUDIO MATCH</div>
        </div>
      </div>
    </div>

    <div class="match-right">
      <div class="result-section" v-if="results.length > 0">
        <div class="result-title">识别结果</div>
        <div class="result-list">
          <div class="result-item" v-for="(item, index) in results" :key="index" @dblclick="onClickPlay(item.song)">
            <div class="item-index">{{ index + 1 }}</div>
            <div class="item-info">
              <div class="item-name">{{ item.song.name }}</div>
              <div class="item-detail">
                <span class="item-artist">{{ formatArtists(item.song) }}</span>
                <span class="item-sep">-</span>
                <span class="item-album">{{ formatAlbum(item.song) }}</span>
              </div>
            </div>
            <div class="item-time">{{ formatTime(item.startTime) }}</div>
          </div>
        </div>
      </div>

      <div class="result-section" v-if="status === 'no-result'">
        <div class="result-empty">未识别到匹配的歌曲，请重试</div>
      </div>

      <div class="log-section" v-if="logs.length > 0">
        <div class="log-title">日志</div>
        <div class="log-list">
          <div class="log-item" v-for="(item, index) in logs" :key="index">{{ item }}</div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped lang="scss">
.audio-match {
  width: 100%;
  height: calc(100% - 110Px);
  display: flex;
  flex-direction: row;

  .match-left {
    width: 55%;
    max-width: 450Px;
    height: 100%;

    .match-title {
      margin-bottom: 5Px;
      display: flex;
      flex-direction: row;
      align-items: center;

      .title-tip {
        margin-right: 5Px;
        width: 6Px;
        height: 6Px;
        background-color: black;
      }

      .title-name {
        font: 16Px SourceHanSansCN-Bold;
        text-align: left;
        color: black;
      }
    }

    .match-panel {
      height: calc(100% - 29Px);
      background-color: rgba(255, 255, 255, 0.30);
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      position: relative;

      .panel-content {
        flex: 1;
        padding: 30Px 20Px;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;

        .mic-area {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 12Px;

          .mic-btn {
            width: 80Px;
            height: 80Px;
            border-radius: 50%;
            background-color: black;
            color: white;
            display: flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            transition: all 0.3s;
            position: relative;

            svg {
              width: 32Px;
              height: 32Px;
            }

            &:hover {
              transform: scale(1.05);
            }

            &:active {
              transform: scale(0.95);
            }

            &.mic-recording {
              animation: pulse 1.5s ease-in-out infinite;
              background-color: #e53e3e;
            }

            &.mic-processing {
              opacity: 0.7;
              cursor: not-allowed;
            }
          }

          .countdown {
            font: 24Px SourceHanSansCN-Bold;
            color: black;
          }

          .mic-hint {
            font: 12Px SourceHanSansCN-Bold;
            color: rgba(0, 0, 0, 0.5);
          }
        }

        .waveform {
          width: 100%;
          height: 0;
          transition: height 0.2s;
          background: rgba(0, 0, 0, 0.03);
          border-radius: 4Px;
          margin-top: 20Px;

          &.waveform-active {
            height: 80Px;
          }
        }

        .error-msg {
          margin-top: 16Px;
          padding: 8Px 12Px;
          background: #fef3c7;
          border-radius: 4Px;
          font: 11Px SourceHanSansCN-Bold;
          color: #92400e;
          text-align: center;
        }
      }

      .panel-footer {
        padding: 0 10Px 8Px;

        .footer-line {
          height: 0.5Px;
          background-color: black;
        }

        .footer-title {
          font: 9Px Source Han Sans;
          color: rgb(181, 181, 181);
          text-align: right;
          margin-top: 4Px;
        }
      }
    }
  }

  .match-right {
    margin-top: 29Px;
    margin-left: 50Px;
    width: 100%;
    height: calc(100% - 29Px);
    overflow-y: auto;

    &::-webkit-scrollbar {
      display: none;
    }

    .result-section {
      margin-bottom: 24Px;

      .result-title {
        font: 14Px SourceHanSansCN-Bold;
        color: black;
        margin-bottom: 12Px;
      }

      .result-empty {
        font: 12Px SourceHanSansCN-Bold;
        color: rgba(0, 0, 0, 0.4);
        padding: 20Px;
        text-align: center;
      }

      .result-list {
        .result-item {
          display: flex;
          flex-direction: row;
          align-items: center;
          padding: 10Px 12Px;
          transition: 0.15s;
          border-radius: 4Px;

          &:hover {
            background-color: rgba(0, 0, 0, 0.05);
            cursor: pointer;
          }

          &:active {
            background-color: rgba(0, 0, 0, 0.1);
          }

          .item-index {
            width: 24Px;
            font: 12Px SourceHanSansCN-Bold;
            color: rgba(0, 0, 0, 0.3);
            text-align: center;
            flex-shrink: 0;
          }

          .item-info {
            flex: 1;
            min-width: 0;
            margin-left: 8Px;

            .item-name {
              font: 13Px SourceHanSansCN-Bold;
              color: black;
              overflow: hidden;
              text-overflow: ellipsis;
              white-space: nowrap;
            }

            .item-detail {
              margin-top: 2Px;
              font: 10Px SourceHanSansCN-Bold;
              color: rgba(0, 0, 0, 0.4);
              overflow: hidden;
              text-overflow: ellipsis;
              white-space: nowrap;

              .item-sep {
                margin: 0 4Px;
              }
            }
          }

          .item-time {
            margin-left: 12Px;
            font: 10Px SourceHanSansCN-Bold;
            color: rgba(0, 0, 0, 0.3);
            flex-shrink: 0;
          }
        }
      }
    }

    .log-section {
      .log-title {
        font: 12Px SourceHanSansCN-Bold;
        color: rgba(0, 0, 0, 0.4);
        margin-bottom: 8Px;
      }

      .log-list {
        padding: 10Px;
        background: rgba(0, 0, 0, 0.03);
        border-radius: 4Px;
        max-height: 200Px;
        overflow-y: auto;

        &::-webkit-scrollbar {
          display: none;
        }

        .log-item {
          font: 10Px 'Courier New', monospace;
          color: rgba(0, 0, 0, 0.5);
          line-height: 1.8;
          word-break: break-all;
        }
      }
    }
  }
}

.loading-spinner {
  width: 24Px;
  height: 24Px;
  border: 3Px solid rgba(255, 255, 255, 0.3);
  border-top-color: white;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

@keyframes pulse {
  0%, 100% { box-shadow: 0 0 0 0 rgba(229, 62, 62, 0.4); }
  50% { box-shadow: 0 0 0 15Px rgba(229, 62, 62, 0); }
}
</style>
