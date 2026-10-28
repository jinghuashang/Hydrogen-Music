import '../assets/css/fonts.css'
import './style.css'

const root = document.getElementById('taskbar-lyric')
const textEl = document.getElementById('taskbar-lyric-text')
const fillEl = document.getElementById('taskbar-lyric-fill')
const MIN_FONT_SIZE = 11
const HORIZONTAL_PADDING = 12
const ALIGN_MAP = { left: 'flex-start', center: 'center', right: 'flex-end' }
const DARK_TEXT = '#141414'
const LIGHT_TEXT = '#f8f8f8'

let lastPayload = null
// 播放状态快照：本地时钟在两次 IPC 之间推算当前时间并切句
let clock = null
let activeIndex = -1
let renderedSignature = ''
let wordWidths = []
let frameId = null

function parseHexColor(value) {
    const match = /^#?([0-9a-f]{6})$/i.exec(String(value || '').trim())
    return match ? parseInt(match[1], 16) : null
}

/** 相对亮度：用于决定压在背景上的字该用深色还是浅色 */
function luminance(value) {
    const rgb = parseHexColor(value)
    if (rgb === null) return null
    const r = (rgb >> 16) & 255
    const g = (rgb >> 8) & 255
    const b = rgb & 255
    return (0.299 * r + 0.587 * g + 0.114 * b) / 255
}

function toRgba(value, alpha) {
    const rgb = parseHexColor(value)
    if (rgb === null) return ''
    const r = (rgb >> 16) & 255
    const g = (rgb >> 8) & 255
    const b = rgb & 255
    const percent = Number(alpha)
    const a = (Number.isFinite(percent) ? Math.min(100, Math.max(0, percent)) : 100) / 100
    return `rgba(${r}, ${g}, ${b}, ${a})`
}

function applyStyle(payload) {
    const align = ALIGN_MAP[payload?.align] || ALIGN_MAP.center
    root.style.justifyContent = align

    // 字体：自定义字体族优先，缺省回落到内置思源黑体
    root.style.fontFamily = payload?.fontFamily
        ? `"${payload.fontFamily}", SourceHanSansCN-Bold, Inter, Avenir, Helvetica, Arial, sans-serif`
        : ''
    root.style.fontWeight = payload?.fontWeight || ''
    root.style.fontStyle = payload?.italic ? 'italic' : ''
    root.style.letterSpacing = `${Number(payload?.letterSpacing) || 0}px`
    root.classList.toggle('no-shadow', payload?.shadow === false)

    // 描边：paint-order 让描边画在字形外侧，不啃字
    const strokeWidth = Math.max(0, Math.min(6, Number(payload?.strokeWidth) || 0))
    if (payload?.stroke && strokeWidth > 0) {
        root.style.webkitTextStroke = `${strokeWidth}px ${payload?.strokeColor || '#ffffff'}`
    } else {
        root.style.webkitTextStroke = ''
    }

    root.style.background = toRgba(payload?.background, payload?.backgroundAlpha)

    // 颜色的优先级：自定义文字色 > 按自定义背景亮度取反 > 跟随系统深浅色
    let color = payload?.color || ''
    if (!color) {
        const bgLuma = payload?.background ? luminance(payload.background) : null
        if (bgLuma !== null) color = bgLuma > 0.6 ? DARK_TEXT : LIGHT_TEXT
        else color = payload?.dark === true ? LIGHT_TEXT : DARK_TEXT
    }
    root.style.color = color
    // 未唱部分用半透明文字色（而非整层 opacity）：光晕挂在同一层的字上时不会被一起变淡
    textEl.style.color = payload?.karaoke === true ? toRgba(color, 45) || color : ''

    // 浅色字配深阴影、深色字配白描边，保证压在任务栏图标上也读得清
    const textLuma = luminance(color)
    root.classList.toggle('is-light-text', textLuma !== null && textLuma > 0.55)

    const karaoke = payload?.karaoke === true
    const karaokeColor = payload?.karaokeColor || '#e8384f'
    root.classList.toggle('karaoke', karaoke)
    root.style.setProperty('--karaoke-color', karaokeColor)
    // 晕染用低透明度同色光，避免高不透明度大模糊把字糊成色块
    // 晕染用低透明度：半径大但很淡，才不会把字的内部糊成色块
    root.style.setProperty('--karaoke-glow', toRgba(karaokeColor, 26) || 'rgba(232, 56, 79, 0.26)')
    root.style.setProperty('--karaoke-glow-soft', toRgba(karaokeColor, 13) || 'rgba(232, 56, 79, 0.13)')
}

function measureWords() {
    wordWidths = [...fillEl.children].map((el) => el.getBoundingClientRect().width)
}

/** 按行内容重建文字（逐字行用等量的字级 span，普通行用整段文本） */
function renderLine(line) {
    const words = Array.isArray(line?.words) && line.words.length ? line.words : null
    const signature = words ? `w:${words.map((word) => word.c).join('')}` : `t:${line?.text || ''}`
    if (signature !== renderedSignature) {
        renderedSignature = signature
        if (words) {
            textEl.textContent = ''
            fillEl.textContent = ''
            for (const word of words) {
                const base = document.createElement('span')
                base.textContent = word.c
                const fill = document.createElement('span')
                fill.textContent = word.c
                textEl.appendChild(base)
                fillEl.appendChild(fill)
            }
        } else {
            textEl.textContent = line?.text || ''
            fillEl.textContent = line?.text || ''
        }
        wordWidths = []
        singingElement = null
        // 重新触发入场动画
        root.classList.remove('is-enter')
        void root.offsetWidth
        root.classList.add('is-enter')
        fitToWidth()
    }
    if (words) measureWords()
}

/** 字号自适应：优先用设置里的字号，超宽时逐级缩小直到放得下 */
function fitToWidth() {
    if (!lastPayload || !textEl.textContent) return
    const maxWidth = window.innerWidth - HORIZONTAL_PADDING * 2
    const preferred = Number(lastPayload.fontSize) || 20
    const base = Math.max(MIN_FONT_SIZE, Math.min(preferred, window.innerHeight - 8))
    let size = base
    root.style.fontSize = `${size}px`
    // 量文本本身（容器是铺满窗口的 fixed 层，scrollWidth 恒等于窗口宽度）
    while (textEl.scrollWidth > maxWidth && size > MIN_FONT_SIZE) {
        size -= 1
        root.style.fontSize = `${size}px`
    }
}

/** 逐字模式：当前已唱到的像素宽度 + 正在唱的字序号 */
function sungPixels(line, time) {
    let px = 0
    let singingIndex = -1
    const words = line.words || []
    for (let i = 0; i < words.length; i += 1) {
        const word = words[i]
        const width = wordWidths[i] || 0
        if (time >= word.t + word.d) {
            px += width
            continue
        }
        if (time > word.t) {
            px += width * ((time - word.t) / Math.max(word.d, 0.001))
            singingIndex = i
        }
        break
    }
    return { px, singingIndex }
}

// 正在唱的字加一层晕染光；拖长音时半径随进度继续变大，且持续到该字结束
let singingElement = null
const glowRadius = () => Math.max(0, Math.min(24, Number(lastPayload?.glowRadius) || 8))

/**
 * 晕染只做「少量关键帧 + CSS 过渡」：每帧改 text-shadow 会不断打断过渡并触发重绘，
 * 看起来一卡一卡的。这里强度变化不足 0.12 就跳过，剩下的交给 0.45s 的过渡补间。
 */
function paintGlow(element, strength) {
    if (!element) return
    const radius = glowRadius()
    if (radius <= 0) {
        if (element.style.filter) element.style.filter = ''
        if (element.style.textShadow) element.style.textShadow = ''
        element.dataset.glowStrength = '0'
        return
    }
    const applied = Number(element.dataset.glowStrength)
    if (Number.isFinite(applied) && Math.abs(applied - strength) < 0.12) return
    element.dataset.glowStrength = String(strength)
    if (element.style.filter) element.style.filter = ''
    // 贴着字形的大半径低透明度阴影：光沿着笔画化开，字的内部仍然透得出来
    const inner = Math.max(1, radius * 0.4 * strength)
    const outer = Math.max(1, radius * strength)
    element.style.textShadow = `0 0 ${inner.toFixed(1)}px var(--karaoke-glow), 0 0 ${outer.toFixed(1)}px var(--karaoke-glow-soft)`
}

let singingBaseElement = null

function updateSingingWord(index, word, time) {
    const next = index >= 0 ? fillEl.children[index] || null : null
    const nextBase = index >= 0 ? textEl.children[index] || null : null
    if (next !== singingElement) {
        if (singingElement) {
            singingElement.classList.remove('is-singing')
            singingElement.style.textShadow = ''
            singingElement.style.filter = ''
            singingElement.dataset.glowStrength = ''
        }
        singingElement = next
        if (singingElement) singingElement.classList.add('is-singing')
    }
    if (nextBase !== singingBaseElement) {
        if (singingBaseElement) {
            singingBaseElement.style.textShadow = ''
            singingBaseElement.style.filter = ''
            singingBaseElement.dataset.glowStrength = ''
        }
        singingBaseElement = nextBase
    }
    if (!singingElement) {
        if (singingBaseElement) {
            singingBaseElement.style.textShadow = ''
            singingBaseElement.style.filter = ''
        }
        return
    }
    // 长音（>=0.8s）：前 75% 把晕染越推越大（最大 2.4 倍），最后 25% 才开始收回
    const duration = Number(word?.d) || 0
    let strength = 1
    if (duration >= 0.8) {
        const progress = Math.min(1, Math.max(0, (time - word.t) / duration))
        const peak = 3.0
        strength = progress <= 0.75
            ? 1 + (peak - 1) * (progress / 0.75)
            : peak - (peak - 1) * ((progress - 0.75) / 0.25)
    }
    paintGlow(singingElement, strength)
    // 底色层没有被 clip 裁切，光晕能完整地晕出字外
    paintGlow(singingBaseElement, strength)
}

function paint(line, time) {
    if (!line) {
        root.style.setProperty('--karaoke', '0%')
        return
    }
    if (line.words && line.words.length) {
        const { px, singingIndex } = sungPixels(line, time)
        root.style.setProperty('--karaoke', `${px.toFixed(1)}px`)
        updateSingingWord(singingIndex, line.words[singingIndex], time)
        return
    }
    updateSingingWord(-1)
    const duration = Number(line.duration) || 0
    const percent = duration > 0
        ? Math.min(1, Math.max(0, (time - line.start) / duration))
        : (time >= line.start ? 1 : 0)
    root.style.setProperty('--karaoke', `${(percent * 100).toFixed(2)}%`)
}

function activeLineIndex(time) {
    const lines = clock?.lines || []
    let index = -1
    for (let i = 0; i < lines.length; i += 1) {
        if (lines[i].start <= time) index = i
        else break
    }
    return index < 0 ? (lines.length ? 0 : -1) : index
}

function frame(now) {
    if (!clock) return
    const elapsed = clock.playing ? (now - clock.baseTs) / 1000 : 0
    const time = clock.now + elapsed
    const index = activeLineIndex(time)
    const line = index >= 0 ? clock.lines[index] : null
    if (index !== activeIndex) {
        activeIndex = index
        renderLine(line)
    }
    paint(line, time)
    frameId = clock.playing ? requestAnimationFrame(frame) : null
}

function restartClock(payload) {
    if (frameId !== null) {
        cancelAnimationFrame(frameId)
        frameId = null
    }
    clock = {
        lines: Array.isArray(payload?.lines) ? payload.lines : [],
        now: Math.max(0, Number(payload?.now) || 0),
        playing: payload?.playing === true,
        // 用本帧时间作基准，避免跨进程时钟差
        baseTs: performance.now(),
    }
    activeIndex = -1
    if (clock.lines.length === 0) {
        root.classList.add('is-empty')
        textEl.textContent = ''
        fillEl.textContent = ''
        renderedSignature = ''
        wordWidths = []
        return
    }
    root.classList.remove('is-empty')
    frame(clock.baseTs)
}

function render(payload) {
    lastPayload = payload || null
    applyStyle(payload)
    restartClock(payload)
}

window.taskbarLyric?.onLyric(render)
window.addEventListener('resize', () => {
    fitToWidth()
    measureWords()
})
