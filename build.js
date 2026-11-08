const { execSync } = require('child_process')
const fs = require('fs')
const path = require('path')
const version = require('./package.json').version
const tag = `v${version}`

console.log(`Building version: ${tag}`)

// Build
execSync('vite build', { stdio: 'inherit' })
execSync('electron-builder --publish never', { stdio: 'inherit' })

// Find built files（与 CI Release 步骤共用 scripts/artifact-files.cjs 的规则）
const { listArtifacts } = require('./scripts/artifact-files.cjs')
const files = listArtifacts({ root: __dirname, version })

console.log('Built files:', files)

// Quote file paths to handle spaces
const quotedFiles = files.map(f => `"${f}"`).join(' ')

// Create GitHub release and upload（CI 传入 --publish never 时由 workflow 的 release 步骤统一发布，
// 否则 Windows / macOS 两个 job 会同时对同一个 release 上传，第二个 job 会因资源已存在而失败）
const skipPublish = process.argv.includes('--publish') && process.argv.includes('never')
if (skipPublish) {
  console.log('Publishing skipped (--publish never): artifacts are handled by the workflow')
} else {
  try {
    execSync(`gh release view ${tag}`, { stdio: 'pipe' })
    console.log(`Release ${tag} exists, uploading assets...`)
    execSync(`gh release upload ${tag} ${quotedFiles} --clobber`, { stdio: 'inherit' })
  } catch {
    console.log(`Creating release ${tag}...`)
    execSync(`gh release create ${tag} ${quotedFiles} --title "Hydrogen Music ${tag}" --notes ""`, { stdio: 'inherit' })
  }
}

console.log('Done!')
