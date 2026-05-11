<script setup>
  import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
  import Home from './views/Home.vue'
  import Title from './components/Title.vue'
  import SearchInput from './components/SearchInput.vue'
  import WindowControl from './components/WindowControl.vue'
  import MusicWidget from './components/MusicWidget.vue'
  import MusicPlayer from './views/MusicPlayer.vue'
  import VideoPlayer from './components/VideoPlayer.vue'
  import ContextMenu from './components/ContextMenu.vue'
  import GlobalDialog from './components/GlobalDialog.vue'
  import GlobalNotice from './components/GlobalNotice.vue'
  import Update from './components/Update.vue'

  import { usePlayerStore } from './store/playerStore'
  import { useOtherStore } from './store/otherStore'

  const playerStore = usePlayerStore()
  const otherStore = useOtherStore()

  const isWebClient =
    import.meta.env.VITE_WEB === 'true' || import.meta.env.VITE_WEB === '1'

  const hasCurrentSong = computed(
    () => !!(playerStore.songList && playerStore.songList[playerStore.currentIndex]),
  )

  /** Web：宽屏或系统全屏时，主页在左约 74%，播放器列在右约 26% */
  const webHomeSplit = ref(false)

  function isBrowserFullscreen() {
    if (typeof document === 'undefined') return false
    const d = document
    return !!(
      d.fullscreenElement ||
      d.webkitFullscreenElement ||
      d.mozFullScreenElement ||
      d.msFullscreenElement
    )
  }

  function refreshWebHomeSplit() {
    if (!isWebClient) {
      webHomeSplit.value = false
      return
    }
    const w = typeof window !== 'undefined' ? window.innerWidth : 0
    const wide = w >= 1180
    const fullscreen = isBrowserFullscreen()
    webHomeSplit.value =
      wide &&
      (fullscreen || w >= 1360) &&
      !!playerStore.widgetState &&
      hasCurrentSong.value
  }

  watch(
    [() => playerStore.widgetState, hasCurrentSong],
    () => {
      refreshWebHomeSplit()
    },
    { flush: 'post' },
  )

  watch(
    webHomeSplit,
    (split) => {
      const embed = !!(isWebClient && split)
      playerStore.webHomeSplitEmbed = embed
      if (embed) {
        playerStore.videoIsPlaying = false
        playerStore.playerShow = true
      }
    },
    { immediate: true },
  )

  onMounted(() => {
    refreshWebHomeSplit()
    if (!isWebClient) return
    window.addEventListener('resize', refreshWebHomeSplit)
    document.addEventListener('fullscreenchange', refreshWebHomeSplit)
    document.addEventListener('webkitfullscreenchange', refreshWebHomeSplit)
  })

  onUnmounted(() => {
    if (!isWebClient) return
    window.removeEventListener('resize', refreshWebHomeSplit)
    document.removeEventListener('fullscreenchange', refreshWebHomeSplit)
    document.removeEventListener('webkitfullscreenchange', refreshWebHomeSplit)
  })

  /** Web：从右侧嵌入栏进全屏用横向过渡，从底栏迷你条进全屏沿用原有纵向过渡 */
  const fullPlayerTransitionName = computed(() => {
    if (!isWebClient) return 'player'
    return playerStore.fullPlayerOpenSource === 'webRightEmbed'
      ? 'player-web-embed'
      : 'player'
  })

  function onFullPlayerAfterLeave() {
    playerStore.fullPlayerOpenSource = null
  }

  windowApi.checkUpdate((event, version) => {
    otherStore.toUpdate = true
    otherStore.newVersion = version.version
    otherStore.updateDownloadUrl = version.downloadUrl
    otherStore.updateIsWindows = version.isWindows
    otherStore.releaseBody = version.releaseBody || ''
    // 自动开始下载更新
    if (version.isWindows && version.downloadUrl) {
      otherStore.autoUpdateStatus = 'downloading'
      otherStore.autoUpdateProgress = 0
      windowApi.autoDownloadUpdate(version.downloadUrl)
    }
  })

  windowApi.onAutoUpdateStatus((event, data) => {
    if (data.status === 'downloading') {
      otherStore.autoUpdateProgress = data.progress
      otherStore.autoUpdateTotalSize = data.totalSize || ''
      otherStore.autoUpdateDownloadedSize = data.downloadedSize || ''
    } else if (data.status === 'installing') {
      otherStore.autoUpdateStatus = 'installing'
    } else if (data.status === 'failed') {
      otherStore.autoUpdateStatus = 'failed'
      otherStore.autoUpdateError = data.error
    }
  })
</script>

<template>
  <div class="mainWindow" :class="{ 'mainWindow--web-split': webHomeSplit }">
    <div class="mainWindow__content" :class="{ 'web-split-pane-home': webHomeSplit }">
      <Transition name="home">
        <Home class="home" v-show="playerStore.widgetState"></Home>
      </Transition>
    </div>
    <div v-if="webHomeSplit" class="web-split-pane-player">
      <Transition name="web-split-player">
        <div
          v-if="hasCurrentSong"
          class="musicPlayer musicPlayer--web-split-pane"
          key="web-home-embed-player"
        >
          <MusicPlayer embed-mode="webHomeLeft" />
        </div>
      </Transition>
    </div>
  </div>
  <div class="globalWidget">
    <Title class="widget-title"></Title>
    <SearchInput class="widget-search"></SearchInput>
  </div>
  <div class="dragBar">
    <WindowControl v-if="!isWebClient" class="window-control"></WindowControl>
  </div>
  <Transition name="widget">
    <div
      class="musicWidget"
      v-if="playerStore.songList && playerStore.songList[playerStore.currentIndex]"
      v-show="playerStore.widgetState && !webHomeSplit"
    >
      <MusicWidget></MusicWidget>
    </div>
  </Transition>
  <Transition
    :name="fullPlayerTransitionName"
    @after-leave="onFullPlayerAfterLeave"
  >
    <div
      class="musicPlayer"
      v-if="hasCurrentSong"
      v-show="!playerStore.widgetState"
    >
      <MusicPlayer embed-mode="full" />
    </div>
  </Transition>
  <Transition name="video">
    <div class="videoPlayer" v-if="otherStore.videoPlayerShow">
      <VideoPlayer></VideoPlayer>
    </div>
  </Transition>
  <div class="contextMune">
    <ContextMenu></ContextMenu>
  </div>
  <div class="globalDialog">
    <GlobalDialog></GlobalDialog>
  </div>
  <div class="globalNotice">
    <GlobalNotice></GlobalNotice>
  </div>
  <Transition name="fade">
    <div class="update" v-if="otherStore.toUpdate">
      <Update></Update>
    </div>
  </Transition>
</template>

<style lang="scss">
  #app{
    user-select: none;
    margin: 0;
    padding: 0;
    max-width: 100%;
    position: fixed;
    left: 0;
    right: 0;
    top: 0;
    bottom: 0;
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
  }
  .mainWindow{
    width: 100%;
    height: 100%;
    background: linear-gradient(rgba(176, 209, 217, 0.9) -20%,rgba(176, 209, 217, 0.4) 50%,rgba(176, 209, 217, 0.9) 120%);
    opacity: 0;
    animation: mainWindows-starting 0.8s cubic-bezier(.14,.91,.58,1) forwards;
    @keyframes mainWindows-starting {
      0%{background-color: rgba(222, 235, 239, 1);opacity: 0;transform: scale(1.3);}
      100%{background-color: rgb(255, 255, 255);opacity: 1;transform: scale(1);}
    }
    .home{
      height: calc(100% - 78Px);
    }
    &--web-split {
      display: flex;
      flex-direction: row;
      align-items: stretch;
      box-sizing: border-box;
      /** 底部迷你条已隐藏，勿再预留 78px，否则左侧会出现空背景条 */
      .home {
        height: 100%;
      }
    }
  }
  .web-split-pane-player {
    flex: 0 0 26%;
    width: 26%;
    max-width: 26%;
    min-width: 0;
    height: 100%;
    position: relative;
    overflow: visible;
    z-index: 2;
    box-sizing: border-box;
  }

  .web-split-player-enter-active {
    transition: 0.55s cubic-bezier(0.4, 0, 0.12, 1);
  }
  .web-split-player-leave-active {
    transition: 0.35s cubic-bezier(0.4, 0, 1, 1);
  }
  .web-split-player-enter-from {
    opacity: 0;
    transform: translateX(16px) scale(0.96);
  }
  .web-split-player-enter-to {
    opacity: 1;
    transform: translateX(0) scale(1);
  }
  .web-split-player-leave-from {
    opacity: 1;
    transform: translateX(0) scale(1);
  }
  .web-split-player-leave-to {
    opacity: 0;
    transform: translateX(12px) scale(0.98);
  }
  .mainWindow__content {
    flex: 1 1 auto;
    width: 100%;
    height: 100%;
    min-width: 0;
    box-sizing: border-box;
    /** 首页模块用 cqw 时以此为参照，避免 vw 跟全屏视口走导致分栏/超宽变形 */
    container-type: inline-size;
    container-name: home-pane;
    &.web-split-pane-home {
      flex: 0 0 74%;
      width: 74%;
      max-width: 74%;
      position: relative;
      z-index: 1;
    }
  }
  .globalWidget{
    display: flex;
    flex-direction: row;
    align-items: center;
    position: absolute;
    top: 22Px;
    left: 45Px;
    z-index: 999;
    .widget-title{
      &:hover{
        cursor: pointer;
      }
    }
    .widget-search{
      margin-left: 30Px;
    }
  }
  .dragBar{
    width: 100%;
    height: 35Px;
    background: transparent;
    position: fixed;
    top: 0;
    z-index: 999;
    -webkit-app-region: drag;
    .window-control{
      position: fixed;
      top: 13Px;
      right: 15Px;
      -webkit-app-region: no-drag;
      z-index: 999;
    }
  }
  .musicWidget{
    width: 680Px;
    height: 65Px;
    position: fixed;
    left: 50%;
    bottom: 35Px;
    transform: translateX(-50%);
    box-shadow: 0 0 15Px 2Px rgba(189, 189, 189, 0.1);
  }
  .musicPlayer{
    width: 100%;
    height: 100%;
    position: absolute;
    top: 0;
    left: 0;
    &.musicPlayer--web-split-pane {
      position: relative;
      overflow: visible;
    }
  }
  .videoPlayer{
    width: 100%;
    height: 100%;
    position: fixed;
    pointer-events: none;
    z-index: 999;
  }
  .globalNotice{
    bottom: 120Px;
    position: fixed;
    z-index: 999;
  }
  .update{
    width: 100%;
    height: 100%;
    background-color: rgba(0, 0, 0, 0.1);
    position: fixed;
    z-index: 999;
  }

  .home-enter-active,
  .home-leave-active {
    transition: 0.4s cubic-bezier(.14,.91,.58,1);
  }

  .home-enter-from,
  .home-leave-to {
    transform: scale(0.9);
    opacity: 0;
  }

  .widget-enter-active,
  .widget-leave-active {
    transition: 0.5s cubic-bezier(.14,.91,.58,1);
  }

  .widget-enter-from,
  .widget-leave-to {
    bottom: -70Px;
  }

  .player-enter-active,
  .player-leave-active {
    transition: 0.5s cubic-bezier(.14,.91,.58,1);
  }

  .player-enter-from,
  .player-leave-to {
    transform: translateY(100%);
  }

  .player-web-embed-enter-active,
  .player-web-embed-leave-active {
    transition: 0.5s cubic-bezier(.14, .91, .58, 1);
  }
  .player-web-embed-enter-from {
    transform: translateX(100%);
  }
  .player-web-embed-enter-to {
    transform: translateX(0);
  }
  .player-web-embed-leave-from {
    transform: translateX(0);
  }
  .player-web-embed-leave-to {
    transform: translateX(100%);
  }

  .video-enter-active,
  .video-leave-active {
    transition: 0.1s;
  }

  .video-enter-from,
  .video-leave-to {
    transform: scale(0.8);
    opacity: 0;
  }
  .fade-enter-active {
    transition: 0.4s;
  }
  .fade-leave-active {
    transition: 0.3s;
  }

  .fade-enter-from,
  .fade-leave-to {
    opacity: 0;
  }
</style>
