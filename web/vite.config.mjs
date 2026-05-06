import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const webRoot = __dirname
const repoRoot = path.resolve(webRoot, '..')

/**
 * root 设为 web/，避免 root=仓库根目录时入口为 web/index.html 导致产物落在 dist/web/，
 * 与 express.static(web/dist) 期望的 dist/index.html 不一致。
 */
export default defineConfig({
  root: webRoot,
  plugins: [vue()],
  base: './',
  publicDir: path.join(repoRoot, 'public'),
  envDir: webRoot,
  envPrefix: 'VITE_',
  resolve: {
    alias: {
      '@': path.join(repoRoot, 'src'),
    },
  },
  server: {
    port: 5174,
    strictPort: false,
    fs: {
      allow: [repoRoot, webRoot],
    },
    proxy: {
      '/api': { target: 'http://127.0.0.1:37890', changeOrigin: true },
      '/ncm': { target: 'http://127.0.0.1:37890', changeOrigin: true },
    },
  },
  build: {
    outDir: path.join(webRoot, 'dist'),
    emptyOutDir: true,
    rollupOptions: {
      input: path.join(webRoot, 'index.html'),
    },
  },
})
