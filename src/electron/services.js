const { serveNcmApi } = require('NeteaseCloudMusicApi')
const generateConfig = require('NeteaseCloudMusicApi/generateConfig')
const { spawn } = require('child_process')
const path = require('path')
const Store = require('electron-store')
const settingsStore = new Store({name: 'settings'})

let unblockProcess = null

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
  if (!settings || !settings.unblock || !settings.unblock.enabled) return
  const port = settings.unblock.port || '36531:36532'
  const sources = settings.unblock.sources || ['qq', 'kugou', 'kuwo', 'bilibili']

  try {
    const unblockRoot = path.dirname(require.resolve('unblockneteasemusic/package.json'))
    // Use the precompiled (webpack-bundled) app.js which is self-contained with all dependencies
    const mainScript = path.join(unblockRoot, 'precompiled', 'app.js')

    unblockProcess = spawn(process.execPath, [mainScript, '-p', port, '-e', '-', '-o', ...sources], {
      cwd: unblockRoot,
      stdio: 'pipe',
      env: {
        ...process.env,
        SIGN_CERT: path.join(unblockRoot, 'server.crt'),
        SIGN_KEY: path.join(unblockRoot, 'server.key'),
      },
    })
    unblockProcess.stdout.on('data', (data) => {
      console.log(`[UnblockNeteaseMusic] ${data}`)
    })
    unblockProcess.stderr.on('data', (data) => {
      console.log(`[UnblockNeteaseMusic] ${data}`)
    })
    unblockProcess.on('error', (err) => {
      console.error('[UnblockNeteaseMusic] Failed to start:', err.message)
      unblockProcess = null
    })
    unblockProcess.on('exit', (code) => {
      console.log(`[UnblockNeteaseMusic] Exited with code ${code}`)
      unblockProcess = null
    })
    console.log(`[UnblockNeteaseMusic] Started on port ${port}`)
  } catch (e) {
    console.error('[UnblockNeteaseMusic] Package not found:', e.message)
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