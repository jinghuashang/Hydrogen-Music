const logger = require('./src/electron/logger')
// 日志落盘需最先初始化：捕获后续模块加载阶段（UNM/NCM API）的输出
logger.init()
const startNeteaseMusicApi = require('./src/electron/services')
const IpcMainEvent = require('./src/electron/ipcMain')
const MusicDownload = require('./src/electron/download')
const LocalFiles = require('./src/electron/localmusic')
const InitTray = require('./src/electron/tray')
const registerShortcuts = require('./src/electron/shortcuts')

const { app, BrowserWindow, globalShortcut, shell, session } = require('electron')
const fs = require('fs')
const Winstate = require('electron-win-state').default
const path = require('path')
const Store = require('electron-store');
const settingsStore = new Store({name: 'settings'});

// 仅开发环境放宽 TLS 校验便于调试，打包后保持证书校验
if (!app.isPackaged) process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'

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

// 带重定向上限的 HTTPS GET（避免被无限重定向挂死）
function httpsGetText(urlStr, maxRedirects = 5) {
    const https = require('https')
    const { URL } = require('url')
    return new Promise((resolve, reject) => {
        const request = (target, redirects) => {
            if (redirects <= 0) {
                reject(new Error('重定向次数超限'))
                return
            }
            const parsed = new URL(target)
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
                if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                    res.resume()
                    request(res.headers.location, redirects - 1)
                    return
                }
                let data = ''
                res.on('data', chunk => data += chunk)
                res.on('end', () => resolve({ status: res.statusCode, body: data }))
                res.on('error', reject)
            })
            req.on('error', reject)
            req.setTimeout(15000, () => req.destroy(new Error('请求超时')))
        }
        request(urlStr, maxRedirects)
    })
}

// 依次尝试官方源获取最新 release
// 安全：安全元数据（下载地址/摘要）只信任 GitHub 官方 API，镜像仅用于加速资产下载
async function fetchLatestRelease() {
    const apiUrl = 'https://api.github.com/repos/jinghuashang/Hydrogen-Music/releases/latest'
    const candidates = [apiUrl]

    for (const url of candidates) {
        try {
            const { status, body } = await httpsGetText(url)
            if (status !== 200) continue
            const release = JSON.parse(body)
            if (release && release.tag_name) return { release, mirror: null }
        } catch (_) {}
    }
    console.warn('[update] 无法获取最新 release（api.github.com 不可达）')
    return null
}

function pickExeAsset(release) {
    return release.assets.find(a => a.name.includes('Setup') && a.name.endsWith('.exe'))
        || release.assets.find(a => a.name.endsWith('.exe'))
        || null
}

let myWindow = null

// 统一来源校验：所有 IPC（含 background/createWindow 中后注册的通道）只接受主窗口主框架的调用
const { ipcMain: ipcGuard } = require('electron')
const isTrustedIpc = (event) => {
    try {
        return !!myWindow
            && event.sender === myWindow.webContents
            && event.senderFrame === myWindow.webContents.mainFrame
    } catch {
        return false
    }
}
if (!ipcGuard._hmGuarded) {
    const originalHandle = ipcGuard.handle.bind(ipcGuard)
    const originalOn = ipcGuard.on.bind(ipcGuard)
    ipcGuard.handle = (channel, listener) => originalHandle(channel, (event, ...args) => {
        if (!isTrustedIpc(event)) throw new Error('ipc: untrusted sender')
        return listener(event, ...args)
    })
    ipcGuard.on = (channel, listener) => originalOn(channel, (event, ...args) => {
        if (!isTrustedIpc(event)) return
        listener(event, ...args)
    })
    ipcGuard._hmGuarded = true
}
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
    session.defaultSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
        // 仅主窗口主框架且仅本应用页面可申请媒体权限
        const allowed = ['media', 'display-capture', 'mediaKeySystem']
        const requestingUrl = String(details?.requestingUrl || webContents.getURL() || '')
        const isMainWindow = !!myWindow && webContents === myWindow.webContents
        const isAppOrigin =
            requestingUrl.startsWith('file://') ||
            requestingUrl.startsWith('http://localhost:5173/') ||
            requestingUrl.startsWith('http://127.0.0.1:5173/')
        callback(isMainWindow && allowed.includes(permission) && isAppOrigin && details?.isMainFrame !== false)
    })
    session.defaultSession.setPermissionCheckHandler((webContents, permission) => {
        // 同步权限检查默认拒绝，仅放行主窗口的媒体类权限
        return !!myWindow && webContents === myWindow.webContents && ['media', 'mediaKeySystem'].includes(permission)
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
            webSecurity: true,
        }
    })
    myWindow = win
    // 导航与弹窗守卫：外部页面不得进入特权窗口（preload 桥会随导航注入）
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    const navigateGuard = (event, target) => {
        const current = win.webContents.getURL()
        let ok = false
        try {
            const a = new URL(target)
            const b = new URL(current)
            ok = a.origin === b.origin && a.protocol === b.protocol && (a.protocol !== 'file:' || a.pathname === b.pathname)
        } catch {
            ok = false
        }
        if (!ok) {
            event.preventDefault()
            if (/^https?:/i.test(target)) shell.openExternal(target)
        }
    }
    win.webContents.on('will-navigate', navigateGuard)
    win.webContents.on('will-redirect', navigateGuard)
    win.webContents.on('will-frame-navigate', navigateGuard)
    win.once('ready-to-show', () => {
        win.show()
        if(process.resourcesPath.indexOf('\\node_modules\\') == -1) {
            checkForGithubUpdate(win)
        }
    })
    winstate.manage(win)
    win.on('close', async (event) => {
        event.preventDefault()
        const settings = settingsStore.get('settings')
        if(settings?.other?.quitApp == 'minimize') {
            win.hide()
        } else if(settings?.other?.quitApp == 'quit') {
            win.webContents.send('player-save')
            // 渲染进程无响应时兜底退出，避免窗口永远关不掉
            setTimeout(() => { if (!win.isDestroyed()) win.destroy() }, 3000)
        } else {
            // 配置缺失或未知值时直接退出
            win.destroy()
        }
    })
    // 手动检测更新
    const { ipcMain } = require('electron')
    ipcMain.handle('start-update-download', async () => startUpdateDownload(win))
    ipcMain.handle('install-update', async () => {
        if (!pendingUpdate || !pendingUpdate.savePath) return 'not-ready'
        // 安装前重新校验磁盘文件，避免下载完成到点击安装之间被替换（TOCTOU）
        try {
            const crypto = require('crypto')
            const hash = crypto.createHash('sha256')
            await new Promise((resolve, reject) => {
                fs.createReadStream(pendingUpdate.savePath)
                    .on('data', (chunk) => hash.update(chunk))
                    .on('error', reject)
                    .on('end', resolve)
            })
            const expect = String(pendingUpdate.digest || '').replace(/^sha256:/, '')
            if (!expect || hash.digest('hex') !== expect) {
                try { fs.unlinkSync(pendingUpdate.savePath) } catch (e) {}
                pendingUpdate = null
                return 'failed'
            }
        } catch {
            return 'failed'
        }
        const { shell } = require('electron')
        const err = await shell.openPath(pendingUpdate.savePath)
        if (err) {
            // 保留 savePath 以便重试时直接重新校验+安装（start-update-download 会返回 ready）
            return 'failed'
        }
        setTimeout(() => { app.exit(0) }, 800)
        return 'started'
    })
    ipcMain.on('cancel-auto-download-update', () => {
        if (autoUpdateCancelFn) autoUpdateCancelFn()
    })
    ipcMain.handle('manual-check-update', async () => {
        const currentVersion = require('./package.json').version
        const fetched = await fetchLatestRelease()
        if (!fetched) {
            return { hasUpdate: false, error: '网络连接失败，请手动查看更新' }
        }
        try {
            const { release } = fetched
            const latestVersion = release.tag_name.replace(/^v/, '')
            if (!isNewerVersion(latestVersion, currentVersion)) {
                console.log(`[update] manual check: current=${currentVersion} latest=${latestVersion} -> no update`)
                return { hasUpdate: false }
            }
            console.log(`[update] manual check: current=${currentVersion} latest=${latestVersion} -> update available`)
            const exeAsset = pickExeAsset(release)
            if (!exeAsset) return { hasUpdate: false, error: '未找到安装包' }
            if (!exeAsset.digest || !String(exeAsset.digest).startsWith('sha256:')) {
                console.warn('[update] 官方资产缺少 sha256 摘要，拒绝自动更新')
                return { hasUpdate: false, error: '更新包缺少校验摘要' }
            }
            // 主进程持有下载地址与摘要；渲染层只能触发下载/安装，不能指定 URL
            pendingUpdate = {
                version: latestVersion,
                remoteUrl: exeAsset.browser_download_url,
                digest: exeAsset.digest,
                savePath: null,
            }
            return {
                hasUpdate: true,
                version: latestVersion,
                digest: exeAsset.digest,
                isWindows: process.platform === 'win32',
                releaseBody: release.body || ''
            }
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
    logger.bindIpc()
    MusicDownload(win)
    LocalFiles(win, app)
    InitTray(win, app, path.resolve(__dirname, './src/assets/icon/icon.ico'))
    registerShortcuts(win)
}

async function checkForGithubUpdate(win) {
    const currentVersion = require('./package.json').version
    const settings = settingsStore.get('settings')
    const autoUpdate = settings?.other?.autoUpdate !== false

    // 如果禁用自动更新，直接返回
    if (!autoUpdate) {
        console.log('[update] Auto update disabled')
        return
    }

    const fetched = await fetchLatestRelease()
    if (!fetched) return
    try {
        const { release } = fetched
        const latestVersion = release.tag_name.replace(/^v/, '')
        if (!isNewerVersion(latestVersion, currentVersion)) {
            console.log(`[update] auto check: current=${currentVersion} latest=${latestVersion} -> no update`)
            return
        }
        console.log(`[update] auto check: current=${currentVersion} latest=${latestVersion} -> update available`)

        const exeAsset = pickExeAsset(release)
        if (!exeAsset) return
        if (!exeAsset.digest || !String(exeAsset.digest).startsWith('sha256:')) {
            console.warn('[update] 官方资产缺少 sha256 摘要，跳过自动更新')
            return
        }
        pendingUpdate = {
            version: latestVersion,
            remoteUrl: exeAsset.browser_download_url,
            digest: exeAsset.digest,
            savePath: null,
        }
        win.webContents.send('check-update', {
            version: latestVersion,
            digest: exeAsset.digest,
            isWindows: process.platform === 'win32',
            releaseBody: release.body || ''
        })
        // 下载由主进程发起（渲染层不接触 URL/摘要）
        if (process.platform === 'win32') startUpdateDownload(win)
    } catch (e) {}
}

// 自动下载更新（带重定向上限与 SHA-256 校验）；下载完成后由用户确认安装
let autoUpdateCancelFn = null
let pendingUpdate = null
let downloadInFlight = false

async function startUpdateDownload(win) {
    if (!pendingUpdate) return 'not-ready'
    if (pendingUpdate.savePath) return 'ready'
    if (downloadInFlight) return 'started'
    downloadInFlight = true
    // 先注册取消钩子，避免镜像探测期间无法取消
    let cancelled = false
    autoUpdateCancelFn = () => { cancelled = true }
    try {
        // 镜像仅用于加速资产下载；摘要来自官方 API，内容被篡改会在校验时失败
        const mirror = await getFastestMirror()
        let url = pendingUpdate.remoteUrl
        if (mirror) {
            let ok = false
            try {
                const u = new URL(String(mirror))
                ok = u.protocol === 'https:'
            } catch {}
            if (ok) url = String(mirror).replace(/\/?$/, '/') + pendingUpdate.remoteUrl
        }
        autoUpdateCancelFn = null
        if (cancelled) { downloadInFlight = false; return 'cancelled' }
        autoDownloadAndInstall(win, url, pendingUpdate.digest)
        return 'started'
    } catch (e) {
        autoUpdateCancelFn = null
        downloadInFlight = false
        win.webContents.send('auto-update-status', { status: 'failed', error: '下载启动失败' })
        return 'failed'
    }
}
function autoDownloadAndInstall(win, url, expectedDigest = '') {
    const https = require('https')
    const fs = require('fs')
    const os = require('os')
    const crypto = require('crypto')

    const tempDir = os.tmpdir()
    const fileName = (url.split('/').pop() || '').split('?')[0] || 'Hydrogen.Music.Setup.exe'
    const savePath = path.join(tempDir, fileName)

    let currentReq = null
    let cancelled = false

    const formatSize = (bytes) => {
        if (bytes < 1024) return bytes + ' B'
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
        return (bytes / 1024 / 1024).toFixed(1) + ' MB'
    }
    const fail = (error) => {
        if (cancelled) return
        autoUpdateCancelFn = null
        downloadInFlight = false
        win.setProgressBar(-1)
        win.webContents.send('auto-update-status', { status: 'failed', error })
    }

    win.webContents.send('auto-update-status', { status: 'downloading', progress: 0, totalSize: 0, downloadedSize: 0 })

    autoUpdateCancelFn = () => {
        cancelled = true
        autoUpdateCancelFn = null
        downloadInFlight = false
        try { if (currentReq) currentReq.destroy(new Error('cancelled')) } catch (e) {}
        try { fs.unlinkSync(savePath) } catch (e) {}
        win.setProgressBar(-1)
        win.webContents.send('auto-update-status', { status: 'failed', error: '已取消下载' })
    }

    const download = (target, redirects) => {
        if (redirects <= 0) {
            fail('重定向次数超限')
            return
        }
        const req = https.get(target, (res) => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                res.resume()
                // 仅跟随 https 重定向，避免 http 目标让 https.get 同步抛错
                if (!/^https:\/\//i.test(String(res.headers.location))) {
                    fail('下载重定向协议不受支持')
                    return
                }
                download(res.headers.location, redirects - 1)
                return
            }
            if (res.statusCode !== 200) {
                fail('下载失败')
                return
            }
            const total = parseInt(res.headers['content-length'], 10) || 0
            // 更新包大小上限，避免被超大盘/无限流写满磁盘
            const MAX_UPDATE_BYTES = 400 * 1024 * 1024
            if (total > MAX_UPDATE_BYTES) {
                res.resume()
                fail('安装包超出大小限制')
                return
            }
            let downloaded = 0
            const hash = crypto.createHash('sha256')
            const file = fs.createWriteStream(savePath)
            file.on('error', (err) => {
                try { fs.unlinkSync(savePath) } catch (e) {}
                fail('写入文件失败')
            })
            res.on('data', (chunk) => {
                downloaded += chunk.length
                hash.update(chunk)
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
            res.pipe(file)
            res.on('error', () => {
                file.close()
                try { fs.unlinkSync(savePath) } catch (e) {}
                fail('下载失败')
            })
            // 等待文件完全落盘后再校验/启动，避免执行不完整文件
            file.on('finish', () => {
                file.close(() => {
                    if (cancelled) return
                    autoUpdateCancelFn = null
                    win.setProgressBar(-1)
                    // GitHub 提供摘要时校验，不符立即删除且绝不执行
                    if (expectedDigest && expectedDigest.startsWith('sha256:')) {
                        const actual = hash.digest('hex')
                        if (actual !== expectedDigest.slice('sha256:'.length)) {
                            try { fs.unlinkSync(savePath) } catch (e) {}
                            fail('安装包校验失败，已取消安装')
                            return
                        }
                    }
                    // 校验通过后仅标记就绪，安装需用户显式确认（install-update）
                    downloadInFlight = false
                    pendingUpdate = { ...(pendingUpdate || {}), savePath }
                    win.webContents.send('auto-update-status', { status: 'ready', version: pendingUpdate.version || '' })
                })
            })
        })
        currentReq = req
        req.on('error', () => fail('网络连接失败'))
        req.setTimeout(60000, () => req.destroy(new Error('下载超时')))
    }
    download(url, 5)
}

function isNewerVersion(latest, current) {
    // 本项目版本约定：主线 0.2.2 → 小版本 0.2.2a → 0.2.2b …（字母后缀是增量修复，比无后缀新）
    // 同时兼容 0.2.2-b / 0.2.2-beta 这类连字符写法
    function parsePart(s) {
        // 兼容 0.2.2b（字母增量）与 0.2.2-b / 0.2.2-beta（连字符预发布）
        const m = String(s).match(/^(\d+)([-._]?)(.*)$/)
        if (!m) return [0, '', '']
        return [parseInt(m[1], 10), m[3] || '', m[2] || '']
    }
    const l = latest.split('.').map(parsePart)
    const c = current.split('.').map(parsePart)
    for (let i = 0; i < Math.max(l.length, c.length); i++) {
        const [aNum, aSuffix, aSep] = l[i] || [0, '', '']
        const [bNum, bSuffix, bSep] = c[i] || [0, '', '']
        if (aNum !== bNum) return aNum > bNum
        // 连字符后缀 = 预发布，低于同号正式版；字母后缀 = 增量，高于无后缀
        const aPre = aSep === '-'
        const bPre = bSep === '-'
        if (aPre !== bPre) return bPre
        if ((aSuffix || '') !== (bSuffix || '')) {
            // 字典序即符合约定：'' < 'a' < 'b' < …（0.2.2b > 0.2.2、0.2.2c > 0.2.2b）
            return (aSuffix || '') > (bSuffix || '')
        }
    }
    return false
}

process.env['ELECTRON_DISABLE_SECURITY_WARNINGS'] = 'true';