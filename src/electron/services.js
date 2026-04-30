const { serveNcmApi } = require('NeteaseCloudMusicApi')
const generateConfig = require('NeteaseCloudMusicApi/generateConfig')
const { spawn } = require('child_process')
const path = require('path')
const fs = require('fs')
const Store = require('electron-store')
const settingsStore = new Store({name: 'settings'})

let unblockProcess = null

function saveUnblockDiag(running, error) {
  try {
    const diagStore = new Store({name: 'unblock-diag'})
    diagStore.set('diag', { running, error, time: Date.now() })
  } catch {}
}

//启动网易云音乐API
module.exports = async function startNeteaseMusicApi() {
  await generateConfig()
  await serveNcmApi({
    checkVersion: true,
    port: 36530,
  });
}

//启动UnblockNeteaseMusic
module.exports.startUnblockNeteaseMusic = function startUnblockNeteaseMusic() {
  const settings = settingsStore.get('settings')
  if (!settings || !settings.unblock || !settings.unblock.enabled) {
    console.log('[UnblockNeteaseMusic] Not enabled in settings, skipping')
    return
  }
  const port = settings.unblock.port || '36531:36532'
  const sources = settings.unblock.sources || ['qq', 'kugou', 'kuwo', 'bilibili']

  try {
    const unblockRoot = path.dirname(require.resolve('unblockneteasemusic/package.json'))
    const mainScript = path.join(unblockRoot, 'precompiled', 'app.js')

    console.log('[UnblockNeteaseMusic] Package root:', unblockRoot)
    console.log('[UnblockNeteaseMusic] Main script:', mainScript)
    console.log('[UnblockNeteaseMusic] Script exists:', fs.existsSync(mainScript))

    if (!fs.existsSync(mainScript)) {
      saveUnblockDiag(false, `Script not found: ${mainScript}`)
      console.error('[UnblockNeteaseMusic] Script not found:', mainScript)
      return
    }

    const certPath = path.join(unblockRoot, 'server.crt')
    const keyPath = path.join(unblockRoot, 'server.key')
    console.log('[UnblockNeteaseMusic] Cert exists:', fs.existsSync(certPath))
    console.log('[UnblockNeteaseMusic] Key exists:', fs.existsSync(keyPath))

    // Use Electron's bundled Node.js with ELECTRON_RUN_AS_NODE to bypass single-instance lock
    unblockProcess = spawn(process.execPath, [mainScript, '-p', port, '-e', '-', '-o', ...sources], {
      cwd: unblockRoot,
      stdio: 'pipe',
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: '1',
        SIGN_CERT: certPath,
        SIGN_KEY: keyPath,
      },
    })
    unblockProcess.stdout.on('data', (data) => {
      console.log(`[UnblockNeteaseMusic] ${data}`)
    })
    unblockProcess.stderr.on('data', (data) => {
      console.log(`[UnblockNeteaseMusic] ${data}`)
    })
    unblockProcess.on('error', (err) => {
      saveUnblockDiag(false, `spawn error: ${err.message}`)
      console.error('[UnblockNeteaseMusic] Failed to start:', err.message)
      unblockProcess = null
    })
    unblockProcess.on('exit', (code) => {
      saveUnblockDiag(false, `exited with code ${code}`)
      console.log(`[UnblockNeteaseMusic] Exited with code ${code}`)
      unblockProcess = null
    })
    saveUnblockDiag(true, '')
    console.log(`[UnblockNeteaseMusic] Started on port ${port}`)
  } catch (e) {
    saveUnblockDiag(false, `package error: ${e.message}`)
    console.error('[UnblockNeteaseMusic] Package error:', e.message)
  }
}

//停止UnblockNeteaseMusic
module.exports.stopUnblockNeteaseMusic = function stopUnblockNeteaseMusic() {
  if (unblockProcess) {
    unblockProcess.kill()
    unblockProcess = null
    console.log('[UnblockNeteaseMusic] Stopped')
  }
}

//重启UnblockNeteaseMusic
module.exports.restartUnblockNeteaseMusic = function restartUnblockNeteaseMusic() {
  module.exports.stopUnblockNeteaseMusic()
  module.exports.startUnblockNeteaseMusic()
}

//获取UnblockNeteaseMusic状态
module.exports.getUnblockStatus = function getUnblockStatus() {
  return unblockProcess !== null
}

//获取UnblockNeteaseMusic诊断信息
module.exports.getUnblockDiagnostic = function getUnblockDiagnostic() {
  try {
    const diagStore = new Store({name: 'unblock-diag'})
    return diagStore.get('diag') || { running: false, error: 'no data' }
  } catch {
    return { running: false, error: 'store error' }
  }
}
