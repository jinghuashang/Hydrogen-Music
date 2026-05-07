<script setup>
  import { onMounted, watch, onBeforeUnmount } from 'vue'
  import Plyr from 'plyr'
  import '../assets/css/plyr.css'
  import { musicVideoCheck } from '../utils/player';
  import { usePlayerStore } from '../store/playerStore';
  import { buildBiliCdnPlaybackUrl } from '../utils/biliStreamPlayback'

  const playerStore = usePlayerStore()

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
    <div class="back-video">
        <video id="video-player" class="video-player"></video>
    </div>
</template>

<style scoped lang="scss">
  
</style>
