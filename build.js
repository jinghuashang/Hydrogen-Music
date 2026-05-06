const { execSync } = require('child_process')
const version = require('./package.json').version

console.log(`Building version: v${version}`)

// Create and push tag
execSync(`git tag v${version} -f`, { stdio: 'inherit' })
execSync(`git push origin v${version} -f`, { stdio: 'inherit' })

// Build and publish
execSync('vite build', { stdio: 'inherit' })
execSync('electron-builder --publish always', { stdio: 'inherit' })
