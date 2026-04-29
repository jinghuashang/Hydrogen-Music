const { serveNcmApi } = require('NeteaseCloudMusicApi')
const generateConfig = require('NeteaseCloudMusicApi/generateConfig')
const { spawn } = require('child_process')
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
    const unblockRoot = require('path').dirname(require.resolve('unblockneteasemusic/package.json'))
    const mainScript = require('path').join(unblockRoot, 'src', 'app.js')

    unblockProcess = spawn('node', [mainScript, '-p', port, '-e', '-', '-o', ...sources], {
      cwd: unblockRoot,
      stdio: 'pipe'
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