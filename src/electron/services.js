const { serveNcmApi } = require('NeteaseCloudMusicApi')
const generateConfig = require('NeteaseCloudMusicApi/generateConfig')
const { spawn } = require('child_process')
const path = require('path')
const fs = require('fs')
const Store = require('electron-store')
const settingsStore = new Store({name: 'settings'})

let unblockProcess = null
// Module-level diagnostic, readable by getUnblockDiagnostic() with no store race
let unblockDiag = { running: false, error: 'not started yet', time: 0 }

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
    unblockDiag = { running: false, error: 'disabled in settings', time: Date.now() }
    return
  }
  const port = settings.unblock.port || '36531:36532'
  const sources = settings.unblock.sources || ['qq', 'kugou', 'kuwo', 'bilibili']

  try {
    const unblockRoot = path.dirname(require.resolve('unblockneteasemusic/package.json'))
    const mainScript = path.join(unblockRoot, 'precompiled', 'app.js')
    const certPath = path.join(unblockRoot, 'server.crt')
    const keyPath = path.join(unblockRoot, 'server.key')

    const scriptExists = fs.existsSync(mainScript)
    const certExists = fs.existsSync(certPath)
    const keyExists = fs.existsSync(keyPath)

    if (!scriptExists) {
      unblockDiag = {
        running: false,
        error: `Script not found: ${mainScript}`,
        unblockRoot,
        scriptExists,
        certExists,
        keyExists,
        time: Date.now(),
      }
      return
    }

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
      const msg = data.toString().trim()
      if (msg) unblockDiag.lastStdout = msg
    })
    unblockProcess.stderr.on('data', (data) => {
      const msg = data.toString().trim()
      if (msg) unblockDiag.lastStderr = msg
    })
    unblockProcess.on('error', (err) => {
      unblockDiag = {
        running: false,
        error: `spawn error: ${err.message}`,
        unblockRoot,
        scriptExists,
        certExists,
        keyExists,
        time: Date.now(),
      }
      unblockProcess = null
    })
    unblockProcess.on('exit', (code) => {
      if (code !== 0) {
        unblockDiag = {
          running: false,
          error: `exited with code ${code}`,
          lastStderr: unblockDiag.lastStderr,
          unblockRoot,
          time: Date.now(),
        }
      }
      unblockProcess = null
    })

    unblockDiag = {
      running: true,
      error: '',
      unblockRoot,
      scriptExists,
      certExists,
      keyExists,
      pid: unblockProcess.pid,
      time: Date.now(),
    }
  } catch (e) {
    unblockDiag = { running: false, error: `package error: ${e.message}`, time: Date.now() }
  }
}

//停止UnblockNeteaseMusic
module.exports.stopUnblockNeteaseMusic = function stopUnblockNeteaseMusic() {
  if (unblockProcess) {
    unblockProcess.kill()
    unblockProcess = null
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

//获取UnblockNeteaseMusic诊断信息 (module-level, no store dependency)
module.exports.getUnblockDiagnostic = function getUnblockDiagnostic() {
  return { ...unblockDiag, running: unblockProcess !== null }
}
