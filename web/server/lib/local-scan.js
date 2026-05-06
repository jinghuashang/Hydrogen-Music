const path = require('path')
const getDirTree = require('../../../src/electron/dirTree')
const { createStore } = require('./store')

/**
 * 复用原 dirTree；用 broadcast 替代 win.webContents.send
 */
function createLocalScan({ settingsStore, broadcast }) {
  const localStore = createStore('localMusic')

  function mockWin() {
    return {
      webContents: {
        send(channel, data) {
          broadcast(channel, data)
        },
      },
    }
  }

  async function readLocalFiles(type, refresh) {
    let dirTree = []
    let metadata = []
    const win = mockWin()
    if (
      refresh ||
      (!localStore.get('localFiles.downloaded') && type === 'downloaded') ||
      (!localStore.get('localFiles.local') && type === 'local')
    ) {
      let baseUrl = []
      if (type === 'downloaded') {
        const s = settingsStore.get('settings')
        if (s && s.local && s.local.downloadFolder) baseUrl.push(s.local.downloadFolder)
      } else if (type === 'local') {
        const s = settingsStore.get('settings')
        baseUrl = (s && s.local && s.local.localFolder) || []
      }
      let count = 0
      for (let i = 0; i < baseUrl.length; i++) {
        if (!baseUrl[i]) continue
        try {
          const dt = await getDirTree(baseUrl[i], 'dir')
          const md = await getDirTree(baseUrl[i], 'data', win)
          dirTree.push(dt)
          metadata.push(md)
          count += md.count || 0
        } catch (e) {
          console.error('[local-scan]', baseUrl[i], e.message)
        }
      }
      const localData = {
        dirTree,
        locaFilesMetadata: metadata,
        type,
        count,
      }
      broadcast('local-music-files', localData)
      const cache = { dirTree, locaFilesMetadata: metadata }
      if (type === 'downloaded') {
        localStore.set('localFiles.downloaded', cache)
      } else if (type === 'local') {
        localStore.set('localFiles.local', cache)
      }
    } else {
      if (type === 'downloaded') {
        const data = localStore.get('localFiles.downloaded')
        data.type = 'downloaded'
        broadcast('local-music-files', data)
      } else if (type === 'local') {
        const data = localStore.get('localFiles.local')
        data.type = 'local'
        broadcast('local-music-files', data)
      }
    }
  }

  return {
    readLocalFiles,
    clearLocalMusicData(type) {
      if (type === 'downloaded') {
        localStore.set('localFiles.downloaded', null)
      } else if (type === 'local') {
        localStore.set('localFiles.local', null)
      }
    },
  }
}

module.exports = { createLocalScan }
