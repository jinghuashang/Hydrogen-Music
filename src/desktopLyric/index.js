/**
 * Desktop Lyric (桌面歌词与置顶锁定模块)
 * 包含：
 * - DesktopLyricManager: Electron 主进程原生窗口置顶与锁定穿透管理器
 * - DesktopLyric: Vue 渲染层组件
 */

const DesktopLyricManager = require('./desktopLyricManager')

module.exports = {
    DesktopLyricManager,
}
