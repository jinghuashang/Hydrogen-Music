process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'
const startNeteaseMusicApi = require('./src/electron/services')
const IpcMainEvent = require('./src/electron/ipcMain')
const MusicDownload = require('./src/electron/download')
const LocalFiles = require('./src/electron/localmusic')
const InitTray = require('./src/electron/tray')
const registerShortcuts = require('./src/electron/shortcuts')

const { app, BrowserWindow, globalShortcut, shell, session } = require('electron')
const Winstate = require('electron-win-state').default
const path = require('path')
const Store = require('electron-store');
const settingsStore = new Store({name: 'settings'});

// GitHub 镜像站列表
const GITHUB_MIRRORS = [
    { name: 'ghfast.top', url: 'https://ghfast.top/' },
    { name: 'gh.llkk.cc', url: 'https://gh.llkk.cc/' },
    { name: 'github.moeyy.xyz', url: 'https://github.moeyy.xyz/' },
    { name: 'gh-proxy.com', url: 'https://gh-proxy.com/' },
    { name: 'ghproxy.cc', url: 'https://ghproxy.cc/' },
]

// 测试镜像站延迟
async function testMirrorLatency(mirrorUrl) {
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
                url: mirrorUrl,
                latency: Date.now() - startTime,
                success: res.statusCode >= 200 && res.statusCode < 400
            })
        })
        req.on('error', () => resolve({ url: mirrorUrl, latency: Infinity, success: false }))
        req.on('timeout', () => {
            req.destroy()
            resolve({ url: mirrorUrl, latency: Infinity, success: false })
        })
        req.end()
    })
}

// 获取最快的镜像站
async function getFastestMirror() {
    const settings = settingsStore.get('settings')
    const autoMirror = settings?.other?.autoMirror !== false
    const customMirror = settings?.other?.githubMirror || ''
    
    // 如果用户禁用自动镜像选择，使用自定义镜像或官方源
    if (!autoMirror) {
        return customMirror || ''
    }
    
    // 并发测试所有镜像站
    const results = await Promise.all(GITHUB_MIRRORS.map(m => testMirrorLatency(m.url)))
    const successful = results.filter(r => r.success).sort((a, b) => a.latency - b.latency)
    
    if (successful.length > 0) {
        console.log(`[mirror] Fastest mirror: ${successful[0].url} (${successful[0].latency}ms)`)
        return successful[0].url
    }
    
    console.log('[mirror] No mirror available, using official source')
    return ''
}

let myWindow = null
//electron单例
const gotTheLock = app.requestSingleInstanceLock()

if (!gotTheLock) {
    app.quit()
} else {
app.on('second-instance', (event, commandLine, workingDirectory) => {
    if (myWindow) {
        if (myWindow.isMinimized()) myWindow.restore()
        if (!myWindow.isVisible()) myWindow.show()
        myWindow.focus()
    }
})

app.whenReady().then(() => {
    // 自动授权媒体设备权限（麦克风/摄像头/屏幕共享）
    session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
        const allowed = ['media', 'display-capture', 'mediaKeySystem']
        callback(allowed.includes(permission))
    })
    createWindow()
    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
})

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
})

app.on('will-quit', () => {
    // 注销所有快捷键
    globalShortcut.unregisterAll()
  })
}
const createWindow = () => {
    process.env.DIST = path.join(__dirname, './')
    const indexHtml = path.join(process.env.DIST, 'dist/index.html')
    const winstate = new Winstate({
        //自定义默认窗口大小
        defaultWidth: 1024,
        defaultHeight: 672,
    })
    const win = new BrowserWindow({
        minWidth: 1024,
        minHeight: 672,
        frame: false,
        title: "Hydrogen Music",
        icon: path.resolve(__dirname, './src/assets/icon/icon.ico'),
        backgroundColor: '#fff',
        //记录窗口大小
        ...winstate.winOptions,
        show: false,
        webPreferences: {
            //预加载脚本
            preload: path.resolve(__dirname, './src/electron/preload.js'),
            webSecurity: false,
        }
    })
    myWindow = win
    win.once('ready-to-show', () => {
        win.show()
        if(process.resourcesPath.indexOf('\\node_modules\\') == -1) {
            checkForGithubUpdate(win)
        }
    })
    winstate.manage(win)
    win.on('close', async (event) => {
        event.preventDefault()
        const settings = await settingsStore.get('settings')
        if(settings.other.quitApp == 'minimize') {
            win.hide()
        } else if(settings.other.quitApp == 'quit') {
            win.webContents.send('player-save')
        }
    })
    // 手动检测更新
    const { ipcMain } = require('electron')
    ipcMain.handle('auto-download-update', async (e, url) => {
        autoDownloadAndInstall(win, url)
        return 'started'
    })
    ipcMain.handle('manual-check-update', async () => {
        const https = require('https')
        const currentVersion = require('./package.json').version
        const settings = settingsStore.get('settings')
        const proxy = settings?.other?.updateProxy || ''

        function fetchRelease(urlStr) {
            return new Promise((resolve, reject) => {
                const { URL } = require('url')
                const parsed = new URL(urlStr)
                const options = {
                    hostname: parsed.hostname,
                    port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
                    path: parsed.pathname + parsed.search,
                    headers: {
                        'User-Agent': 'Hydrogen-Music',
                        'Accept': 'application/vnd.github.v3+json'
                    }
                }
                const req = https.get(options, (res) => {
                    let data = ''
                    res.on('data', chunk => data += chunk)
                    res.on('end', () => {
                        try { resolve(JSON.parse(data)) } catch (e) { reject(e) }
                    })
                })
                req.on('error', reject)
                req.end()
            })
        }

        const apiUrl = 'https://api.github.com/repos/jinghuashang/Hydrogen-Music/releases/latest'
        
        // 获取最快的镜像站
        const mirror = await getFastestMirror()
        
        let release
        // 优先使用镜像站
        if (mirror) {
            try {
                release = await fetchRelease(mirror + apiUrl)
            } catch (_) {}
        }
        
        // 镜像站失败，尝试官方源
        if (!release) {
            try {
                release = await fetchRelease(apiUrl)
            } catch (_) {}
        }
        
        // 官方源失败，尝试代理
        if (!release && proxy) {
            try { release = await fetchRelease(proxy + apiUrl) } catch (_) {}
        }
        
        if (!release) {
            return { hasUpdate: false, error: '网络连接失败，请手动查看更新' }
        }
        try {
            const latestVersion = release.tag_name.replace(/^v/, '')
            if (isNewerVersion(latestVersion, currentVersion)) {
                const exeAsset = release.assets.find(a => a.name.includes('Setup') && a.name.endsWith('.exe')) || release.assets.find(a => a.name.endsWith('.exe'))
                let downloadUrl = exeAsset ? exeAsset.browser_download_url : null
                // 使用镜像站加速下载链接
                if (downloadUrl && mirror) {
                    downloadUrl = mirror + downloadUrl
                } else if (downloadUrl && proxy) {
                    downloadUrl = proxy + downloadUrl
                }
                return {
                    hasUpdate: true,
                    version: latestVersion,
                    downloadUrl,
                    isWindows: process.platform === 'win32',
                    releaseBody: release.body || ''
                }
            }
            return { hasUpdate: false }
        } catch (e) {
            return { hasUpdate: false, error: '检查更新失败' }
        }
    })
    // 桌面音频源捕获（用于听歌识曲-系统音频模式）
    const { ipcMain: mainIpc, desktopCapturer } = require('electron')
    mainIpc.handle('get-desktop-sources', async () => {
        const sources = await desktopCapturer.getSources({ types: ['screen'] })
        return sources.map(s => ({ id: s.id, name: s.name }))
    })

    //api初始化 - 等待服务器就绪后再加载前端
    startNeteaseMusicApi().then(() => {
        console.log('[background] NCM API server ready')
        if(process.resourcesPath.indexOf('\\node_modules\\') != -1)
            win.loadURL('http://localhost:5173/')
        else
            win.loadFile(indexHtml)
    }).catch(err => {
        console.error('[background] NCM API server failed to start:', err)
        // 即使失败也加载前端，让用户看到界面
        if(process.resourcesPath.indexOf('\\node_modules\\') != -1)
            win.loadURL('http://localhost:5173/')
        else
            win.loadFile(indexHtml)
    })
    //ipcMain初始化
    IpcMainEvent(win, app)
    MusicDownload(win)
    LocalFiles(win, app)
    InitTray(win, app, path.resolve(__dirname, './src/assets/icon/icon.ico'))
    registerShortcuts(win)
}

async function checkForGithubUpdate(win) {
    const https = require('https')
    const { URL } = require('url')
    const currentVersion = require('./package.json').version
    const settings = settingsStore.get('settings')
    const autoUpdate = settings?.other?.autoUpdate !== false
    
    // 如果禁用自动更新，直接返回
    if (!autoUpdate) {
        console.log('[update] Auto update disabled')
        return
    }
    
    const proxy = settings?.other?.updateProxy || ''

    function fetchRelease(urlStr) {
        return new Promise((resolve, reject) => {
            const parsed = new URL(urlStr)
            const options = {
                hostname: parsed.hostname,
                port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
                path: parsed.pathname + parsed.search,
                headers: {
                    'User-Agent': 'Hydrogen-Music',
                    'Accept': 'application/vnd.github.v3+json'
                }
            }
            const req = https.get(options, (res) => {
                let data = ''
                res.on('data', chunk => data += chunk)
                res.on('end', () => {
                    try { resolve(JSON.parse(data)) } catch (e) { reject(e) }
                })
            })
            req.on('error', reject)
            req.end()
        })
    }

    const apiUrl = 'https://api.github.com/repos/jinghuashang/Hydrogen-Music/releases/latest'
    
    // 获取最快的镜像站
    const mirror = await getFastestMirror()
    
    ;(async () => {
        let release
        try {
            // 优先使用镜像站
            if (mirror) {
                release = await fetchRelease(mirror + apiUrl)
            }
        } catch (_) {}
        
        // 镜像站失败，尝试官方源
        if (!release) {
            try {
                release = await fetchRelease(apiUrl)
            } catch (_) {}
        }
        
        // 官方源失败，尝试代理
        if (!release && proxy) {
            try { release = await fetchRelease(proxy + apiUrl) } catch (_) {}
        }
        
        if (!release) return
        try {
            const latestVersion = release.tag_name.replace(/^v/, '')
            if (isNewerVersion(latestVersion, currentVersion)) {
                const exeAsset = release.assets.find(a => a.name.includes('Setup') && a.name.endsWith('.exe')) || release.assets.find(a => a.name.endsWith('.exe'))
                let downloadUrl = exeAsset ? exeAsset.browser_download_url : null
                // 使用镜像站加速下载链接
                if (downloadUrl && mirror) {
                    downloadUrl = mirror + downloadUrl
                } else if (downloadUrl && proxy) {
                    downloadUrl = proxy + downloadUrl
                }
                win.webContents.send('check-update', {
                    version: latestVersion,
                    downloadUrl,
                    isWindows: process.platform === 'win32',
                    releaseBody: release.body || ''
                })
            }
        } catch (e) {}
    })()
}

// 自动下载更新并安装
function autoDownloadAndInstall(win, url) {
    const https = require('https')
    const fs = require('fs')
    const os = require('os')

    const tempDir = os.tmpdir()
    const fileName = url.split('/').pop() || 'Hydrogen.Music.Setup.exe'
    const savePath = path.join(tempDir, fileName)

    const formatSize = (bytes) => {
        if (bytes < 1024) return bytes + ' B'
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
        return (bytes / 1024 / 1024).toFixed(1) + ' MB'
    }

    win.webContents.send('auto-update-status', { status: 'downloading', progress: 0, totalSize: 0, downloadedSize: 0 })

    const followRedirect = (redirectUrl) => {
        https.get(redirectUrl, (res) => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                followRedirect(res.headers.location)
                return
            }
            if (res.statusCode !== 200) {
                win.webContents.send('auto-update-status', { status: 'failed', error: '下载失败' })
                return
            }
            const total = parseInt(res.headers['content-length'], 10) || 0
            let downloaded = 0
            const file = fs.createWriteStream(savePath)
            res.on('data', (chunk) => {
                downloaded += chunk.length
                file.write(chunk)
                if (total > 0) {
                    const progress = Math.round(downloaded / total * 100)
                    win.webContents.send('auto-update-status', {
                        status: 'downloading',
                        progress,
                        totalSize: formatSize(total),
                        downloadedSize: formatSize(downloaded),
                    })
                    win.setProgressBar(progress / 100)
                }
            })
            res.on('end', () => {
                file.end()
                win.setProgressBar(-1)
                win.webContents.send('auto-update-status', { status: 'installing' })
                // 启动安装程序并退出应用
                const { shell } = require('electron')
                shell.openPath(savePath)
                setTimeout(() => { app.exit(0) }, 500)
            })
            res.on('error', () => {
                file.close()
                try { fs.unlinkSync(savePath) } catch (e) {}
                win.setProgressBar(-1)
                win.webContents.send('auto-update-status', { status: 'failed', error: '下载失败' })
            })
        }).on('error', () => {
            win.webContents.send('auto-update-status', { status: 'failed', error: '网络连接失败' })
        })
    }
    followRedirect(url)
}

function isNewerVersion(latest, current) {
    function parsePart(s) {
        const m = String(s).match(/^(\d+)(.*)$/)
        return m ? [parseInt(m[1], 10), m[2] || ''] : [0, '']
    }
    const l = latest.split('.').map(parsePart)
    const c = current.split('.').map(parsePart)
    for (let i = 0; i < Math.max(l.length, c.length); i++) {
        const [aNum, aSuffix] = l[i] || [0, '']
        const [bNum, bSuffix] = c[i] || [0, '']
        if (aNum !== bNum) return aNum > bNum
        if (aSuffix !== bSuffix) return aSuffix > bSuffix
    }
    return false
}

process.env['ELECTRON_DISABLE_SECURITY_WARNINGS'] = 'true';