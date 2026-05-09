/** 与 src/electron/ipcMain.js 中 initSettings 保持一致 */
function defaultSettings() {
  return {
    music: {
      level: 'standard',
      lyricSize: '20',
      tlyricSize: '14',
      rlyricSize: '12',
      lyricInterlude: 13,
      /** 与 playerStore 对齐，写入 settings.json 供 Web 多浏览器共用 */
      coverBlur: false,
      lyricBlur: false,
      musicVideo: false,
    },
    local: {
      videoFolder: null,
      downloadFolder: null,
      localFolder: [],
      /** Web：将网易云登录态与用户偏好写入 NAS，多浏览器共用 */
      syncProfileToNas: false,
    },
    shortcuts: [
      { id: 'play', name: '播放/暂停', shortcut: 'CommandOrControl+P', globalShortcut: 'CommandOrControl+Alt+P' },
      { id: 'last', name: '上一首', shortcut: 'CommandOrControl+Left', globalShortcut: 'CommandOrControl+Alt+Left' },
      { id: 'next', name: '下一首', shortcut: 'CommandOrControl+Right', globalShortcut: 'CommandOrControl+Alt+Right' },
      { id: 'volumeUp', name: '增加音量', shortcut: 'CommandOrControl+Up', globalShortcut: 'CommandOrControl+Alt+Up' },
      { id: 'volumeDown', name: '减少音量', shortcut: 'CommandOrControl+Down', globalShortcut: 'CommandOrControl+Alt+Down' },
      { id: 'processForward', name: '快进(3s)', shortcut: 'CommandOrControl+]', globalShortcut: 'CommandOrControl+Alt+]' },
      { id: 'processBack', name: '后退(3s)', shortcut: 'CommandOrControl+[', globalShortcut: 'CommandOrControl+Alt+[' },
    ],
    other: {
      globalShortcuts: true,
      quitApp: 'minimize',
      updateProxy: '',
      externalUnblockUrl: '',
    },
    unblock: {
      enabled: true,
    },
  }
}

module.exports = { defaultSettings }
