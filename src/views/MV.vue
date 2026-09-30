<script setup>
import { ref, nextTick, onMounted, onBeforeUnmount } from 'vue'
import { useRouter } from 'vue-router'
import { useOtherStore } from '../store/otherStore'
import { usePlayerStore } from '../store/playerStore'
import { isMvHandoff } from '../utils/mvHandoff.mjs'
import { consumeMvHandoff } from '../utils/mvHandoffSession.mjs'
import { preparePlayerForMv } from '../utils/mvNavigation.mjs'
import { unloadMusicVideo } from '../utils/player'

const router = useRouter()
const playerStore = usePlayerStore()
const editorFrame = ref(null)
const otherStore = useOtherStore()
const editorReady = ref(false)
const editorError = ref(false)
const editorActive = ref(false)
let pendingHandoff = null
const editorSrc = `${import.meta.env.BASE_URL}mv/jizura/index.html`
let readyTimer = null
function consumePendingHandoff() {
  takeHandoff(consumeMvHandoff())
}
let handoffSequence = 0
let needsBlankProject = true

function takeHandoff(value) {
  if (!isMvHandoff(value)) return
  handoffSequence += 1
  pendingHandoff = { ...value, handoffId: handoffSequence }
  needsBlankProject = false
  sendInitialState()
}

function confirmHandoff(handoffId) {
  if (!pendingHandoff || pendingHandoff.handoffId !== handoffId) return
  pendingHandoff = null
}

function hostMessage(type, handoff) {
  return { source: 'hydrogen-mv', version: 1, type, ...(handoff ? { handoff } : {}) }
}

function postToEditor(message) {
  const target = editorFrame.value?.contentWindow
  if (!target) return false
  const origin = new URL(editorSrc, window.location.href).origin
  target.postMessage(message, origin === 'null' ? '*' : origin)
  return true
}

function sendInitialState() {
  if (!editorReady.value || !editorActive.value) return
  if (pendingHandoff) {
    postToEditor(hostMessage('seed', pendingHandoff))
  } else if (needsBlankProject) {
    postToEditor(hostMessage('new-project'))
    needsBlankProject = false
  }
}

function setEditorVisible(visible) {
  postToEditor({ ...hostMessage('visibility'), visible })
}

function onEditorLoad() {
  editorReady.value = false
  editorError.value = false
  clearTimeout(readyTimer)
  readyTimer = setTimeout(() => {
    if (!editorReady.value) editorError.value = true
  }, 12000)
  nextTick(() => {
    postToEditor(hostMessage('hello'))
    setEditorVisible(editorActive.value)
    sendInitialState()
  })
}

function onEditorError() {
  clearTimeout(readyTimer)
  editorError.value = true
}

function onEditorMessage(event) {
  if (event.source !== editorFrame.value?.contentWindow) return
  const origin = new URL(editorSrc, window.location.href).origin
  if (origin !== 'null' && event.origin !== origin) return
  const message = event.data
  if (!message || message.source !== 'jizura-mv' || message.version !== 1) return
  if (message.type === 'ready') {
    editorReady.value = true
    editorError.value = false
    clearTimeout(readyTimer)
    setEditorVisible(editorActive.value)
    sendInitialState()
  }
  else if (message.type === 'seed-applied') confirmHandoff(message.handoffId)
}

function activateEditor() {
  preparePlayerForMv(playerStore, otherStore, unloadMusicVideo)
  editorActive.value = true
  postToEditor(hostMessage('hello'))
  setEditorVisible(true)
  sendInitialState()
}

function deactivateEditor() {
  editorActive.value = false
  setEditorVisible(false)
  clearTimeout(readyTimer)
}


function returnHome() {
  router.push('/')
}

onMounted(() => {
  window.addEventListener('message', onEditorMessage)
  consumePendingHandoff()
  activateEditor()
})
onBeforeUnmount(() => {
  window.removeEventListener('message', onEditorMessage)
  clearTimeout(readyTimer)
})
</script>

<template>
  <div class="mv-page">
  <main class="mv-workspace">
    <header class="mv-header">
      <button type="button" class="mv-back" aria-label="返回 Hydrogen 首页" @click="returnHome">
        <span aria-hidden="true">‹</span><span>Hydrogen</span>
      </button>
      <div class="mv-heading">
        <span class="mv-eyebrow">CREATIVE WORKSPACE / 01</span>
        <h1>MV 制作</h1>
      </div>
      <span class="mv-header-caption">歌词动态视频</span>
    </header>
    <section class="mv-editor" aria-label="MV 编辑器">
      <iframe ref="editorFrame" class="mv-editor-frame" :src="editorSrc" title="Hydrogen MV 制作编辑器" allow="autoplay" @load="onEditorLoad" @error="onEditorError"></iframe>
      <div v-if="!editorReady && !editorError" class="mv-editor-status" role="status" aria-live="polite">
        <span class="mv-status-mark"></span><span>正在载入 MV 工作区…</span>
      </div>
      <div v-if="editorError" class="mv-editor-error" role="alert">
        <strong>MV 工作区暂时无法载入</strong>
        <span>本地制作器没有回应。检查资源文件后重试，或先返回 Hydrogen。</span>
        <div class="mv-error-actions">
          <button type="button" @click="editorFrame?.contentWindow?.location?.reload()">重新载入</button>
          <button type="button" class="mv-error-back" @click="returnHome">返回</button>
        </div>
      </div>
    </section>
  </main>
</div>
</template>

<style scoped lang="scss">
.mv-page {
  position: fixed;
  inset: 88Px 3.3vw 110Px;
  z-index: 20;
  background: transparent;
}
.mv-workspace {
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border: 1Px solid rgba(42, 63, 67, 0.22);
  background: linear-gradient(155deg, rgba(224, 239, 243, 0.95), rgba(245, 249, 249, 0.98) 48%, rgba(222, 238, 241, 0.92));
  color: #22292b;
}
.mv-header {
  min-height: 86Px;
  padding: 16Px 28Px 13Px;
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  border-bottom: 1Px solid rgba(42, 63, 67, 0.14);
  background: rgba(255, 255, 255, 0.32);
}
.mv-back {
  justify-self: start;
  display: inline-flex;
  align-items: center;
  gap: 7Px;
  padding: 6Px 0;
  border: 0;
  background: transparent;
  color: #444c4f;
  font: 14Px SourceHanSansCN-Bold, sans-serif;
  cursor: pointer;
  transition: color 0.18s, transform 0.18s;
  span:first-child { font: 26Px/0.8 sans-serif; }
  &:hover { color: #168e75; transform: translateX(-2Px); }
  &:focus-visible { outline: 2Px solid #31a88b; outline-offset: 3Px; }
}
.mv-heading { text-align: center; }
.mv-eyebrow { color: #74888b; font: 9Px Bender-Bold, monospace; letter-spacing: 0.16em; }
.mv-heading h1 { margin: 2Px 0 0; color: #20282a; font: 22Px SourceHanSansCN-Bold, sans-serif; letter-spacing: 0.03em; }
.mv-header-caption { justify-self: end; color: #778387; font: 12Px SourceHanSansCN-Bold, sans-serif; }
.mv-editor { position: relative; flex: 1 1 auto; min-height: 0; margin: 12Px 16Px 16Px; overflow: hidden; border: 1Px solid rgba(37, 56, 60, 0.14); background: rgba(255, 255, 255, 0.56); box-shadow: 0 9Px 28Px rgba(83, 116, 122, 0.12), inset 0 1Px rgba(255, 255, 255, 0.8); }
.mv-editor-frame { display: block; width: 100%; height: 100%; border: 0; background: transparent; }
.mv-editor-status { position: absolute; left: 50%; top: 50%; display: flex; align-items: center; gap: 9Px; transform: translate(-50%, -50%); color: #687679; font: 13Px SourceHanSansCN-Bold, sans-serif; pointer-events: none; }
.mv-status-mark { width: 8Px; height: 8Px; border-radius: 50%; background: #31a88b; animation: mv-pulse 1.2s ease-in-out infinite alternate; }
.mv-editor-error { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 9Px; padding: 24Px; color: #354245; text-align: center; background: rgba(241, 247, 248, 0.96); }
.mv-editor-error strong { font: 20Px SourceHanSansCN-Bold, sans-serif; }
.mv-editor-error > span { color: #687679; font: 13Px SourceHanSansCN-Bold, sans-serif; }
.mv-error-actions { display: flex; gap: 10Px; margin-top: 8Px; }
.mv-error-actions button { padding: 7Px 14Px; border: 1Px solid rgba(31, 98, 87, 0.48); border-radius: 2Px; background: rgba(255, 255, 255, 0.5); color: #276e61; cursor: pointer; &:hover { background: rgba(49, 168, 139, 0.1); } }
.mv-error-actions .mv-error-back { border-color: transparent; color: #687679; }
@keyframes mv-pulse { to { opacity: 0.4; transform: scale(0.76); } }
@media (max-width: 1180px) { .mv-page { inset: 112Px 3.3vw 110Px; } }
@media (max-width: 960px) { .mv-page { inset-block-start: 128Px; } }
@media (max-width: 760px) { .mv-page { inset: 112Px 12Px 104Px; } .mv-header { min-height: 68Px; padding: 10Px 16Px; } .mv-header-caption { display: none; } .mv-heading h1 { font-size: 19Px; } .mv-editor { margin: 7Px 8Px 10Px; } }
@media (max-height: 700px) { .mv-page { bottom: 92Px; } }
</style>
