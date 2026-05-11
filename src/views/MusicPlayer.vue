<script setup>
  import { computed } from 'vue'
  import Player from '../components/Player.vue'
  import Lyric from '../components/Lyric.vue'
  import MusicVideo from '../components/MusicVideo.vue';
  import PlayerVideo from '../components/PlayerVideo.vue';
  import { usePlayerStore } from '../store/playerStore';

  const props = defineProps({
    /** full：全屏播放页；webHomeLeft：Web 主页分栏时右侧嵌入的播放器列 */
    embedMode: {
      type: String,
      default: 'full',
      validator: (v) => v === 'full' || v === 'webHomeLeft',
    },
  })

  const playerStore = usePlayerStore()
  const isEmbedWebHomeLeft = computed(() => props.embedMode === 'webHomeLeft')
</script>

<template>
  <div class="music-player" :class="{ 'music-player--embed-left': isEmbedWebHomeLeft }">
    <Transition name="fade3">
      <div
        class="back-drop"
        :style="{'backgroundImage': 'url(' + playerStore.coverUrl + ')'}"
        v-if="!isEmbedWebHomeLeft && playerStore.coverBlur && !playerStore.videoIsPlaying"
      ></div>
    </Transition>
    <Player
      class="player-container"
      :web-home-left-embed="isEmbedWebHomeLeft"
      :class="{
        'player-hide': playerStore.videoIsPlaying && !playerStore.playerShow && !isEmbedWebHomeLeft,
        'player-blur': playerStore.videoIsPlaying && !isEmbedWebHomeLeft,
        'cover-blur': playerStore.coverBlur && !isEmbedWebHomeLeft,
      }"
    ></Player>
    <Lyric v-if="!isEmbedWebHomeLeft" class="lyric-container" :class="{'lyric-hide': playerStore.videoIsPlaying && !playerStore.playerShow}"></Lyric>
    <Transition name="fade">
      <MusicVideo class="music-video" v-if="playerStore.addMusicVideo"></MusicVideo>
    </Transition>
    <Transition name="fade2">
      <PlayerVideo
        class="back-video"
        v-show="playerStore.videoIsPlaying"
        v-if="!isEmbedWebHomeLeft && playerStore.currentMusicVideo && playerStore.musicVideo"
      ></PlayerVideo>
    </Transition>
  </div>
</template>

<style scoped lang="scss">
  @media screen and (max-aspect-ratio: 5/6) {
    .music-player:not(.music-player--embed-left) {
      .player-container{
        display: none;
      }
      .lyric-container{
        width: 100% !important;
      }
    }
  }
  .music-player{
    padding: 95Px 45Px 60Px 45Px;
    width: 100%;
    height: 100%;
    background: linear-gradient(rgba(176, 209, 217, 0.9) -20%,rgba(176, 209, 217, 0.4) 50%,rgba(176, 209, 217, 0.9) 120%);
    background-color: rgb(255, 255, 255);
    display: flex;
    flex-direction: row;
    align-items: center;
    justify-content: center;
    transition: 0.2s;
    position: relative;
    overflow: hidden;
    .back-drop{
      position: absolute;
      top: 0;
      left: 0;
      z-index: 0;
      width: 120%;
      height: 120%;
      background-position: center center;
      background-size: cover;
      background-repeat: no-repeat;
      filter: blur(50px);
      transform: translate(-10%, -10%); // 略放大避免模糊裁切白边，兼开 GPU
      transition: 0.3s;
    }
    .back-drop::before{
      content: "";
      display: block;
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(255, 255, 255, 0.3);
    }
    .player-container{
      padding: 16Px 12Px;
      padding-bottom: 4vh;
      width: 0;
      height: 0;
      background-color: rgba(255, 255, 255, 0.35);
      opacity: 0;
      animation: player-in 0.7s 0.2s cubic-bezier(0.4, 0, 0.12, 1) forwards;
      @keyframes player-in {
          0%{height: 0;opacity: 0;}
          35%{width: 42vh;height: 0}
          100%{width: 42vh;height: 100%;opacity: 1;}
      }
    }
    .player-hide{
      width: 42vh;
      height: 100%;
      animation: player-hide 0.4s cubic-bezier(.3,.79,.55,.99) forwards;
      @keyframes player-hide {
        0%{opacity: 1;}
        100%{transform: scale(0.85);opacity: 0;visibility: hidden;}
      }
    }
    .player-blur{
      background-color: rgba(255, 255, 255, 0.2);
      backdrop-filter: blur(4px);
      transform: translateZ(0);
    }
    .cover-blur{
      background-color: rgba(255, 255, 255, 0.2);
      transform: translateZ(0);
    }
    .lyric-container{
      margin-left: 50Px;
      width: calc(100% - 42vh - 50Px);
      height: 100%;
      transition: 0.6s cubic-bezier(.3,.79,.55,.99);
    }
    .lyric-hide{
      transform: scale(0.85);
      opacity: 0;
      visibility: hidden;
    }
    .music-video{
      position: absolute;
      inset: 0;
      z-index: 999;
      display: flex;
      align-items: center;
      justify-content: center;
      box-sizing: border-box;
    }
  }
  .back-video{
    width: 100%;
    height: 100%;
    background: black;
    position: fixed;
    top: 0;
    left: 0;
    z-index: 0;
    pointer-events: none;
    .video-player{
      width: 100%;
      height: 100%;
    }
  }

  .fade3-enter-active {
    transition: 0.6s !important
  }
  .fade3-leave-active {
    transition: 1.5s !important;
  }
  .fade3-enter-from {
    opacity: 1;
  }
  .fade3-leave-to {
    opacity: 0;
  }

  .fade-enter-active,
  .fade-leave-active {
    transition: 0.1s;
  }
  .fade-enter-from,
  .fade-leave-to {
    transform: scale(0.95);
    opacity: 0;
  }
  
  .fade2-enter-active {
    transition: 1s;
  }
  .fade2-leave-active {
    transition: 0.4s;
  }
  .fade2-enter-from,
  .fade2-leave-to {
    opacity: 0;
  }

  /** Web 主页分栏：背景透出外层 mainWindow，与右侧首页一致；无封面模糊底；允许右侧悬停工具栏与播放列表溢出显示 */
  .music-player.music-player--embed-left {
    width: 100%;
    height: 100%;
    box-sizing: border-box;
    padding: 95Px 10Px 60Px 10Px;
    overflow: visible !important;
    background: transparent !important;
    background-color: transparent !important;
    /** 分栏时音乐视频层勿用 fixed，否则会盖住整页（含左侧主页） */
    .back-video {
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      width: 100%;
      height: 100%;
      z-index: 0;
    }
    .player-container {
      position: relative;
      z-index: 1;
      width: 0;
      height: 0;
      opacity: 0;
      max-width: 100%;
      margin: 0 auto;
      animation: web-embed-player-in 0.72s 0.14s cubic-bezier(0.4, 0, 0.12, 1) forwards;
      @keyframes web-embed-player-in {
        0% {
          width: 0;
          height: 0;
          opacity: 0;
          transform: scale(0.94);
        }
        40% {
          width: min(42vh, 100%);
          height: 0;
          opacity: 1;
          transform: scale(1);
        }
        100% {
          width: min(42vh, 100%);
          height: 100%;
          opacity: 1;
          transform: scale(1);
        }
      }
    }
    .player-hide {
      animation: none !important;
    }
  }
</style>