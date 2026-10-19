const { ipcMain }= require('electron')
const getDirTree = require('./dirTree')
const Store = require('electron-store');


module.exports = function LocalFiles(win, app) {
    const settingsStore = new Store({name: 'settings'})
    const localStore = new Store({name: 'localMusic'})
       
    function sendLocalFiles(dirTree, metadata, type, count) {
        let localData = {
            dirTree: dirTree,
            locaFilesMetadata: metadata,
            type: type,
            count: count
        }
        win.webContents.send('local-music-files', localData)
    }

    async function readLocalFiles(type, refresh) {
        let dirTree = []
        let metadata = []
        if(refresh || (!localStore.get('localFiles.downloaded') && type == 'downloaded') || (!localStore.get('localFiles.local') && type == 'local')) {
            let baseUrl = []
            if(type == 'downloaded') {
                let url = await settingsStore.get('settings')
                baseUrl.push(url.local.downloadFolder)
            } else if(type == 'local') {
                let url = await settingsStore.get('settings')
                baseUrl = url.local.localFolder
            }
            baseUrl = (baseUrl || []).filter(Boolean)
            let count = 0
            for (let i = 0; i < baseUrl.length; i++) {
                try {
                    dirTree.push(await getDirTree(baseUrl[i], 'dir'))
                    metadata.push(await getDirTree(baseUrl[i], 'data', win))
                    count += (metadata[i] && metadata[i].count) || 0
                } catch (err) {
                    console.warn('[local-scan]', baseUrl[i], err.message)
                }
            }
            sendLocalFiles(dirTree, metadata, type, count)
            count = null
            let localData = {
                dirTree: dirTree,
                locaFilesMetadata: metadata
            }
            if(type == 'downloaded') {
                localStore.set('localFiles.downloaded', localData)
            }  else if(type == 'local') {
                localStore.set('localFiles.local', localData)
            }
        } else {
            if(type == 'downloaded') {
                const data = await localStore.get('localFiles.downloaded')
                data.type = 'downloaded'
                win.webContents.send('local-music-files', data)
            }  else if(type == 'local') {
                const data =await localStore.get('localFiles.local')
                data.type = 'local'
                win.webContents.send('local-music-files', data)
            }

        }
    }
    ipcMain.on('scan-local-music', (e, params) => {
        // 目录被删除/断开或文件损坏时不能让未捕获拒绝终止主进程
        readLocalFiles(params.type, params.refresh).catch((err) => {
            console.warn('[local-scan]', err && err.message)
        })
    })
    ipcMain.on('clear-local-music-data', (e, type) => {
        if(type == 'downloaded') {
            localStore.set('localFiles.downloaded', null)
        }  else if(type == 'local') {
            localStore.set('localFiles.local', null)
        }
    })
}