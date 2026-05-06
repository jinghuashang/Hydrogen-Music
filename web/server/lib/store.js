const fs = require('fs')
const path = require('path')

const DATA_DIR = path.join(__dirname, '..', 'data')

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
}

/**
 * 与 electron-store 用法一致：单文件 JSON，按 key 读写。
 */
function createStore(name) {
  ensureDir(DATA_DIR)
  const file = path.join(DATA_DIR, `${name}.json`)
  if (!fs.existsSync(file)) fs.writeFileSync(file, '{}', 'utf8')

  return {
    get(key) {
      const data = JSON.parse(fs.readFileSync(file, 'utf8'))
      return data[key]
    },
    set(key, val) {
      const data = JSON.parse(fs.readFileSync(file, 'utf8'))
      data[key] = val
      fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8')
    },
    has(key) {
      const data = JSON.parse(fs.readFileSync(file, 'utf8'))
      return Object.prototype.hasOwnProperty.call(data, key) && data[key] != null
    },
  }
}

module.exports = { createStore, DATA_DIR }
