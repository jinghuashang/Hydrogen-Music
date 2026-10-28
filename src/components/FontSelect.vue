<template>
  <div class="font-select" ref="select" @click="toggle">
    <span class="font-select-value" :class="{ 'is-placeholder': !modelValue }">{{ modelValue || placeholder }}</span>
    <teleport to="body">
      <Transition name="font-select">
        <div
          class="font-select-panel"
          ref="panel"
          v-if="open"
          :style="{ maxHeight: '320px' }"
          @click.stop
        >
          <input
            class="font-select-filter"
            ref="filterInput"
            v-model="keyword"
            placeholder="搜索字体"
            spellcheck="false"
            @keydown.esc="close"
            @keydown.enter="pickFirst"
          >
          <div class="font-select-list">
            <div class="font-select-item" :class="{ 'is-selected': !modelValue }" @click="pick('')">
              {{ placeholder }}
            </div>
            <div
              class="font-select-item"
              v-for="font in filteredFonts"
              :key="font"
              :class="{ 'is-selected': font === modelValue }"
              @click="pick(font)"
            >
              <span class="font-select-name">{{ font }}</span>
              <span class="font-select-sample" :style="{ fontFamily: font }">Aa 永</span>
            </div>
            <div class="font-select-empty" v-if="filteredFonts.length === 0">没有匹配的字体</div>
          </div>
        </div>
      </Transition>
    </teleport>
  </div>
</template>

<script setup>
import { computed, nextTick, onActivated, onDeactivated, ref } from 'vue'
import { absolutePosition } from '../utils/domHandler'

const props = defineProps({
  modelValue: { type: String, default: '' },
  fonts: { type: Array, default: () => [] },
  placeholder: { type: String, default: '内置（思源黑体）' },
})
const emit = defineEmits(['update:modelValue'])

const select = ref(null)
const panel = ref(null)
const filterInput = ref(null)
const open = ref(false)
const keyword = ref('')

const filteredFonts = computed(() => {
  const word = keyword.value.trim().toLowerCase()
  if (!word) return props.fonts
  return props.fonts.filter((font) => font.toLowerCase().includes(word))
})

function positionPanel() {
  nextTick(() => {
    if (panel.value && select.value) absolutePosition(panel.value, select.value)
    filterInput.value?.focus()
  })
}

function toggle() {
  open.value = !open.value
  if (open.value) positionPanel()
}

function close() {
  open.value = false
  keyword.value = ''
}

function pick(font) {
  emit('update:modelValue', font)
  close()
}

function pickFirst() {
  const first = filteredFonts.value[0]
  if (first) pick(first)
}

let clickOutside = (event) => {
  if (!open.value) return
  if (select.value?.contains(event.target)) return
  if (panel.value?.contains(event.target)) return
  close()
}
onActivated(() => window.addEventListener('click', clickOutside))
onDeactivated(() => window.removeEventListener('click', clickOutside))
</script>

<style scoped lang="scss">
.font-select {
  position: relative;
  width: 200px;
  height: 34px;
  background-color: rgba(255, 255, 255, 0.35);
  font: 13px SourceHanSansCN-Bold;
  color: black;
  cursor: pointer;
  transition: 0.2s;

  &:hover {
    opacity: 0.8;
    box-shadow: 0 0 0 1px black;
  }

  .font-select-value {
    display: block;
    padding: 0 10px;
    line-height: 34px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;

    &.is-placeholder {
      color: rgba(0, 0, 0, 0.45);
    }
  }
}

.font-select-panel {
  position: absolute;
  z-index: 10000;
  width: 240px;
  background: rgb(228, 240, 240);
  box-shadow: 0 8px 16px rgba(0, 0, 0, 0.15);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.font-select-filter {
  margin: 8px;
  height: 28px;
  padding: 0 8px;
  border: none;
  outline: none;
  background: rgba(255, 255, 255, 0.6);
  font: 12px SourceHanSansCN-Bold;
  color: black;
}

.font-select-list {
  flex: 1 1 auto;
  overflow-y: auto;
  padding-bottom: 6px;
}

.font-select-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  height: 30px;
  padding: 0 14px;
  /* 字体名一律用界面字体渲染：部分字体自带的字形缺失，用它自己渲染会变成方块 */
  line-height: 30px;
  font-size: 13px;
  cursor: pointer;
  transition: background-color 0.15s, color 0.15s;

  &:hover {
    background-color: black;
    color: white;
  }

  &.is-selected {
    background-color: rgba(0, 0, 0, 0.12);
  }

  .font-select-name {
    flex: 1 1 auto;
    min-width: 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .font-select-sample {
    flex: 0 0 auto;
    font-size: 13px;
    opacity: 0.75;
    white-space: nowrap;
  }
}

.font-select-empty {
  padding: 10px 14px;
  font: 12px SourceHanSansCN-Bold;
  color: rgba(0, 0, 0, 0.45);
}

.font-select-enter-active,
.font-select-leave-active {
  transition: opacity 0.12s ease;
}

.font-select-enter-from,
.font-select-leave-to {
  opacity: 0;
}
</style>
