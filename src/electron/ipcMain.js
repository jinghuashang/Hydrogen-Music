const { ipcMain, shell, dialog, globalShortcut, Menu, clipboard } =  require('electron')
const axios = require('axios')
const fs = require('fs')
const path = require('path')
const { parseFile } = require('music-metadata')
const registerShortcuts = require('./shortcuts')
const { startUnblockNeteaseMusic, stopUnblockNeteaseMusic, restartUnblockNeteaseMusic, getUnblockStatus, getUnblockDiagnostic } = require('./services')
const Store = require('electron-store')
const CancelToken = axios.CancelToken
let cancel = null

module.exports = IpcMainEvent = (win, app) => {
    const settingsStore = new Store({name: 'settings'})
    const lastPlaylistStore = new Store({name: 'lastPlaylist'})
    const musicVideoStore = new Store({name: 'musicVideo'})
    ipcMain.handle('get-app-version', async () => {
        return require('../../package.json').version
    })
    ipcMain.on('window-min', () => {
        win.minimize()
    })
    ipcMain.on('window-max', () => {
        if(win.isMaximized()){
            win.restore()
        }else{
            win.maximize()
        }
    })
    ipcMain.on('window-close', async () => {
        const settings = await settingsStore.get('settings')
        if(settings.other.quitApp == 'minimize') {
            win.hide()
        } else if(settings.other.quitApp == 'quit') {
            win.close()
        }
    })
    ipcMain.on('to-register', (e, url) => {
        shell.openExternal(url)
    })
    ipcMain.on('download-start', () => {
        win.webContents.send('download-next')
    })
    ipcMain.handle('get-image-base64', async (e, filePath) => {
        const data = await parseFile(filePath)
        if(data.common.picture) 
            return `data:${data.common.picture[0].format};base64,${data.common.picture[0].data.toString('base64')}`
        else
            return null
    })
    ipcMain.on('set-settings', (e, settings) => {
        settingsStore.set('settings', JSON.parse(settings))
        registerShortcuts(win)
    })
    ipcMain.handle('get-settings', async () => {
        const settings =  await settingsStore.get('settings')
        if(settings) {
            if (!settings.local) settings.local = {}
            if (settings.local.syncProfileToNas === undefined) settings.local.syncProfileToNas = false
            return settings
        }
        else {
            let initSettings = {
                music: {
                    level: 'standard',
                    searchResultLimit: 10,
                    lyricSize: '20',
                    tlyricSize: '14',
                    rlyricSize: '12',
                    lyricInterlude: 13,
                    coverBlur: false,
                    lyricBlur: false,
                    musicVideo: false,
                },
                local: {
                    videoFolder: null,
                    downloadFolder: null,
                    localFolder: [],
                    syncProfileToNas: false,
                },
                shortcuts: [
                    {
                        id: 'play',
                        name: '播放/暂停',
                        shortcut: 'CommandOrControl+P',
                        globalShortcut: 'CommandOrControl+Alt+P',
                    },
                    {
                        id: 'last',
                        name: '上一首',
                        shortcut: 'CommandOrControl+Left',
                        globalShortcut: 'CommandOrControl+Alt+Left',
                    },
                    {
                        id: 'next',
                        name: '下一首',
                        shortcut: 'CommandOrControl+Right',
                        globalShortcut: 'CommandOrControl+Alt+Right',
                    },
                    {
                        id: 'volumeUp',
                        name: '增加音量',
                        shortcut: 'CommandOrControl+Up',
                        globalShortcut: 'CommandOrControl+Alt+Up',
                    },
                    {
                        id: 'volumeDown',
                        name: '减少音量',
                        shortcut: 'CommandOrControl+Down',
                        globalShortcut: 'CommandOrControl+Alt+Down',
                    },
                    {
                        id: 'processForward',
                        name: '快进(3s)',
                        shortcut: 'CommandOrControl+]',
                        globalShortcut: 'CommandOrControl+Alt+]',
                    },
                    {
                        id: 'processBack',
                        name: '后退(3s)',
                        shortcut: 'CommandOrControl+[',
                        globalShortcut: 'CommandOrControl+Alt+[',
                    },
                ],
                other: {
                    globalShortcuts: true,
                    quitApp:'minimize',
                    updateProxy: ''
                },
                unblock: {
                    enabled: true,
                    port: '36531:36532',
                    sources: ['qq', 'kugou', 'kuwo', 'bilibili']
                }
            }
            settingsStore.set('settings', initSettings)
            registerShortcuts(win)
            return initSettings
        }
    })
    ipcMain.handle('dialog:openFile', async () => {
        const { canceled, filePaths } = await dialog.showOpenDialog(win, {
            properties: ['openDirectory'],
            title: '选择文件夹',
        })
        if (canceled || !filePaths?.length) return null
        return path.normalize(filePaths[0])
    })
    ipcMain.on('register-shortcuts', () => {
        registerShortcuts(win)
    })
    ipcMain.on('unregister-shortcuts', () => {
        Menu.setApplicationMenu(null)
        globalShortcut.unregisterAll()
    })
    ipcMain.on('save-last-playlist', (e, playlist) => {
        lastPlaylistStore.set('playlist', JSON.parse(playlist))
    })
    ipcMain.on('exit-app', (e, playlist) => {
        lastPlaylistStore.set('playlist', JSON.parse(playlist))
        app.exit()
    })
    ipcMain.handle('get-last-playlist', async () => {
        const lastPlaylist =  await lastPlaylistStore.get('playlist')
        if(lastPlaylist) return lastPlaylist
        else return null
    })
    ipcMain.on('open-local-folder', (e, targetPath) => {
        const p = path.normalize(String(targetPath || ''))
        if (!p) return
        try {
            if (fs.existsSync(p) && fs.statSync(p).isDirectory()) {
                shell.openPath(p)
            } else {
                shell.showItemInFolder(p)
            }
        } catch {
            shell.showItemInFolder(p)
        }
    })
    ipcMain.handle('get-request-data', async (e, request) => {
        const result = await axios.get(request.url, request.option)
        return result.data
    })
    const biliCookies = {}
    ipcMain.handle('get-bili-request-data', async (e, request) => {
        const option = request.option || {}
        option.headers = option.headers || {}
        const cookieStr = Object.entries(biliCookies).map(([k, v]) => `${k}=${v}`).join('; ')
        if (cookieStr) option.headers['Cookie'] = cookieStr
        const result = await axios.get(request.url, option)
        const setCookies = result.headers['set-cookie']
        if (setCookies) {
            setCookies.forEach(c => {
                const [kv] = c.split(';')
                const [name, ...vals] = kv.split('=')
                biliCookies[name.trim()] = vals.join('=')
            })
        }
        return { data: result.data, cookies: { ...biliCookies } }
    })
    async function searchMusicVideo(id) {
        if(musicVideoStore.has('musicVideo')) {
            const result = await musicVideoStore.get('musicVideo')
            const index = (result || []).findIndex((music) => music.id == id)
            if(index != -1) {
                return {data: result[index], index: index}
            } else return false
        } else return false
    }
    async function saveMusicVideo(data) {
        if(musicVideoStore.has('musicVideo')) {
            const musicVideo = await musicVideoStore.get('musicVideo')
            searchMusicVideo(data.id).then(result => {
                if(result) musicVideo.splice(result.index, 1)
                musicVideo.push(data)
                musicVideoStore.set('musicVideo', musicVideo)
            })
        } else {
            musicVideoStore.set('musicVideo', [data])
        }
    }
    function fileIsExists(path) { 
        return new Promise((resolve, reject) => {
            fs.access(path, fs.constants.F_OK, (err) => {
                if (!err) resolve(true)
                else return resolve(false)
            })
        })
    }
    ipcMain.handle('get-bili-video', async (e, request) => {
        const settings = await settingsStore.get('settings')
        if(!settings.local.videoFolder) return 'noSavePath'
        const videoAbsPath = path.join(
            settings.local.videoFolder,
            `${request.option.params.cid}_${request.option.params.quality.substring(3)}.mp4`,
        )
        let returnCode = 'success'
        if(await fileIsExists(videoAbsPath)) {
            request.option.params.timing = JSON.parse(request.option.params.timing)
            request.option.params.path = videoAbsPath
            saveMusicVideo(request.option.params)
            return returnCode
        } else {
            if(cancel != null) cancel()
            const result = await axios({
                url: request.url,
                method: 'get',
                headers: request.option.headers,
                responseType: 'stream',
                onDownloadProgress:(progressEvent)=>{
                    let progress = Math.round( progressEvent.loaded / progressEvent.total*100)
                    win.webContents.send('download-video-progress', progress)
                    if(returnCode == 'cancel') win.setProgressBar(-1)
                    else win.setProgressBar(progress / 100)
                },
                cancelToken: new CancelToken(function executor(c) {
                    cancel = c
                })
            })
            const writer = fs.createWriteStream(videoAbsPath)
            await result.data.pipe(writer)
            ipcMain.on('cancel-download-music-video', () => {
                returnCode = 'cancel'
                writer.close()
                writer.once('close', () => {
                    cancel()
                    win.setProgressBar(-1)
                    fs.unlinkSync(videoAbsPath)
                })
            })
            return new Promise((resolve, reject) => {
                writer.on("finish", () => {
                    win.setProgressBar(-1)
                    if(returnCode == 'cancel') {
                        resolve(returnCode)
                        return returnCode
                    }
                    request.option.params.timing = JSON.parse(request.option.params.timing)
                    request.option.params.path = videoAbsPath
                    saveMusicVideo(request.option.params)
                    resolve(returnCode)
                })
                writer.on("error", () => {
                    win.setProgressBar(-1)
                    reject('failed')
                })
            })
        }
    })
    ipcMain.handle('music-video-isexists', async (e, obj) => {
        const result = await searchMusicVideo(obj.id)
        if(result) {
            if(obj.method == 'get') return result
            if(result.data.streamBaseUrl) return result
            if(!result.data.path) return '404'
            const file = await fileIsExists(result.data.path)
            if(!file) return '404'
            else return result
        } else return false
    })
    ipcMain.handle('clear-unused-video', async (e) => {
        const settings = await settingsStore.get('settings')
        const folderPath = settings.local.videoFolder
        if(!folderPath) return 'noSavePath'
        const musicVideo = await musicVideoStore.get('musicVideo')
        const files = fs.readdirSync(folderPath)
        files.forEach(filename => {
            const filePath = path.join(folderPath, filename)
            if(!musicVideo.some(video => video.path && path.normalize(video.path) === path.normalize(filePath))) {
              console.log(filePath)
                fs.unlinkSync(filePath)
            }
        })
        return true
    })
    ipcMain.handle('delete-music-video', async (e, id) => {
        const musicVideo = await musicVideoStore.get('musicVideo')
        return new Promise((resolve, reject) => {
            searchMusicVideo(id).then(result => {
                if(result) {
                    musicVideo.splice(result.index, 1)
                    musicVideoStore.set('musicVideo', musicVideo)
                    resolve(true)
                } else resolve(false)
            })
        })
    })
    //获取本地歌词
    ipcMain.handle('get-local-music-lyric', async (e, filePath) => {
        const abs = path.normalize(filePath)
        const folderPath = path.dirname(abs)
        const fileName = path.basename(abs, path.extname(abs))
        async function readLyric(lyricPath) {
            try {
                return fs.readFileSync(lyricPath, 'utf8')
            } catch {
                return false
            }
        }
        function lyricHandle(data) {
            const lines = data.split(/\r?\n/)
            let lyricArr = ''
            lines.forEach((line) => {
                if(line) lyricArr += line + '\n'
            })
            return lyricArr
        }
        const lrcPath = path.join(folderPath, `${fileName}.lrc`)
        const txtPath = path.join(folderPath, `${fileName}.txt`)
        if(await fileIsExists(lrcPath)) {
            const res = await readLyric(lrcPath)
            if(res) return lyricHandle(res)
        }
        if(await fileIsExists(txtPath)) {
            const res = await readLyric(txtPath)
            if(res) return lyricHandle(res)
        }
        const metedata = await parseFile(abs)
        if(metedata.common.lyrics) return metedata.common.lyrics[0]
        
        return false
    })
    ipcMain.on('copy-txt', (e, txt) => {
        clipboard.writeText(txt)
    })
    ipcMain.on('set-window-title', (e, title) => {
        win.setTitle(title)
    })
    ipcMain.handle('select-file', async (e) => {
        const filters = [
            {name: 'Fonts', extensions:['woff','woff2','ttf','otf','eot']}
        ]
        const { canceled, filePaths } = await dialog.showOpenDialog(win, {
            properties: ['openFile'],
            filters,
            title: '选择字体文件',
        })
        if (canceled || !filePaths?.length) return null
        return path.normalize(filePaths[0])
    })
    ipcMain.handle('start-unblock', async () => {
        startUnblockNeteaseMusic()
        return getUnblockStatus()
    })
    ipcMain.handle('stop-unblock', async () => {
        stopUnblockNeteaseMusic()
        return getUnblockStatus()
    })
    ipcMain.handle('restart-unblock', async () => {
        restartUnblockNeteaseMusic()
        return getUnblockStatus()
    })
    ipcMain.handle('get-unblock-status', async () => {
        return getUnblockStatus()
    })
    ipcMain.handle('get-unblock-diag', async () => {
        return getUnblockDiagnostic()
    })

    let updateDownloadCancelled = false
    ipcMain.handle('download-update', async (e, url) => {
        const { dialog: electronDialog } = require('electron')
        const result = await electronDialog.showSaveDialog(win, {
            defaultPath: url.split('/').pop(),
            filters: [{ name: 'Installers', extensions: ['exe'] }]
        })
        if (result.canceled) return 'cancelled'
        const savePath = result.filePath
        updateDownloadCancelled = false
        return new Promise((resolve, reject) => {
            const https = require('https')
            const followRedirect = (redirectUrl) => {
                https.get(redirectUrl, (res) => {
                    if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                        followRedirect(res.headers.location)
                        return
                    }
                    if (res.statusCode !== 200) {
                        resolve('failed')
                        return
                    }
                    const total = parseInt(res.headers['content-length'], 10) || 0
                    let downloaded = 0
                    const file = fs.createWriteStream(savePath)
                    res.on('data', (chunk) => {
                        if (updateDownloadCancelled) {
                            res.destroy()
                            file.close()
                            fs.unlinkSync(savePath)
                            resolve('cancelled')
                            return
                        }
                        downloaded += chunk.length
                        file.write(chunk)
                        if (total > 0) {
                            win.webContents.send('update-download-progress', Math.round(downloaded / total * 100))
                        }
                    })
                    res.on('end', () => {
                        if (!updateDownloadCancelled) {
                            file.end()
                            win.webContents.send('update-download-progress', 100)
                            resolve('success')
                        }
                    })
                    res.on('error', () => {
                        file.close()
                        try { fs.unlinkSync(savePath) } catch (e) {}
                        resolve('failed')
                    })
                }).on('error', () => resolve('failed'))
            }
            followRedirect(url)
        })
    })

    ipcMain.on('cancel-download-update', () => {
        updateDownloadCancelled = true
    })
}