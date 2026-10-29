import '../assets/css/fonts.css'
import './style.css'

const root = document.getElementById('taskbar-lyric')
const textEl = document.getElementById('taskbar-lyric-text')
const fillEl = document.getElementById('taskbar-lyric-fill')
const MIN_FONT_SIZE = 11
const HORIZONTAL_PADDING = 26
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
    // 参考 Alger：当前行未唱的部分是「原文字色」而不是半透明，深浅差异靠卡拉OK色体现
    textEl.style.color = ''
    textEl.style.textShadow = ''

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
    // 正在唱的（尤其是句尾长音）用更高不透明度，才看得出明显的晕染
    root.style.setProperty('--karaoke-glow-strong', toRgba(karaokeColor, 55) || 'rgba(232, 56, 79, 0.55)')
    root.style.setProperty('--karaoke-glow-strong-soft', toRgba(karaokeColor, 28) || 'rgba(232, 56, 79, 0.28)')
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
            const startY = 'translateY(0px)'
            for (const word of words) {
                const base = document.createElement('span')
                base.textContent = word.c
                base.style.transform = startY
                // 初始给一层同半径的透明阴影：这样字第一次亮起来时是渐变而不是“啪”一下加重
                base.style.textShadow = transparentGlow()
                const fill = document.createElement('span')
                fill.textContent = word.c
                fill.style.transform = startY
                textEl.appendChild(base)
                fillEl.appendChild(fill)
            }
        } else {
            textEl.textContent = line?.text || ''
            fillEl.textContent = line?.text || ''
        }
        wordWidths = []
        singingElement = null
        previousBaseElement = null
        litCount = -1
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
const WORD_RAISE = 1

/** 已唱到的字整体抬高、未唱的压低，形成向上的“台阶” */
let lastUpTo = -1

function applyWordOffsets(upTo, animate = true) {
    lastUpTo = upTo
    const base = textEl.children
    const fill = fillEl.children
    for (let i = 0; i < base.length; i += 1) {
        const raised = upTo >= 0 && i <= upTo
        // 未唱的字保持原始基线（不再下压），唱到的字只向上抬
        const value = raised ? `translateY(-${WORD_RAISE}px)` : 'translateY(0px)'
        // 行刚重建时用瞬时赋值：否则已唱字会先落到基线再缓动抬回，看起来像"下沉又回弹"
        if (!animate) {
            base[i].style.transition = 'none'
            if (fill[i]) fill[i].style.transition = 'none'
        }
        if (base[i].style.transform !== value) base[i].style.transform = value
        const mirror = fill[i]
        if (mirror && mirror.style.transform !== value) mirror.style.transform = value
        if (!animate) {
            // 强制重排后恢复过渡，后续唱字仍然沿动画走
            void base[i].offsetWidth
            base[i].style.transition = ''
            if (mirror) mirror.style.transition = ''
        }
    }
}

/** 已唱完的字把底色也改成卡拉OK色：填充层与底色层叠在一起时，
 *  字形边缘的抗锯齿会露出一点底色，颜色不一致就会像“描边” */
function applyWordColors(upTo, finished) {
    const base = textEl.children
    for (let i = 0; i < base.length; i += 1) {
        // 底色层永远保持原歌词颜色：进度颜色完全由填充层 clip 绘制。
        // 若唱完后再把底色层切到 karaoke 色，两层同色叠加会让字在整字定型瞬间变深
        if (!base[i].style.textShadow || base[i].style.textShadow.includes('transparent')) {
            delete base[i].dataset.glow
            paintGlow(base[i], 1, false)
        }
    }
}

/**
 * 晕染淡出：直接把 text-shadow 清空会瞬间消失（none 无法参与过渡），
 * 这里保留同样的半径、只把颜色换成 transparent，交给 CSS 的 0.45s 过渡补间
 */
function fadeGlowOut(element) {
    if (!element) return
    const current = element.style.textShadow
    if (!current) return
    element.style.textShadow = current.replace(/var\([^)]*\)/g, 'transparent')
}

let singingElement = null
// 上一个唱过的字：保留一层较弱的柔光，形成“强光 → 柔光 → 淡出”的交接
let previousBaseElement = null
const glowRadius = () => Math.max(0, Math.min(24, Number(lastPayload?.glowRadius) || 8))

/**
 * 晕染只做「少量关键帧 + CSS 过渡」：每帧改 text-shadow 会不断打断过渡并触发重绘，
 * 看起来一卡一卡的。这里强度变化不足 0.12 就跳过，剩下的交给 0.45s 的过渡补间。
 */
/** 与 paintGlow 相同半径、但全透明的阴影，用于让“从无到有”也能走过渡 */
function transparentGlow() {
    const radius = glowRadius()
    const near = Math.max(2, radius * 0.16)
    return `0 0 ${near.toFixed(1)}px transparent, 0 0 ${(near * 2.1).toFixed(1)}px transparent, 0 0 ${(near * 3.6).toFixed(1)}px transparent`
}

function paintGlow(element, strength, strong = false) {
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
    // 描边式渐晕：三层小半径阴影贴着笔画逐层放大、逐层变淡，
    // 半径小到不会糊住字内部，也不会出现多方向叠层那种重影
    const near = Math.max(2, radius * 0.16)
    const mid = near * 2.1
    const far = near * 3.6
    const nearColor = strong ? 'var(--karaoke-glow-strong)' : 'var(--karaoke-glow)'
    const midColor = strong ? 'var(--karaoke-glow)' : 'var(--karaoke-glow)'
    const farColor = 'var(--karaoke-glow-soft)'
    element.style.filter = ''
    element.style.textShadow = `0 0 ${near.toFixed(1)}px ${nearColor}, 0 0 ${mid.toFixed(1)}px ${midColor}, 0 0 ${far.toFixed(1)}px ${farColor}`
}

let singingBaseElement = null

let litCount = -1

/** 已唱过的字保持一层基础晕染，让整句已唱部分连成一条光带 */
function paintSungGlow(sungCount) {
    if (sungCount === litCount) return
    litCount = sungCount
    const bases = textEl.children
    for (let i = 0; i < bases.length; i += 1) {
        const el = bases[i]
        if (i < sungCount) {
            if (!el.dataset.sungGlow) {
                el.dataset.sungGlow = '1'
                el.dataset.glowStrength = ''
                paintGlow(el, 1)
            }
        } else if (el.dataset.sungGlow) {
            delete el.dataset.sungGlow
            el.style.textShadow = ''
            el.style.filter = ''
            el.dataset.glowStrength = ''
        }
    }
}

function updateSingingWord(index, word, time, totalWords) {
    paintSungGlow(-1)
    const next = index >= 0 ? fillEl.children[index] || null : null
    const nextBase = index >= 0 ? textEl.children[index] || null : null
    if (next !== singingElement) {
        if (singingElement) {
            singingElement.classList.remove('is-singing')
            singingElement.style.filter = ''
            singingElement.dataset.glowStrength = ''
        }
        singingElement = next
        if (singingElement) singingElement.classList.add('is-singing')
    }
    if (nextBase !== singingBaseElement) {
        // 底色层的晕染是静态底纹，不随唱字状态增减
        singingBaseElement = nextBase
    }
    if (!singingElement) {
        if (singingBaseElement) {
            singingBaseElement.style.textShadow = ''
            singingBaseElement.style.filter = ''
        }
        return
    }
    // 只给底色层加光晕：填充层被 clip-path 按进度裁切，挂在它上面的光会被裁成直角
    if (singingElement) {
        singingElement.style.textShadow = ''
        singingElement.style.filter = ''
    }
    // 晕染只作用于未唱的字；当前唱字/已唱字不带光晕（见 applyWordColors）
}

function paint(line, time) {
    if (!line) {
        root.style.setProperty('--karaoke', '0%')
        return
    }
    if (line.words && line.words.length) {
        const { px, singingIndex } = sungPixels(line, time)
        root.style.setProperty('--karaoke', `${px.toFixed(1)}px`)
        // 一句唱完后（还没切到下一句）保持整句抬起，不要因为“没有正在唱的字”而整体回落
        const lastWord = line.words[line.words.length - 1]
        const lineFinished = !!lastWord && time >= lastWord.t + lastWord.d
        const lastIndex = line.words.length - 1
        applyWordOffsets(lineFinished ? lastIndex : singingIndex)
        applyWordColors(singingIndex, lineFinished)
        // 一句唱完后把晕染留在最后一个字上，直到下一句开始才换走，
        // 避免句尾和下一句之间留很长时间时光晕突然消失
        updateSingingWord(
            lineFinished ? lastIndex : singingIndex,
            line.words[lineFinished ? lastIndex : singingIndex],
            time,
            line.words.length,
        )
        return
    }
    updateSingingWord(-1, null, time, 0)
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
