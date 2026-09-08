<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'

const currentLrc = ref('Hydrogen Music - 桌面歌词')
const transLrc = ref('')
const romaLrc = ref('')
const isPlaying = ref(false)
const isHovered = ref(false)
const isLocked = ref(false)
const showUnlockBtn = ref(false)

const lyricPayload = ref(null)
const currentLineProgress = ref(0)
let animFrameId = null

const config = ref({
    fontSize: 28,
    tfontSize: 16,
    opacity: 0.95,
    chineseFont: 'SourceHanSansCN-Bold',
    japaneseFont: 'Yu Gothic',
    westernFont: 'Gilroy-ExtraBold',
    fontColor: '#ffffff',
    highlightColor: '#EC4141',
    karaokeMode: true,
    playedColor: '#31C27C',
    unplayedColor: '#FFFFFF',
    gradientEnabled: false,
    gradientStart: '#31C27C',
    gradientEnd: '#00F2FE',
    gradientAngle: 90,
    strokeWidth: 0.6,
    strokeColor: 'rgba(0, 0, 0, 0.6)',
    shadowBlur: 6,
    shadowColor: 'rgba(0, 0, 0, 0.5)',
    stylePreset: 'modern',
    showTranslation: true,
    showRoma: true,
})

const updateProgressLoop = () => {
    if (lyricPayload.value && lyricPayload.value.lineDuration > 0) {
        const { lineStartTime, lineDuration, progress, playing, syncTime } = lyricPayload.value
        let currentSeek = Number(progress || 0)
        if (playing) {
            const elapsed = (Date.now() - (syncTime || Date.now())) / 1000
            currentSeek += elapsed
        }
        // 加入 150ms 声学提前量补偿，使视觉进度与歌手发音起音时刻毫秒精准对齐
        const effectiveSeek = currentSeek + 0.15
        const ratio = (effectiveSeek - lineStartTime) / lineDuration
        currentLineProgress.value = Math.max(0, Math.min(1, ratio)) * 100
    } else {
        currentLineProgress.value = 100
    }
    animFrameId = requestAnimationFrame(updateProgressLoop)
}

const playedPercent = computed(() => {
    if (config.value.karaokeMode === false) return 100
    return Math.max(0, Math.min(100, currentLineProgress.value))
})

const lyricStyle = computed(() => {
    const sw = Number(config.value.strokeWidth ?? 0.6)
    const sc = config.value.strokeColor || 'rgba(0, 0, 0, 0.6)'
    const sb = Number(config.value.shadowBlur ?? 6)
    const shadowColor = config.value.shadowColor || 'rgba(0, 0, 0, 0.5)'

    let textShadow = 'none'
    if (sb > 0) {
        textShadow = `0 2px ${sb}px ${shadowColor}, 0 1px 3px rgba(0, 0, 0, 0.4)`
    }

    return {
        '--font-western': config.value.westernFont || 'Gilroy-ExtraBold',
        '--font-chinese': config.value.chineseFont || 'SourceHanSansCN-Bold',
        '--font-japanese': config.value.japaneseFont || 'Yu Gothic',
        '--font-size': `${config.value.fontSize || 28}px`,
        '--tfont-size': `${config.value.tfontSize || 16}px`,
        '--text-opacity': config.value.opacity ?? 0.95,
        '--text-color': config.value.fontColor || '#ffffff',
        '--played-color': config.value.playedColor || '#31C27C',
        '--unplayed-color': config.value.unplayedColor || '#ffffff',
        '--stroke-width': `${sw}px`,
        '--stroke-color': sw > 0 ? sc : 'transparent',
        '--text-shadow': textShadow,
    }

    if (isGrad) {
        const gStart = config.value.gradientStart || '#31c27c'
        const gEnd = config.value.gradientEnd || '#00f2fe'
        const gAngle = Number(config.value.gradientAngle ?? 90)
        res['--text-gradient'] = `linear-gradient(${gAngle}deg, ${gStart}, ${gEnd})`
    } else {
        res['--text-gradient'] = 'none'
    }

    return res
})

const togglePlay = () => window.windowApi?.sendDesktopLyricAction('togglePlay')
const prevSong = () => window.windowApi?.sendDesktopLyricAction('prev')
const nextSong = () => window.windowApi?.sendDesktopLyricAction('next')
const toggleLock = () => {
    isLocked.value = !isLocked.value
    window.windowApi?.setDesktopLyricLock(isLocked.value)
}
const adjustFontSize = (delta) => {
    config.value.fontSize = Math.min(48, Math.max(16, (config.value.fontSize || 28) + delta))
    window.windowApi?.sendDesktopLyricAction('saveConfig', config.value)
}
const openSettings = () => window.windowApi?.sendDesktopLyricAction('openSettings')
const closeLyric = () => window.windowApi?.closeDesktopLyric()
const onUnlockEnter = () => {
    if (isLocked.value) {
        showUnlockBtn.value = true
        window.windowApi?.setDesktopLyricIgnoreMouse(false)
    }
}
const onUnlockLeave = () => {
    if (isLocked.value) {
        showUnlockBtn.value = false
        window.windowApi?.setDesktopLyricIgnoreMouse(true, { forward: true })
    }
}

onMounted(() => {
    animFrameId = requestAnimationFrame(updateProgressLoop)
    window.windowApi?.onDesktopLyricData((data) => {
        if (!data) return
        lyricPayload.value = data
        currentLrc.value = data.currentLrc || (data.title ? `${data.title} - ${data.artist}` : 'Hydrogen Music')
        transLrc.value = data.transLrc || ''
        romaLrc.value = data.romaLrc || ''
        isPlaying.value = !!data.playing
    })

    window.windowApi?.onDesktopLyricConfig((cfg) => {
        if (cfg) config.value = { ...config.value, ...cfg }
    })

    window.windowApi?.onDesktopLyricLockStatus((status) => {
        isLocked.value = !!status
        if (!isLocked.value) showUnlockBtn.value = false
    })
})

onUnmounted(() => {
    if (animFrameId) cancelAnimationFrame(animFrameId)
})
</script>

<template>
  <div
    class="desktop-lyric-container"
    :class="{ locked: isLocked, hovering: isHovered && !isLocked }"
    :style="lyricStyle"
    @mouseenter="isHovered = true"
    @mouseleave="isHovered = false"
  >
    <!-- 悬浮控制工具栏（锁定状态下自动隐藏以实现完全穿透） -->
    <div class="hover-toolbar" v-show="!isLocked">
      <div class="drag-handle" title="拖拽移动窗口">
        <svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M10 9h4V6h3l-5-5-5 5h3v3zm-1 1H6V7l-5 5 5 5v-3h3v-4zm14 2l-5-5v3h-3v4h3v3l5-5zm-9 3h-4v3H7l5 5 5-5h-3v-3z"/></svg>
      </div>
      <div class="tool-btn" @click="prevSong" title="上一首">
        <svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M6 6h2v12H6zm3.5 6l8.5 6V6z"/></svg>
      </div>
      <div class="tool-btn" @click="togglePlay" :title="isPlaying ? '暂停' : '播放'">
        <svg v-if="isPlaying" viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>
        <svg v-else viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M8 5v14l11-7z"/></svg>
      </div>
      <div class="tool-btn" @click="nextSong" title="下一首">
        <svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z"/></svg>
      </div>
      <div class="tool-btn" @click="adjustFontSize(-2)" title="缩小字号">A-</div>
      <div class="tool-btn" @click="adjustFontSize(2)" title="放大字号">A+</div>
      <div class="tool-btn" @click="toggleLock" title="锁定（鼠标穿透，快捷键 Ctrl+Alt+L）">
        <svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z"/></svg>
      </div>
      <div class="tool-btn" @click="openSettings" title="设置">
        <svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"/></svg>
      </div>
      <div class="tool-btn close-btn" @click="closeLyric" title="关闭">✕</div>
    </div>
    <!-- 锁定状态下的轻量解锁触发锚点 -->
    <div
      v-if="isLocked"
      class="locked-unlock-anchor"
      @mouseenter="onUnlockEnter"
      @mouseleave="onUnlockLeave"
      @click="toggleLock"
      title="点击解锁桌面歌词 (Ctrl+Alt+L)"
    >
      <div class="unlock-icon" :class="{ visible: showUnlockBtn }">
        <svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M12 17c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm6-9h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6h1.9c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm0 12H6V10h12v10z"/></svg>
      </div>
    </div>

    <!-- 歌词主文本区 -->
    <div class="lyric-body">
      <div class="lyric-line-main">
        <div class="lyric-text-wrapper">
          <!-- 底层：未播放文字基底（纯净底色，无任何渐变覆盖） -->
          <span class="lyric-text lyric-text--unplayed">{{ currentLrc }}</span>
          <!-- 顶层：已播放高亮文字（由时间戳进度硬件剪裁精准推进，零渐变污染） -->
          <span
            class="lyric-text lyric-text--played"
            :class="{ 'is-gradient': config.gradientEnabled }"
            :style="{ clipPath: `inset(0 ${(100 - playedPercent).toFixed(2)}% 0 0)` }"
          >{{ currentLrc }}</span>
        </div>
      </div>
      <div class="lyric-line-sub" v-if="config.showTranslation && transLrc">
        <span class="lyric-trans">{{ transLrc }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped lang="scss">
.desktop-lyric-container {
  width: 100vw;
  height: 100vh;
  box-sizing: border-box;
  padding: 8px 16px;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  user-select: none;
  background: transparent;
  transition: background 0.25s ease;
  position: relative;
  overflow: hidden;

  &.hovering {
    background: rgba(0, 0, 0, 0.35);
    border-radius: 8px;
    backdrop-filter: blur(10px);
  }

  .hover-toolbar {
    position: absolute;
    top: 6px;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 10px;
    background: rgba(26, 26, 26, 0.85);
    border-radius: 6px;
    color: #ffffff;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
    z-index: 10;
    -webkit-app-region: no-drag;

    .drag-handle {
      cursor: grab;
      -webkit-app-region: drag;
      padding: 2px 4px;
      display: flex;
      align-items: center;
    }

    .tool-btn {
      cursor: pointer;
      padding: 2px 6px;
      font-size: 13px;
      font-weight: bold;
      border-radius: 4px;
      display: flex;
      align-items: center;
      transition: 0.2s;

      &:hover {
        background: rgba(255, 255, 255, 0.2);
        color: #EC4141;
      }

      &.close-btn:hover {
        background: #e53935;
        color: #fff;
      }
    }
  }

  .locked-unlock-anchor {
    position: absolute;
    top: 6px;
    right: 12px;
    width: 28px;
    height: 28px;
    z-index: 20;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;

    .unlock-icon {
      opacity: 0;
      transition: opacity 0.2s ease, transform 0.2s ease;
      background: rgba(0, 0, 0, 0.7);
      color: #ffffff;
      padding: 4px;
      border-radius: 4px;
      display: flex;
      align-items: center;
      justify-content: center;

      &.visible {
        opacity: 1;
        transform: scale(1.05);
      }
      &:hover {
        background: #EC4141;
      }
    }
  }

  .lyric-body {
    width: 100%;
    text-align: center;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    pointer-events: none;

    .lyric-line-main {
      width: 100%;
      display: flex;
      justify-content: center;
      align-items: center;
      text-align: center;

      .lyric-text-wrapper {
        position: relative;
        display: inline-block;
        max-width: 95vw;
        line-height: 1.35;
      }

      .lyric-text {
        font-family: var(--font-western, 'Gilroy-ExtraBold'), var(--font-japanese, 'Yu Gothic'), var(--font-chinese, 'SourceHanSansCN-Bold'), sans-serif;
        font-size: var(--font-size, 28px);
        font-weight: bold;
        paint-order: stroke fill;
        -webkit-text-stroke: var(--stroke-width, 0.6px) var(--stroke-color, rgba(0, 0, 0, 0.6));
        text-shadow: var(--text-shadow, 0 2px 6px rgba(0, 0, 0, 0.5));
        letter-spacing: 0.8px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        max-width: 95vw;
        display: block;

        &.lyric-text--unplayed {
          color: var(--unplayed-color, #ffffff);
          user-select: none;
        }

        &.lyric-text--played {
          position: absolute;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
          color: var(--played-color, #31C27C);
          pointer-events: none;
          user-select: none;
          will-change: clip-path;

          &.is-gradient {
            background: var(--text-gradient);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
          }
        }
      }
    }

    .lyric-line-sub {
      margin-top: 6px;
      width: 100%;
      display: flex;
      justify-content: center;
      align-items: center;
      text-align: center;

      .lyric-trans {
        display: inline-block;
        font-family: var(--font-western, 'Gilroy-ExtraBold'), var(--font-japanese, 'Yu Gothic'), var(--font-chinese, 'SourceHanSansCN-Bold'), sans-serif;
        font-size: var(--tfont-size, 16px);
        font-weight: 500;
        color: var(--unplayed-color, #ffffff);
        opacity: calc(var(--text-opacity, 0.95) * 0.88);
        letter-spacing: 1.2px;
        paint-order: stroke fill;
        -webkit-text-stroke: calc(var(--stroke-width, 0.6px) * 0.35) var(--stroke-color, rgba(0, 0, 0, 0.5));
        text-shadow: 0 1px 3px rgba(0, 0, 0, 0.6);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        max-width: 95vw;
      }
    }
  }
}
</style>
