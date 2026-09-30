import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const appFile = path.join(repoDir, 'public/mv/jizura/index.html')
const cssFile = path.join(repoDir, 'public/mv/jizura/hydrogen.css')
const source = await readFile(appFile, 'utf8')
const css = (await readFile(cssFile, 'utf8')).replace(/\r\n/g, '\n').trimEnd()

if (css.includes('</style>')) {
  throw new Error('Hydrogen stylesheet must not contain a closing style tag')
}

function replaceOnce(text, needle, replacement, label) {
  const index = text.indexOf(needle)
  if (index < 0 || text.indexOf(needle, index + needle.length) !== -1) {
    throw new Error(`Expected exactly one ${label} anchor in the upstream bundle`)
  }
  return text.slice(0, index) + replacement + text.slice(index + needle.length)
}

function patchUpstream(html) {
  if (!html.includes('data-hydrogen-mv="true"')) {
    html = replaceOnce(html, '<html lang="zh-Hans"', '<html lang="zh-Hans" data-hydrogen-mv="true"', 'document root')
  }
  html = html.replace('class="fixed-ok" ', '')
  html = html.replace('class="fixed-ok"', '')
  html = replaceOnce(html, '<div id="app">\n  <header class="bar">', '<div id="app">\n  <div class="jizura-note">歌词动态视频 · 由 JIZURA 编辑器驱动 | 自选本地音频，生成你的 MV</div>\n  <header class="bar" aria-hidden="true" style="display:none">', 'standalone toolbar')
  html = replaceOnce(html, 'function tick(now) {\n  requestAnimationFrame(tick);', 'let renderFrame = 0;\nfunction tick(now) {\n  renderFrame = 0;\n  if (window.parent !== window && document.body.dataset.hydrogenEditorHidden === "true") return;\n  renderFrame = requestAnimationFrame(tick);', 'editor rendering scheduler')
  html = replaceOnce(html, '  const c0 = S.plan.cuts.find(c => c.line >= 0);\n  if (c0) seek(c0.start + Math.min(c0.dur * 0.6, c0.inDur + 0.25));\n  requestAnimationFrame(tick);', '  const c0 = S.plan.cuts.find(c => c.line >= 0);\n  if (c0) seek(c0.start + Math.min(c0.dur * 0.6, c0.inDur + 0.25));\n  document.body.dataset.hydrogenEditorHidden = "false";\n  renderFrame = requestAnimationFrame(tick);', 'editor initial render')
  html = replaceOnce(html, '    if (!restored && J.saveSong) J.saveSong(f);             // kept in this browser: a reload does not drop the song from exports', '    if (window.parent === window && !restored && J.saveSong) J.saveSong(f);', 'standalone local audio persistence')

  const hostApi = 'J.uiApi = { toast, replan, syncUI, pause, seek, flushSave, loadAudioFile, restartPreview, exportRange, exportRangeLines };'
  const hostBridge = `${hostApi}

if (window.parent !== window) {
  window.addEventListener('message', async event => {
    if (event.source !== window.parent || (location.origin !== 'null' && event.origin !== location.origin)) return;
    const message = event.data;
    if (!message || message.source !== 'hydrogen-mv' || message.version !== 1) return;
    if (message.type === 'hello') {
      setTimeout(() => window.parent.postMessage({ source: 'jizura-mv', version: 1, type: 'ready' }, location.origin === 'null' ? '*' : location.origin), 0);
      return;
    }
    if (message.type === 'new-project' || message.type === 'seed') {
      const seed = message.type === 'seed' ? message.handoff : null;
      if (seed && (seed.version !== 1 || typeof seed.handoffId !== 'number' || typeof seed.title !== 'string' || typeof seed.artist !== 'string' || typeof seed.lyrics !== 'string')) return;
      if (S.tap) stopTap();
      if (S.exporting) S.exporting.abort();
      pause();
      const project = mergeProject(null);
      if (seed) audioSeq++;
      project.lyrics = seed ? seed.lyrics : '';
      if (seed) { project.title = seed.title; project.artist = seed.artist; }
      project.timing.lineTimes = {};
      project.overrides = {};
      project.exportRange = null;
      if (seed && S.audio) project.audioName = S.audio.name;
      S.project = project;
      $('songTitle').value = project.title;
      $('songArtist').value = project.artist;
      ED.undo = []; ED.redo = []; H.list = []; H.i = -1;
      TL.z = 1; TL.off = 0;
      $('lyrics').value = project.lyrics;
      fontKey = '';
      syncUI(); replan(); commit(); updateEditBtns(); flushSave(); seek(0);
      if (seed) window.parent.postMessage({ source: 'jizura-mv', version: 1, type: 'seed-applied', handoffId: seed.handoffId }, location.origin === 'null' ? '*' : location.origin);
      return;
    }
    if (message.type === 'visibility' && typeof message.visible === 'boolean') {
      document.body.dataset.hydrogenEditorHidden = String(!message.visible);
      if (!message.visible) {
        if (S.tap) stopTap();
        pause();
        if (S.exporting) S.exporting.abort();
        clearTimeout(warmTimer);
        clearTimeout(replanTimer);
        warmJob++;
        cancelAnimationFrame(renderFrame);
        renderFrame = 0;
        cancelAnimationFrame(previewRaf);
        previewRaf = 0;
      } else {
        S.need = true;
        if (!renderFrame) renderFrame = requestAnimationFrame(tick);
        kickPreviewLoop();
      }
    }
  });
}`
  return replaceOnce(html, hostApi, hostBridge, 'editor host API')
}

function refreshHydrogenStyles(html) {
  const marker = '/* Hydrogen shell styles */'
  const styleStart = html.lastIndexOf('<style>', html.indexOf('</head>'))
  const styleEnd = html.indexOf('</style>', styleStart)
  const markerStart = html.indexOf(marker, styleStart)
  const block = `<style>\n${marker}\n${css.trimEnd()}\n</style>`
  if (styleStart < 0) return html.replace('</head>', `${block}\n</head>`)
  if (styleEnd < 0) throw new Error('Expected a complete Hydrogen shell stylesheet')
  if (markerStart < styleStart || markerStart >= styleEnd) {
    return html.replace('</head>', `${block}\n</head>`)
  }
  const existingStyle = html.slice(styleStart, styleEnd + '</style>'.length)
  if (existingStyle === block) return html
  return html.slice(0, styleStart) + block + html.slice(styleEnd + '</style>'.length)
}

let html = source
if (!source.includes('data-hydrogen-mv="true"')) {
  if (!source.includes('J.defaultProject = () => ({') || !source.includes('  lyrics: J.SAMPLE_LYRICS,')) {
    throw new Error('Expected the complete upstream JIZURA browser bundle')
  }
  html = patchUpstream(html)
}
html = refreshHydrogenStyles(html)

const coreStyleEnd = html.indexOf('</style>')
const styleStart = html.indexOf('<style>', coreStyleEnd + '</style>'.length)
const styleEnd = html.indexOf('</style>', styleStart)
const styleContent = html.slice(styleStart, styleEnd)
const hydrogenStart = styleContent.indexOf('/* Hydrogen shell styles */')
if (coreStyleEnd < 0 || styleStart < 0 || styleEnd < 0 || hydrogenStart < 0 || !styleContent.includes(css.trimEnd())) {
  throw new Error('Generated JIZURA HTML must contain the maintained Hydrogen stylesheet')
}
await writeFile(appFile, html, 'utf8')
console.log(`Integrated JIZURA (${Buffer.byteLength(html)} bytes)`)
