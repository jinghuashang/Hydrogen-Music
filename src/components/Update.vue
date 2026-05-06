<script setup>
  import { ref, onMounted, onUnmounted } from 'vue'
  import { useOtherStore } from '../store/otherStore';

  const otherStore = useOtherStore()
  const isActive = ref(false)
  const isDownloading = ref(false)
  const downloadProgress = ref(0)

  onMounted(() => {
    setTimeout(() => {
      isActive.value = true
    }, 150)
  })
  const close = () => {
    isActive.value = false
    setTimeout(() => {
      otherStore.toUpdate = false
      otherStore.updateDownloadUrl = null
      otherStore.updateIsWindows = false
    }, 400)
  }
  const toUpdate = () => {
    if (otherStore.updateIsWindows && otherStore.updateDownloadUrl) {
      isDownloading.value = true
      downloadProgress.value = 0
      windowApi.downloadUpdate(otherStore.updateDownloadUrl).then(result => {
        isDownloading.value = false
        downloadProgress.value = 0
        if (result === 'success') {
          close()
        }
      })
    } else {
      windowApi.toRegister("https://github.com/jinghuashang/Hydrogen-Music/releases")
      close()
    }
  }

  windowApi.downloadUpdateProgress((event, value) => {
    downloadProgress.value = value
  })
</script>

<template>
  <div class="update-mask"></div>
  <div class="update-container" :class="{'update-container-active': isActive}">
    <div class="update-dialog">
      <div class="update-header">
        <div class="update-icon">
          <svg viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" width="32" height="32">
            <path d="M512 64C264.6 64 64 264.6 64 512s200.6 448 448 448 448-200.6 448-448S759.4 64 512 64z m0 820c-205.4 0-372-166.6-372-372s166.6-372 372-372 372 166.6 372 372-166.6 372-372 372z" fill="rgba(255,255,255,0.6)"/>
            <path d="M512 304c-13.2 0-24 10.8-24 24v352c0 13.2 10.8 24 24 24s24-10.8 24-24V328c0-13.2-10.8-24-24-24z" fill="rgba(255,255,255,0.6)"/>
            <path d="M512 720c-13.2 0-24 10.8-24 24v48c0 13.2 10.8 24 24 24s24-10.8 24-24v-48c0-13.2-10.8-24-24-24z" fill="rgba(255,255,255,0.6)"/>
          </svg>
        </div>
        <span class="update-title">发现新版本</span>
      </div>
      <div class="update-body">
        <div class="version-info">
          <span class="version-label">最新版本</span>
          <span class="version-number">V{{ otherStore.newVersion }}</span>
        </div>
        <div class="download-section" v-if="isDownloading">
          <div class="progress-bar">
            <div class="progress-fill" :style="{width: downloadProgress + '%'}"></div>
          </div>
          <span class="progress-text">下载中 {{ downloadProgress }}%</span>
        </div>
      </div>
      <div class="update-actions">
        <div class="btn btn-ignore" @click="close()">忽略</div>
        <div class="btn btn-update" :class="{'btn-downloading': isDownloading}" @click="!isDownloading && toUpdate()">
          {{ isDownloading ? '下载中...' : '更新' }}
        </div>
      </div>
    </div>
    <span class="corner corner-tl"></span>
    <span class="corner corner-tr"></span>
    <span class="corner corner-bl"></span>
    <span class="corner corner-br"></span>
  </div>
</template>

<style scoped lang="scss">
  .update-mask {
    width: 100%;
    height: 100%;
    position: fixed;
    top: 0;
    left: 0;
    background-color: rgba(0, 0, 0, 0.15);
    z-index: 999;
  }
  .update-container {
    z-index: 1000;
    width: 0;
    height: 0;
    background-image: url('../assets/img/halftone.png');
    background-size: 40%;
    background-repeat: repeat;
    background-color: rgb(14, 14, 14);
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    overflow: hidden;

    &-active {
      width: 380px;
      height: 200px;
      padding: 20px 24px;
    }
    .update-dialog {
      width: 100%;
      height: 100%;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      overflow: hidden;
      .update-header {
        display: flex;
        flex-direction: row;
        align-items: center;
        .update-icon {
          margin-right: 8px;
          width: 24px;
          height: 24px;
          display: flex;
          align-items: center;
          justify-content: center;
          svg {
            width: 100%;
            height: 100%;
          }
        }
        .update-title {
          font: 16px SourceHanSansCN-Bold;
          color: rgba(255, 255, 255, 0.95);
        }
      }
      .update-body {
        .version-info {
          display: flex;
          flex-direction: row;
          align-items: center;
          .version-label {
            font: 13px SourceHanSansCN-Bold;
            color: rgba(255, 255, 255, 0.6);
            margin-right: 10px;
          }
          .version-number {
            font: 18px Bender-Bold;
            color: rgba(255, 255, 255, 0.95);
          }
        }
        .download-section {
          margin-top: 10px;
          .progress-bar {
            width: 100%;
            height: 4px;
            background-color: rgba(255, 255, 255, 0.15);
            overflow: hidden;
            .progress-fill {
              height: 100%;
              background-color: rgba(255, 255, 255, 0.8);
              transition: width 0.2s;
            }
          }
          .progress-text {
            display: block;
            margin-top: 4px;
            font: 11px SourceHanSansCN-Bold;
            color: rgba(255, 255, 255, 0.6);
            text-align: right;
          }
        }
      }
      .update-actions {
        display: flex;
        flex-direction: row;
        align-items: center;
        justify-content: flex-end;
        .btn {
          padding: 8px 20px;
          font: 14px SourceHanSansCN-Bold;
          color: rgba(255, 255, 255, 0.9);
          border: 0.5px solid rgba(255, 255, 255, 0.6);
          transition: 0.2s;
          &:hover {
            cursor: pointer;
            background-color: rgba(255, 255, 255, 0.9);
            color: black;
          }
        }
        .btn-ignore {
          margin-right: 16px;
        }
        .btn-downloading {
          opacity: 0.6;
          &:hover {
            cursor: not-allowed;
            background-color: transparent;
            color: rgba(255, 255, 255, 0.9);
          }
        }
      }
    }
    .corner {
      width: 9px;
      height: 9px;
      background-color: rgb(247, 247, 247);
      position: absolute;
      opacity: 0;
      animation: corner-blink 0.4s forwards;
    }
    .corner-tl { top: -4px; left: -4px; }
    .corner-tr { top: -4px; right: -4px; }
    .corner-bl { bottom: -4px; left: -4px; }
    .corner-br { bottom: -4px; right: -4px; }
  }

  @keyframes corner-blink {
    0%  { opacity: 0; }
    10% { opacity: 1; }
    20% { opacity: 0; }
    30% { opacity: 1; }
    40% { opacity: 0; }
    50% { opacity: 1; }
    60% { opacity: 0; }
    70% { opacity: 1; }
    80% { opacity: 0; }
    90% { opacity: 0; }
    100%{ opacity: 1; }
  }
</style>

<style lang="scss">
  .update-container {
    animation: update-dialog-in 0.4s 0.15s forwards;
  }
  @keyframes update-dialog-in {
    0%  { width: 0; height: 0; padding: 0; }
    50% { width: 380px; height: 0; padding: 0; }
    100%{ width: 380px; height: 200px; padding: 20px 24px; }
  }
</style>
