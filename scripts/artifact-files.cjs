// 统一的产物发现逻辑：本地 build.js 与 CI Release 步骤共用同一份规则，
// 避免两边各自维护导致「本地能传、CI 传不上去」这类问题。
const fs = require('fs')
const path = require('path')

const PACKAGE_EXT = /\.(exe|zip|dmg|yml|blockmap)$/i

/**
 * 列出待上传的安装包与元数据文件（绝对路径）。
 * 规则：优先 <root>/release/<version>，不存在时退回 release 下最近修改的子目录。
 * 只取该目录这一层的文件，不递归——解包目录里的 Chromium 文件不能上传。
 */
function listArtifacts({ root = process.cwd(), version } = {}) {
  const ver = version || require(path.join(root, 'package.json')).version
  const base = path.join(root, 'release')
  if (!fs.existsSync(base)) return []

  let dir = path.join(base, ver)
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
    const dirs = fs
      .readdirSync(base)
      .map((name) => ({ name, time: fs.statSync(path.join(base, name)).mtimeMs }))
      .sort((a, b) => b.time - a.time)
    if (!dirs.length) return []
    dir = path.join(base, dirs[0].name)
  }

  return fs
    .readdirSync(dir)
    .filter((file) => PACKAGE_EXT.test(file))
    .map((file) => path.join(dir, file))
    .filter((file) => {
      try {
        return fs.statSync(file).isFile()
      } catch {
        return false
      }
    })
}

module.exports = { listArtifacts, PACKAGE_EXT }
