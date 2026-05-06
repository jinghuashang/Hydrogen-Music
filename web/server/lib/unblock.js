const { spawn } = require('child_process')
const path = require('path')
const fs = require('fs')
const os = require('os')

let unblockProcess = null
let unblockDiag = { running: false, error: 'not started yet', time: 0 }

function startUnblockNeteaseMusic(settingsStore) {
  const settings = settingsStore.get('settings')
  if (settings && settings.unblock && settings.unblock.enabled === false) {
    unblockDiag = { running: false, error: 'disabled in settings', time: Date.now() }
    return
  }
  const unblockCfg = (settings && settings.unblock) || {}
  const port = unblockCfg.port || '36531:36532'
  const sources = unblockCfg.sources || ['qq', 'kugou', 'kuwo', 'bilibili']

  try {
    const unblockRoot = path.dirname(require.resolve('unblockneteasemusic/package.json'))
    const tmpDir = path.join(os.tmpdir(), 'hydrogen-unblock-web')
    fs.mkdirSync(tmpDir, { recursive: true })

    const tmpAppJs = path.join(tmpDir, 'app.js')
    const tmpCert = path.join(tmpDir, 'server.crt')
    const tmpKey = path.join(tmpDir, 'server.key')

    fs.writeFileSync(tmpAppJs, fs.readFileSync(path.join(unblockRoot, 'precompiled', 'app.js')))
    fs.writeFileSync(tmpCert, fs.readFileSync(path.join(unblockRoot, 'server.crt')))
    fs.writeFileSync(tmpKey, fs.readFileSync(path.join(unblockRoot, 'server.key')))

    unblockProcess = spawn(process.execPath, [tmpAppJs, '-p', port, '-e', '-', '-o', ...sources], {
      cwd: tmpDir,
      stdio: 'pipe',
      env: {
        ...process.env,
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

function stopUnblockNeteaseMusic() {
  if (unblockProcess) {
    unblockProcess.kill()
    unblockProcess = null
  }
}

function restartUnblockNeteaseMusic(settingsStore) {
  stopUnblockNeteaseMusic()
  startUnblockNeteaseMusic(settingsStore)
}

function getUnblockStatus() {
  return unblockProcess !== null
}

function getUnblockDiagnostic() {
  return { ...unblockDiag, running: unblockProcess !== null }
}

module.exports = {
  startUnblockNeteaseMusic,
  stopUnblockNeteaseMusic,
  restartUnblockNeteaseMusic,
  getUnblockStatus,
  getUnblockDiagnostic,
}
