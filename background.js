process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'
const startNeteaseMusicApi = require('./src/electron/services')
const { startUnblockNeteaseMusic } = require('./src/electron/services')
const IpcMainEvent = require('./src/electron/ipcMain')
const MusicDownload = require('./src/electron/download')
const LocalFiles = require('./src/electron/localmusic')
const InitTray = require('./src/electron/tray')
const registerShortcuts = require('./src/electron/shortcuts')

const { app, BrowserWindow, globalShortcut, shell } = require('electron')
const Winstate = require('electron-win-state').default
const path = require('path')
const Store = require('electron-store');
const settingsStore = new Store({name: 'settings'});

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
    if(process.resourcesPath.indexOf('\\node_modules\\') != -1)
        win.loadURL('http://localhost:5173/')
    else
        win.loadFile(indexHtml)
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
        return new Promise((resolve) => {
            const https = require('https')
            const currentVersion = require('./package.json').version
            const options = {
                hostname: 'api.github.com',
                path: '/repos/jinghuashang/Hydrogen-Music/releases/latest',
                headers: {
                    'User-Agent': 'Hydrogen-Music',
                    'Accept': 'application/vnd.github.v3+json'
                }
            }
            const req = https.get(options, (res) => {
                let data = ''
                res.on('data', chunk => data += chunk)
                res.on('end', () => {
                    try {
                        const release = JSON.parse(data)
                        const latestVersion = release.tag_name.replace(/^v/, '')
                        if (isNewerVersion(latestVersion, currentVersion)) {
                            const exeAsset = release.assets.find(a => a.name.endsWith('.exe'))
                            let downloadUrl = exeAsset ? exeAsset.browser_download_url : null
                            const settings = settingsStore.get('settings')
                            if (downloadUrl && settings?.other?.updateProxy) {
                                downloadUrl = settings.other.updateProxy + downloadUrl
                            }
                            resolve({
                                hasUpdate: true,
                                version: latestVersion,
                                downloadUrl,
                                isWindows: process.platform === 'win32',
                                releaseBody: release.body || ''
                            })
                        } else {
                            resolve({ hasUpdate: false })
                        }
                    } catch (e) {
                        resolve({ hasUpdate: false, error: '检查更新失败' })
                    }
                })
            })
            req.on('error', () => {
                resolve({ hasUpdate: false, error: '网络连接失败' })
            })
            req.end()
        })
    })
    //api初始化
    startNeteaseMusicApi()
    //启动UnblockNeteaseMusic
    startUnblockNeteaseMusic()
    //ipcMain初始化
    IpcMainEvent(win, app)
    MusicDownload(win)
    LocalFiles(win, app)
    InitTray(win, app, path.resolve(__dirname, './src/assets/icon/icon.ico'))
    registerShortcuts(win)
}

function checkForGithubUpdate(win) {
    const https = require('https')
    const currentVersion = require('./package.json').version
    const options = {
        hostname: 'api.github.com',
        path: '/repos/jinghuashang/Hydrogen-Music/releases/latest',
        headers: {
            'User-Agent': 'Hydrogen-Music',
            'Accept': 'application/vnd.github.v3+json'
        }
    }
    const req = https.get(options, (res) => {
        let data = ''
        res.on('data', chunk => data += chunk)
        res.on('end', () => {
            try {
                const release = JSON.parse(data)
                const latestVersion = release.tag_name.replace(/^v/, '')
                if (isNewerVersion(latestVersion, currentVersion)) {
                    const exeAsset = release.assets.find(a => a.name.endsWith('.exe'))
                    let downloadUrl = exeAsset ? exeAsset.browser_download_url : null
                    const settings = settingsStore.get('settings')
                    if (downloadUrl && settings?.other?.updateProxy) {
                        downloadUrl = settings.other.updateProxy + downloadUrl
                    }
                    win.webContents.send('check-update', {
                        version: latestVersion,
                        downloadUrl,
                        isWindows: process.platform === 'win32',
                        releaseBody: release.body || ''
                    })
                }
            } catch (e) {}
        })
    })
    req.on('error', () => {})
    req.end()
}

// 自动下载更新并安装
function autoDownloadAndInstall(win, url) {
    const https = require('https')
    const fs = require('fs')
    const { exec } = require('child_process')
    const os = require('os')

    const tempDir = os.tmpdir()
    const fileName = url.split('/').pop() || 'Hydrogen.Music.Setup.exe'
    const savePath = path.join(tempDir, fileName)

    win.webContents.send('auto-update-status', { status: 'downloading', progress: 0 })

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
                    win.webContents.send('auto-update-status', { status: 'downloading', progress })
                    win.setProgressBar(progress / 100)
                }
            })
            res.on('end', () => {
                file.end()
                win.setProgressBar(-1)
                win.webContents.send('auto-update-status', { status: 'installing' })
                // 运行安装程序
                exec(`"${savePath}"`, (error) => {
                    if (error) {
                        win.webContents.send('auto-update-status', { status: 'failed', error: '安装失败' })
                    }
                })
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