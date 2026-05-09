<script setup>
import { ref, onMounted, onActivated, onBeforeUnmount } from 'vue'
import { useRouter } from 'vue-router'
import { noticeOpen } from '../utils/dialog'
import { audioMatch } from '../api/audioMatch'
import { addToNext } from '../utils/player'
import { useUserStore } from '../store/userStore'

const router = useRouter()
const userStore = useUserStore()

const status = ref('idle')
const countdown = ref(0)
const elapsed = ref(0)
const maxDuration = ref(5)
const canvasRef = ref(null)
const results = ref([])
const noResult = ref(false)
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

function initAudio() {
  if (audioCtx && recorderNode) return Promise.resolve(true)
  return new Promise((resolve) => {
    audioCtx = new AudioContext({ sampleRate: 8000 })

    function tryInit() {
      if (audioCtx.state === 'suspended') {
        audioCtx.resume().then(() => {
          if (audioCtx.state === 'suspended') {
            log('AudioContext 仍为 suspended, 100ms 后重试...')
            setTimeout(tryInit, 100)
            return
          }
          setupWorklet()
        }).catch(() => {
          setTimeout(tryInit, 100)
        })
        return
      }
      setupWorklet()
    }

    function setupWorklet() {
      log('AudioContext state: ' + audioCtx.state)
      audioCtx.audioWorklet.addModule('./rec.js').then(() => {
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
            default:
              log(event.data.message)
          }
        }

        // 获取系统音频：Electron 通过 desktopCapturer IPC，Web 通过 getDisplayMedia
        if (typeof windowApi.getDesktopSources === 'function') {
          windowApi.getDesktopSources().then(sources => {
            const screenSource = sources.find(s => s.id.startsWith('screen:')) || sources[0]
            if (!screenSource) { resolve(false); error.value = '未找到屏幕源'; return }
            return navigator.mediaDevices.getUserMedia({
              audio: { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: screenSource.id } },
              video: { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: screenSource.id } },
            })
          }).then(stream => {
            if (!stream) return
            stream.getVideoTracks().forEach(t => t.stop())
            micStream = stream
            micSourceNode = audioCtx.createMediaStreamSource(micStream)
            micSourceNode.connect(recorderNode)
            log('系统音频已就绪')
            resolve(true)
          }).catch(e => {
            error.value = '获取系统音频失败：' + e.message
            log('系统音频获取失败：' + e.message)
            resolve(false)
          })
        } else {
          navigator.mediaDevices.getDisplayMedia({ audio: true, video: true }).then(displayStream => {
            displayStream.getVideoTracks().forEach(t => t.stop())
            micStream = new MediaStream(displayStream.getAudioTracks())
            micSourceNode = audioCtx.createMediaStreamSource(micStream)
            micSourceNode.connect(recorderNode)
            log('系统音频已就绪')
            resolve(true)
          }).catch(e => {
            error.value = '获取系统音频失败：' + e.message
            log('系统音频获取失败：' + e.message)
            resolve(false)
          })
        }
      }).catch(e => {
        error.value = '加载录音模块失败：' + e.message
        log('worklet 加载失败：' + e.message)
        resolve(false)
      })
    }

    tryInit()
  })
}

function startRecording() {
  if (!recorderNode || !audioCtx) return
  if (audioCtx.state === 'suspended') {
    audioCtx.resume().then(() => doStartRecording())
    return
  }
  doStartRecording()
}

function doStartRecording() {
  status.value = 'recording'
  const dur = Math.min(Math.max(Number(maxDuration.value) || 5, 1), 15)
  maxDuration.value = dur
  countdown.value = dur
  elapsed.value = 0
  results.value = []
  noResult.value = false
  error.value = ''
  bufferHealth.value = 0
  audioBuffer = null

  recorderNode.port.postMessage({ message: 'start', duration: dur })

  countdownTimer = setInterval(() => {
    elapsed.value = Math.min(dur, elapsed.value + 0.1)
    countdown.value = Math.max(0, dur - elapsed.value)
    if (countdown.value <= 0) {
      clearInterval(countdownTimer)
    }
  }, 100)

  startCanvas()
}

function stopRecording() {
  if (status.value !== 'recording' || !recorderNode) return
  clearInterval(countdownTimer)
  recorderNode.port.postMessage({ message: 'stop' })
}

async function onRecordingFinished(recording) {
  stopCanvas()
  clearInterval(countdownTimer)
  countdown.value = 0
  status.value = 'processing'
  noResult.value = false
  // 计算实际录音时长（秒）
  const actualDuration = Math.round(elapsed.value) || 1
  const sampleCount = actualDuration * 8000
  log('录音数据已接收，时长: ' + actualDuration + 's, 样本: ' + sampleCount)

  try {
    const sampleBuffer = new Float32Array(recording.subarray(0, sampleCount))
    const hasSignal = sampleBuffer.some((v) => Math.abs(v) > 0.001)
    log('有效样本: ' + sampleBuffer.length + ', 有信号: ' + hasSignal)
    if (!hasSignal) {
      log('警告: 录音数据全为静音，请检查麦克风')
    }

    if (typeof GenerateFP !== 'function') {
      throw new Error('GenerateFP 未加载，请刷新页面重试')
    }
    log('正在生成音频指纹...')
    const FP = await GenerateFP(sampleBuffer)
    log('指纹长度: ' + (FP ? FP.length : 0) + ' 字符')
    if (!FP || FP.length === 0) {
      throw new Error('指纹生成失败，返回为空')
    }
    log('指纹前20字符: ' + FP.substring(0, 20) + '...')

    log('正在请求 API...')
    const resp = await audioMatch(actualDuration, FP)
    log('API 响应: ' + JSON.stringify(resp).substring(0, 200))

    if (!resp || resp.code !== 200) {
      noResult.value = true
      log('API 返回错误: ' + JSON.stringify(resp))
      return
    }
    const resultData = resp.data?.result || resp.result || (Array.isArray(resp.data) ? resp.data : null)
    if (!resultData || resultData.length === 0) {
      noResult.value = true
      log('未识别到匹配的歌曲')
      return
    }

    results.value = resultData
    log(`识别完成，共 ${resultData.length} 个结果`)
  } catch (e) {
    console.error('[AudioMatch] match error', e)
    error.value = '识别请求失败：' + (e.message || '未知错误')
    log('识别失败：' + e.message)
  } finally {
    status.value = 'idle'
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

function onClickPlay(song) {
  const songData = {
    id: song.id,
    name: song.name,
    ar: song.ar || song.artists || [],
    al: song.al || song.album || {},
    dt: song.dt || 0,
  }
  addToNext(songData, true)
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

onActivated(() => {})

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
            <div v-if="status !== 'recording' && status !== 'processing'" class="duration-control">
              <span class="duration-label">识别时长</span>
              <input type="range" v-model.number="maxDuration" min="1" max="15" step="1" class="duration-slider">
              <span class="duration-value">{{ maxDuration }}s</span>
            </div>
            <div
              class="mic-btn"
              :class="{ 'mic-recording': status === 'recording', 'mic-processing': status === 'processing' }"
              @click="status === 'recording' ? stopRecording() : onClickRecognize()"
            >
              <svg v-if="status === 'idle'" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M12 1C10.34 1 9 2.34 9 4V12C9 13.66 10.34 15 12 15C13.66 15 15 13.66 15 12V4C15 2.34 13.66 1 12 1Z" fill="currentColor"/>
                <path d="M17 12C17 14.76 14.76 17 12 17C9.24 17 7 14.76 7 12H5C5 15.53 7.61 18.43 11 18.92V22H13V18.92C16.39 18.43 19 15.53 19 12H17Z" fill="currentColor"/>
              </svg>
              <div v-else-if="status === 'recording'" class="stop-icon"></div>
              <div v-else class="loading-spinner"></div>
            </div>
            <div class="countdown" v-if="status === 'recording'">
              {{ elapsed.toFixed(1) }}s / {{ maxDuration }}s
            </div>
            <div class="mic-hint" v-if="status === 'idle'">点击识别系统音频</div>
            <div class="mic-hint" v-if="status === 'recording'">点击停止识别</div>
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

      <div class="result-section" v-if="noResult">
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

          .duration-control {
            display: flex;
            align-items: center;
            gap: 10Px;

            .duration-label {
              font: 11Px SourceHanSansCN-Bold;
              color: rgba(0, 0, 0, 0.5);
              white-space: nowrap;
            }

            .duration-slider {
              width: 100Px;
              height: 3Px;
              -webkit-appearance: none;
              appearance: none;
              background: rgba(0, 0, 0, 0.15);
              border-radius: 2Px;
              outline: none;
              cursor: pointer;

              &::-webkit-slider-thumb {
                -webkit-appearance: none;
                width: 12Px;
                height: 12Px;
                border-radius: 50%;
                background: black;
                cursor: pointer;
              }
            }

            .duration-value {
              font: 11Px SourceHanSansCN-Bold;
              color: black;
              min-width: 22Px;
              text-align: right;
            }
          }

          .stop-icon {
            width: 22Px;
            height: 22Px;
            background: white;
            border-radius: 3Px;
          }

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
