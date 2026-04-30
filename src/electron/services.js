const { serveNcmApi } = require('NeteaseCloudMusicApi')
const generateConfig = require('NeteaseCloudMusicApi/generateConfig')
const { spawn } = require('child_process')
const path = require('path')
const fs = require('fs')
const os = require('os')
const Store = require('electron-store')
const settingsStore = new Store({name: 'settings'})

let unblockProcess = null
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

    // Copy files out of ASAR to a real filesystem temp directory.
    // The child process runs as pure Node.js (ELECTRON_RUN_AS_NODE) and
    // cannot read from inside app.asar.
    const tmpDir = path.join(os.tmpdir(), 'hydrogen-unblock')
    fs.mkdirSync(tmpDir, { recursive: true })

    const tmpAppJs = path.join(tmpDir, 'app.js')
    const tmpCert = path.join(tmpDir, 'server.crt')
    const tmpKey = path.join(tmpDir, 'server.key')

    fs.writeFileSync(tmpAppJs, fs.readFileSync(path.join(unblockRoot, 'precompiled', 'app.js')))
    fs.writeFileSync(tmpCert, fs.readFileSync(path.join(unblockRoot, 'server.crt')))
    fs.writeFileSync(tmpKey, fs.readFileSync(path.join(unblockRoot, 'server.key')))

    // ELECTRON_RUN_AS_NODE=1 tells Electron to run as pure Node.js:
    // no GUI, no single-instance lock, just execute the script.
    unblockProcess = spawn(process.execPath, [tmpAppJs, '-p', port, '-e', '-', '-o', ...sources], {
      cwd: tmpDir,
      stdio: 'pipe',
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: '1',
        SIGN_CERT: tmpCert,
        SIGN_KEY: tmpKey,
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
        execPath: process.execPath,
        tmpDir,
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
          lastStdout: unblockDiag.lastStdout,
          time: Date.now(),
        }
      }
      unblockProcess = null
    })

    unblockDiag = {
      running: true,
      error: '',
      tmpDir,
      pid: unblockProcess.pid,
      time: Date.now(),
    }
  } catch (e) {
    unblockDiag = { running: false, error: `init error: ${e.message}`, time: Date.now() }
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

//获取UnblockNeteaseMusic诊断信息
module.exports.getUnblockDiagnostic = function getUnblockDiagnostic() {
  return { ...unblockDiag, running: unblockProcess !== null }
}
