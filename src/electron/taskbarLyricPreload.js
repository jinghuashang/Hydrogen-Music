// 任务栏歌词窗口的极简桥：只接收歌词文本，暴露给覆盖层页面
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('taskbarLyric', {
    onLyric: (callback) => {
        const handler = (_event, payload) => callback(payload)
        ipcRenderer.on('taskbar-lyric:update', handler)
        return () => ipcRenderer.removeListener('taskbar-lyric:update', handler)
    },
})
