# Hydrogen Music 部署到 Vercel 指南

## 项目架构分析

### Web 版本架构

```
Hydrogen-Music/
├── src/                    # Vue 前端源码
├── web/
│   ├── client/             # 浏览器端 API 兼容层
│   │   ├── main-web-entry.js    # Web 入口
│   │   └── windowApi-web.js     # 替代 Electron preload.js
│   ├── server/             # Node.js 网关服务器
│   │   ├── server.js       # 主服务器（Express）
│   │   └── lib/
│   │       ├── handlers.js        # IPC 调用处理器
│   │       ├── ncm.js             # NCM API 启动器
│   │       ├── sse.js             # Server-Sent Events
│   │       ├── store.js           # 数据持久化
│   │       ├── unblock.js         # UnblockNeteaseMusic
│   │       ├── download-manager.js # 下载管理器
│   │       └── local-scan.js      # 本地音乐扫描
│   ├── vite.config.mjs     # Web 构建配置
│   └── index.html          # Web 入口 HTML
```

### 核心功能

| 功能 | Electron 版 | Web 版 | Vercel 兼容 |
|------|------------|--------|-------------|
| 网易云音乐播放 | ✅ | ✅ | ✅ |
| 登录/账号 | ✅ | ✅ | ✅ |
| 搜索/歌单 | ✅ | ✅ | ✅ |
| 歌词显示 | ✅ | ✅ | ✅ |
| MV 播放 | ✅ | ✅ | ✅ |
| 下载音乐 | ✅ | ✅ (服务器) | ❌ 需要外部存储 |
| 本地音乐扫描 | ✅ | ✅ (NAS) | ❌ 需要外部存储 |
| UnblockNeteaseMusic | ✅ | ✅ | ⚠️ 需要外部服务 |
| 全局快捷键 | ✅ | ❌ | ❌ |
| 窗口控制 | ✅ | ❌ | ❌ |

---

## 发现的 Debug 代码

以下文件包含 `console.log` 调试语句，建议在生产环境移除：

### 1. `src/components/Banner.vue:97`
```javascript
console.log("bannerClick")
```

### 2. `src/electron/services.js:24-26`
```javascript
console.log('[UnblockNeteaseMusic] Called, checking settings...')
console.log('[UnblockNeteaseMusic] Settings:', JSON.stringify(settings?.unblock))
```

### 3. `src/electron/ipcMain.js:285`
```javascript
console.log(filePath)
```

### 4. `src/components/LibraryDetail.vue:181-182`
```javascript
console.log(id)
console.log(result)
```

### 5. `src/components/LoginContent.vue:49`
```javascript
console.log('注册本地帐号')
```

### 6. `src/components/MusicVideo.vue:236-240`
```javascript
console.log(currentVideoInfo.value)
console.log(selectedInfo.value)
console.log(urlIndex)
```

### 7. `src/components/RecListItem.vue:72` (已注释)
```javascript
// console.log(recommendationList.value)
```

---

## Vercel 部署方案

由于 Hydrogen Music 的 Web 版本依赖 Node.js 服务器（含文件系统操作、子进程），直接部署到 Vercel 需要一些调整。

### 方案一：纯前端部署（推荐）

将项目改造为纯前端应用，使用外部 NCM API。

#### 步骤 1：Fork 仓库

点击本仓库右上角的 **Fork**，复制本仓库到你的 GitHub 账号。

#### 步骤 2：部署 NCM API

部署网易云 API，详情参见 [Binaryify/NeteaseCloudMusicApi](https://github.com/Binaryify/NeteaseCloudMusicApi)。

推荐部署到 Vercel：
1. Fork [NeteaseCloudMusicApi](https://github.com/Binaryify/NeteaseCloudMusicApi)
2. 在 Vercel 中导入该仓库
3. 部署完成后获取 API 地址（如 `https://your-ncm-api.vercel.app`）

#### 步骤 3：创建 Vercel 配置

在仓库根目录创建 `vercel.json`：

```json
{
  "rewrites": [
    {
      "source": "/api/:match*",
      "destination": "https://your-ncm-api.vercel.app/:match*"
    }
  ]
}
```

#### 步骤 4：修改 Web 构建配置

修改 `web/vite.config.mjs`，添加环境变量支持：

```javascript
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const webRoot = __dirname
const repoRoot = path.resolve(webRoot, '..')

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
  define: {
    // 允许通过环境变量配置 API 地址
    'import.meta.env.VITE_NCM_API_URL': JSON.stringify(
      process.env.VITE_NCM_API_URL || '/api'
    ),
  },
  build: {
    outDir: path.join(webRoot, 'dist'),
    emptyOutDir: true,
    rollupOptions: {
      input: path.join(webRoot, 'index.html'),
    },
  },
})
```

#### 步骤 5：修改客户端 API 层

修改 `web/client/windowApi-web.js`，使用可配置的 API 地址：

```javascript
const API = import.meta.env.VITE_NCM_API_URL || '/api'
```

#### 步骤 6：添加 Vercel 构建脚本

在 `package.json` 中添加：

```json
{
  "scripts": {
    "vercel-build": "npm run web:build"
  }
}
```

#### 步骤 7：配置 Vercel

1. 打开 [Vercel.com](https://vercel.com)，使用 GitHub 登录
2. 点击 **Import Git Repository** 并选择你 Fork 的仓库
3. 配置以下设置：
   - **Framework Preset**: Vite
   - **Build Command**: `npm run vercel-build`
   - **Output Directory**: `web/dist`
4. 添加环境变量：
   - `VITE_NCM_API_URL`: 你的 NCM API 地址（如 `https://your-ncm-api.vercel.app`）
5. 点击 **Deploy**

---

### 方案二：使用 Vercel Serverless Functions

将服务器端逻辑迁移到 Vercel Serverless Functions。

#### 步骤 1：创建 API Routes

在仓库根目录创建 `api/` 目录：

```
api/
├── health.js
├── invoke.js
└── send.js
```

#### 步骤 2：创建 `api/health.js`

```javascript
export default function handler(req, res) {
  res.status(200).json({ ok: true, service: 'hydrogen-music-web' })
}
```

#### 步骤 3：创建 `api/invoke.js`

```javascript
import axios from 'axios'

const NCM_API = process.env.NCM_API_URL || 'http://localhost:3000'

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    const { name, args = [] } = req.body

    // 处理需要 NCM API 的调用
    if (name === 'get-request-data') {
      const [request] = args
      const result = await axios.get(request.url, request.option)
      return res.status(200).json({ ok: true, result: result.data })
    }

    // 其他调用返回默认值或错误
    res.status(200).json({ ok: true, result: null })
  } catch (e) {
    console.error('[invoke]', e)
    res.status(500).json({ ok: false, error: e.message })
  }
}
```

#### 步骤 4：创建 `vercel.json`

```json
{
  "version": 2,
  "builds": [
    {
      "src": "api/**/*.js",
      "use": "@vercel/node"
    },
    {
      "src": "web/vite.config.mjs",
      "use": "@vercel/static-build",
      "config": {
        "distDir": "web/dist"
      }
    }
  ],
  "routes": [
    { "src": "/api/(.*)", "dest": "/api/$1" },
    { "src": "/(.*)", "dest": "/web/$1" }
  ]
}
```

---

### 方案三：使用外部服务器

如果需要完整功能（下载、本地音乐等），建议部署到自己的服务器。

#### 使用 Docker

创建 `Dockerfile`：

```dockerfile
FROM node:18-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --production

COPY . .

RUN npm run web:build

EXPOSE 37890

CMD ["node", "web/server/server.js"]
```

创建 `docker-compose.yml`：

```yaml
version: '3'

services:
  hydrogen-music:
    build: .
    ports:
      - "37890:37890"
    volumes:
      - ./data:/app/web/server/data
      - /path/to/music:/music
    environment:
      - NODE_ENV=production
      - GATEWAY_PORT=37890
      - NCM_PORT=36530
    restart: unless-stopped
```

运行：

```bash
docker-compose up -d
```

---

## 功能限制说明

### Vercel 部署的限制

| 功能 | 原因 | 替代方案 |
|------|------|----------|
| 下载音乐 | 无持久化文件系统 | 使用浏览器下载 |
| 本地音乐扫描 | 无文件系统访问 | 不支持 |
| UnblockNeteaseMusic | 需要子进程 | 使用外部 Unblock 服务 |
| SSE 实时推送 | Serverless 函数超时 | 使用轮询或 WebSocket |

### 推荐配置

对于 Vercel 部署，建议：

1. **禁用下载功能**：在设置中隐藏下载相关 UI
2. **使用外部 NCM API**：部署独立的 NCM API 服务
3. **移除文件系统依赖**：只保留在线播放功能

---

## 快速部署（最简方案）

如果你想快速部署一个可用的版本：

1. **Fork 本仓库**

2. **创建 `vercel.json`**（在仓库根目录）：

```json
{
  "rewrites": [
    {
      "source": "/api/:match*",
      "destination": "https://neteasecloudmusicapi.vercel.app/:match*"
    }
  ]
}
```

3. **修改 `web/vite.config.mjs`**：

```javascript
// 在 resolve.alias 后添加
server: {
  proxy: {
    '/api': { target: process.env.VITE_NCM_API_URL || 'http://127.0.0.1:37890', changeOrigin: true },
  },
},
```

4. **部署到 Vercel**：
   - 导入仓库
   - 设置构建命令：`npm run web:build`
   - 设置输出目录：`web/dist`
   - 添加环境变量：`VITE_NCM_API_URL` = 你的 NCM API 地址

5. **完成**：访问 Vercel 提供的域名即可使用

---

## 常见问题

### Q: 为什么播放音乐没有声音？

A: 检查 NCM API 是否正常工作。可以在浏览器中访问 `https://your-domain.vercel.app/api/health` 测试。

### Q: 如何使用自己的 NCM API？

A: 修改 `vercel.json` 中的 `destination` 为你的 API 地址，并在 Vercel 环境变量中设置 `VITE_NCM_API_URL`。

### Q: 登录功能不工作？

A: 确保 NCM API 支持登录功能，并且 CORS 配置正确。

### Q: 如何启用 UnblockNeteaseMusic？

A: Vercel 部署不支持 UnblockNeteaseMusic。如需此功能，请使用方案三（自有服务器）部署。

---

## 总结

| 部署方式 | 难度 | 功能完整度 | 推荐场景 |
|----------|------|-----------|----------|
| 方案一：纯前端 | ⭐⭐ | 70% | 快速部署，基础播放 |
| 方案二：Serverless | ⭐⭐⭐ | 80% | 需要部分后端功能 |
| 方案三：自有服务器 | ⭐⭐⭐⭐ | 100% | 完整功能，NAS 用户 |

对于大多数用户，**方案一**是最简单且足够使用的方案。
