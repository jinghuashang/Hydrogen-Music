import { installWebWindowApi } from './windowApi-web.js'

installWebWindowApi()
/* 不用顶层 await：esbuild 生产目标 es2020 不支持 TLA，会构建失败 */
import('../../src/main.js').catch((err) => {
  console.error('[Hydrogen Web] 启动失败', err)
})
