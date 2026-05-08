<script setup>
  import { onMounted, watch, onBeforeUnmount } from 'vue'
  import Plyr from 'plyr'
  import '../assets/css/plyr.css'
  import { musicVideoCheck } from '../utils/player';
  import { usePlayerStore } from '../store/playerStore';
  import { buildBiliCdnPlaybackUrl } from '../utils/biliStreamPlayback'
  import { isHydrogenWeb } from '../utils/webProfileNas'

  const playerStore = usePlayerStore()
  const isWebClient = isHydrogenWeb()

  function resolveVideoSrc() {
    const v = playerStore.currentMusicVideo
    if (!v) return ''
    if (v.streamBaseUrl) return buildBiliCdnPlaybackUrl(v.streamBaseUrl)
    return v.path || ''
  }

  function applyPlyrSource() {
    if (!playerStore.musicVideoDOM || !playerStore.currentMusicVideo) return
    const src = resolveVideoSrc()
    if (!src) return
    playerStore.musicVideoDOM.source = {
      type: 'video',
      sources: [{ src, type: 'video/mp4' }],
    }
  }

  onMounted(() => {
    const config = {
      autoplay: false,
      controls: []
    };
    playerStore.musicVideoDOM = new Plyr('#video-player', config)
    applyPlyrSource()
    playerStore.musicVideoDOM.on('play', () => {
      musicVideoCheck(playerStore.currentMusic.seek(), true)
    })
  })

  watch(
    () => playerStore.currentMusicVideo,
    () => {
      applyPlyrSource()
    },
    { deep: true },
  )

  onBeforeUnmount(() => {
    try {
      playerStore.musicVideoDOM?.destroy()
    } catch (_) {}
    playerStore.musicVideoDOM = null
  })
</script>

<template>
    <div class="back-video" :class="{ 'back-video--web-cover': isWebClient }">
        <video id="video-player" class="video-player"></video>
    </div>
</template>

<style scoped lang="scss">
/**
 * Web：视口宽高比随浏览器变化，contain 易出现上下/左右黑边。
 * 适度放大视频区域（约 6%）并以 cover 铺满，黑边换为少量裁切。
 */
.back-video--web-cover {
  :deep(.plyr) {
    position: relative;
    width: 100%;
    height: 100%;
    min-height: 0;
    overflow: hidden;
  }
  :deep(.plyr__video-wrapper) {
    position: absolute;
    left: 50%;
    top: 50%;
    transform: translate(-50%, -50%);
    width: 106%;
    height: 106%;
    max-width: none;
    max-height: none;
  }
  :deep(video) {
    width: 100% !important;
    height: 100% !important;
    object-fit: cover;
    object-position: center center;
  }
}
</style>
