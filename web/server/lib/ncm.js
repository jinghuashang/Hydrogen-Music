const { serveNcmApi, getModulesDefinitions } = require('@neteasecloudmusicapienhanced/api')
const path = require('path')

let started = false

async function startNcm(port = 36530) {
  if (started) return

  const apiModulesDir = path.resolve(__dirname, '../../../node_modules/@neteasecloudmusicapienhanced/api/module')
  const defaultModules = await getModulesDefinitions(apiModulesDir,
    {
      'daily_signin.js': '/daily_signin',
      'fm_trash.js': '/fm_trash',
      'personal_fm.js': '/personal_fm',
    }
  )
  const idx = defaultModules.findIndex(m => m.route === '/song/url/v1')
  if (idx !== -1) {
    defaultModules[idx] = {
      identifier: 'song_url_v1',
      route: '/song/url/v1',
      module: require('../../../src/server/custom-song-url-v1'),
    }
  }

  await serveNcmApi({
    checkVersion: true,
    port,
    moduleDefs: defaultModules,
  })
  started = true
  console.log(`[NCM API] listening on ${port}`)
}

module.exports = { startNcm }
