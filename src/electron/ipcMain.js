const { ipcMain, shell, dialog, globalShortcut, Menu, clipboard } =  require('electron')
const axios = require('axios')
const fs = require('fs')
const path = require('path')
const { parseFile } = require('music-metadata')
const registerShortcuts = require('./shortcuts')
const Store = require('electron-store')
const CancelToken = axios.CancelToken
let cancel = null

// 主进程顶层预加载 UNM 模块，避免打包后在 handler 内动态 require 失败
let unmMatch = null
try {
    unmMatch = require('@unblockneteasemusic/server')
    console.log('[unblock] UNM module preloaded successfully')
} catch (e) {
    console.error('[unblock] Failed to preload UNM module:', e.message)
}

// UNM 匹配统一使用最高码率选择；该值恒定，进程启动时设置一次，避免并发请求互相覆盖环境变量
process.env.SELECT_MAX_BR = 'true'

// 验证 URL 是否为完整歌曲（非试听），通过 Content-Length 判断
function verifyFullSong(url, minSize = 500 * 1024) {
    return new Promise((resolve) => {
        try {
            const mod = url.startsWith('https') ? require('https') : require('http')
            const req = mod.get(url, { timeout: 5000 }, (res) => {
                if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
                    verifyFullSong(res.headers.location, minSize).then(resolve)
                    return
                }
                const len = parseInt(res.headers['content-length'] || '0', 10)
                res.resume()
                resolve(len >= minSize)
            })
            req.on('error', () => resolve(true))
            req.on('timeout', () => { req.destroy(); resolve(true) })
        } catch {
            resolve(true)
        }
    })
}

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
        const settings = settingsStore.get('settings')
        if(settings?.other?.quitApp == 'quit') {
            win.close()
        } else {
            // minimize 或配置缺失时隐藏窗口（与默认配置一致）
            win.hide()
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
        try {
            settingsStore.set('settings', JSON.parse(settings))
            registerShortcuts(win)
        } catch (err) {
            console.error('[settings] 保存设置失败:', err)
        }
    })
    ipcMain.handle('get-settings', async () => {
        const settings =  await settingsStore.get('settings')
        if(settings) {
            if (!settings.local) settings.local = {}
            if (!settings.other) settings.other = {}
            if (!Object.prototype.hasOwnProperty.call(settings.local, 'syncProfileToNas')) settings.local.syncProfileToNas = false
            if (!Object.prototype.hasOwnProperty.call(settings.local, 'downloadCover')) settings.local.downloadCover = false
            if (!Object.prototype.hasOwnProperty.call(settings.local, 'downloadInfo')) settings.local.downloadInfo = false
            if (!Object.prototype.hasOwnProperty.call(settings.local, 'downloadLyric')) settings.local.downloadLyric = false
            if (!Object.prototype.hasOwnProperty.call(settings.other, 'autoUpdate')) settings.other.autoUpdate = true
            if (!Object.prototype.hasOwnProperty.call(settings.other, 'autoMirror')) settings.other.autoMirror = true
            if (!Object.prototype.hasOwnProperty.call(settings.other, 'githubMirror')) settings.other.githubMirror = ''
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
                    downloadCover: false,
                    downloadInfo: false,
                    downloadLyric: false,
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
                    updateProxy: '',
                    externalUnblockUrl: '',
                    autoUpdate: true,
                    autoMirror: true,
                    githubMirror: '',
                },
                unblock: {
                    enabled: true
                },
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
        try {
            lastPlaylistStore.set('playlist', JSON.parse(playlist))
        } catch (err) {
            console.error('[playlist] 保存播放列表失败:', err)
        }
    })
    ipcMain.on('exit-app', (e, playlist) => {
        try {
            lastPlaylistStore.set('playlist', JSON.parse(playlist))
        } catch (err) {
            console.error('[playlist] 保存播放列表失败:', err)
        }
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
            }).catch(err => {
                console.error('[video] saveMusicVideo error:', err)
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
    let activeVideoDownload = null
    // 取消视频下载：监听器只注册一次，避免每次下载累积监听器并引用旧 writer
    ipcMain.on('cancel-download-music-video', () => {
        if (!activeVideoDownload) return
        activeVideoDownload.cancelled = true
        const { writer, cancel, savePath } = activeVideoDownload
        writer.close()
        writer.once('close', () => {
            cancel()
            win.setProgressBar(-1)
            try { fs.unlinkSync(savePath) } catch (e) {}
        })
    })
    ipcMain.handle('get-bili-video', async (e, request) => {
        const settings = await settingsStore.get('settings')
        if(!settings?.local?.videoFolder) return 'noSavePath'
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
                    if(activeVideoDownload?.cancelled) win.setProgressBar(-1)
                    else win.setProgressBar(progress / 100)
                },
                cancelToken: new CancelToken(function executor(c) {
                    cancel = c
                })
            })
            const writer = fs.createWriteStream(videoAbsPath)
            const downloadState = { cancelled: false, writer, cancel, savePath: videoAbsPath }
            activeVideoDownload = downloadState
            result.data.pipe(writer)
            return new Promise((resolve, reject) => {
                writer.on("finish", () => {
                    win.setProgressBar(-1)
                    if(downloadState.cancelled) {
                        resolve('cancel')
                        return
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
                writer.on("close", () => {
                    // 取消下载走 close 而非 finish，这里兜底 resolve，避免渲染进程永远等待
                    if(downloadState.cancelled) resolve('cancel')
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
        const folderPath = settings?.local?.videoFolder
        if(!folderPath) return 'noSavePath'
        const musicVideo = (await musicVideoStore.get('musicVideo')) || []
        try {
            const files = fs.readdirSync(folderPath)
            files.forEach(filename => {
                const filePath = path.join(folderPath, filename)
                if(!musicVideo.some(video => video.path && path.normalize(video.path) === path.normalize(filePath))) {
                    // 单个文件清理失败不中断整个流程
                    try { fs.unlinkSync(filePath) } catch (err) {
                        console.warn('[video] 清理失败:', filePath, err.message)
                    }
                }
            })
        } catch (err) {
            console.error('[video] clear-unused-video error:', err)
        }
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
        let metedata
        try {
            metedata = await parseFile(abs)
        } catch {
            return false
        }
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

    let updateDownloadCancelled = false
    ipcMain.handle('download-update', async (e, url) => {
        const { dialog: electronDialog } = require('electron')
        const result = await electronDialog.showSaveDialog(win, {
            defaultPath: (url.split('/').pop() || '').split('?')[0],
            filters: [{ name: 'Installers', extensions: ['exe'] }]
        })
        if (result.canceled) return 'cancelled'
        const savePath = result.filePath
        updateDownloadCancelled = false
        return new Promise((resolve) => {
            const https = require('https')
            let file = null
            let settled = false
            const cleanup = (code) => {
                if (settled) return
                settled = true
                if (file) {
                    try { file.close() } catch (err) {}
                    try { fs.unlinkSync(savePath) } catch (err) {}
                }
                resolve(code)
            }
            const download = (target, redirects) => {
                if (redirects <= 0) {
                    cleanup('failed')
                    return
                }
                const req = https.get(target, (res) => {
                    if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                        res.resume()
                        download(res.headers.location, redirects - 1)
                        return
                    }
                    if (res.statusCode !== 200) {
                        cleanup('failed')
                        return
                    }
                    const total = parseInt(res.headers['content-length'], 10) || 0
                    let downloaded = 0
                    file = fs.createWriteStream(savePath)
                    res.on('data', (chunk) => {
                        if (updateDownloadCancelled) {
                            res.destroy()
                            cleanup('cancelled')
                            return
                        }
                        downloaded += chunk.length
                        if (total > 0) {
                            win.webContents.send('update-download-progress', Math.round(downloaded / total * 100))
                        }
                    })
                    res.pipe(file)
                    // 等待文件完全落盘再返回成功
                    file.on('finish', () => {
                        if (settled) return
                        if (updateDownloadCancelled) {
                            cleanup('cancelled')
                            return
                        }
                        settled = true
                        file.close(() => {
                            win.webContents.send('update-download-progress', 100)
                            resolve('success')
                        })
                    })
                    res.on('error', () => cleanup('failed'))
                })
                req.on('error', () => cleanup('failed'))
                req.setTimeout(60000, () => req.destroy(new Error('下载超时')))
            }
            download(url, 5)
        })
    })

    ipcMain.on('cancel-download-update', () => {
        updateDownloadCancelled = true
    })

    // 解锁灰色歌曲：主进程 UNM 全源匹配（SELECT_MAX_BR 等所有源，选码率最高）
    ipcMain.handle('unblock-song-url', async (_e, { id, name, artist, album, duration }) => {
        if (!id || !name) return null
        try {
            const match = unmMatch || require('@unblockneteasemusic/server')
            if (!match) {
                console.error('[unblock] UNM module not available')
                return null
            }
            const songData = {
                id: Number(id),
                name,
                artists: (artist || name).split('/').map((n, i) => ({ id: i, name: n.trim() })),
                album: { id: 0, name: album || '' },
                duration: Number(duration) || 0,
            }
            const sources = ['bodian', 'kuwo', 'kugou', 'qq', 'migu', 'bilibili']
            console.log(`[unblock] IPC matching: ${name} (id=${id})`)
            const resp = await match(Number(id), sources, songData)

            if (resp && resp.url) {
                const isFull = await verifyFullSong(resp.url)
                if (!isFull) {
                    console.warn(`[unblock] IPC matched (trial): ${resp.source}`)
                } else {
                    console.log(`[unblock] IPC matched (full): ${resp.source}`)
                }
                return resp.url
            }
        } catch (e) {
            console.error('[unblock] IPC match error:', e.message)
        }
        return null
    })

    // GitHub 镜像站列表
    const GITHUB_MIRRORS = [
        { name: 'ghfast.top', url: 'https://ghfast.top/' },
        { name: 'gh.llkk.cc', url: 'https://gh.llkk.cc/' },
        { name: 'github.moeyy.xyz', url: 'https://github.moeyy.xyz/' },
        { name: 'gh-proxy.com', url: 'https://gh-proxy.com/' },
        { name: 'ghproxy.cc', url: 'https://ghproxy.cc/' },
    ]

    // 获取镜像站列表
    ipcMain.handle('get-github-mirrors', async () => {
        return GITHUB_MIRRORS
    })

    // 测试镜像站延迟
    ipcMain.handle('test-mirror-latency', async (_e, mirrorUrl) => {
        const https = require('https')
        const { URL } = require('url')
        const testUrl = mirrorUrl + 'https://api.github.com/repos/jinghuashang/Hydrogen-Music/releases/latest'
        const parsed = new URL(testUrl)
        
        return new Promise((resolve) => {
            const startTime = Date.now()
            const options = {
                hostname: parsed.hostname,
                port: parsed.port || 443,
                path: parsed.pathname + parsed.search,
                method: 'HEAD',
                timeout: 3000,
                headers: {
                    'User-Agent': 'Hydrogen-Music',
                }
            }
            const req = https.request(options, (res) => {
                res.resume()
                resolve({
                    latency: Date.now() - startTime,
                    success: res.statusCode >= 200 && res.statusCode < 400
                })
            })
            req.on('error', () => resolve({ latency: Infinity, success: false }))
            req.on('timeout', () => {
                req.destroy()
                resolve({ latency: Infinity, success: false })
            })
            req.end()
        })
    })
}