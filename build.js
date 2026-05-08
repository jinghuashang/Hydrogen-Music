const { execSync } = require('child_process')
const fs = require('fs')
const path = require('path')
const version = require('./package.json').version
const tag = `v${version}`

console.log(`Building version: ${tag}`)

// Build
execSync('vite build', { stdio: 'inherit' })
execSync('electron-builder --publish never', { stdio: 'inherit' })

// Find built files
const releaseBase = path.join(__dirname, 'release')
let releaseDir = path.join(releaseBase, version)
if (!fs.existsSync(releaseDir)) {
  // electron-builder may use a slightly different folder name; pick the most recent one
  const dirs = fs.readdirSync(releaseBase)
    .map(d => ({ name: d, time: fs.statSync(path.join(releaseBase, d)).mtimeMs }))
    .sort((a, b) => b.time - a.time)
  if (dirs.length) releaseDir = path.join(releaseBase, dirs[0].name)
}
const files = fs.readdirSync(releaseDir)
  .filter(f => f.endsWith('.exe') || f.endsWith('.zip') || f.endsWith('.dmg') || f.endsWith('.yml'))
  .map(f => path.join(releaseDir, f))

console.log('Built files:', files)

// Quote file paths to handle spaces
const quotedFiles = files.map(f => `"${f}"`).join(' ')

// Create GitHub release and upload
try {
  execSync(`gh release view ${tag}`, { stdio: 'pipe' })
  console.log(`Release ${tag} exists, uploading assets...`)
  execSync(`gh release upload ${tag} ${quotedFiles} --clobber`, { stdio: 'inherit' })
} catch {
  console.log(`Creating release ${tag}...`)
  execSync(`gh release create ${tag} ${quotedFiles} --title "Hydrogen Music ${tag}" --generate-notes`, { stdio: 'inherit' })
}

console.log('Done!')
