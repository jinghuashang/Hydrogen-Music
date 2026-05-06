# Hydrogen Music — Web / NAS 移植

本目录在**不改动现有 Vue 业务逻辑**的前提下，增加：

- **`server/`**：Node 网关（网易云 API、Unblock、原 Electron 主进程中的 IPC 能力、SSE 推送）。
- **`client/windowApi-web.js`**：浏览器端 `windowApi` 兼容层，与 `src/electron/preload.js` 对齐。
- **`vite.config.mjs` + `index.html`**：独立 Web 构建入口（`import.meta.env.VITE_WEB`）。

## 使用方式

**依赖只需在仓库根目录安装一次：**

```bash
cd /path/to/Hydrogen-Music-main
npm install
```

（`express`、`cors`、`http-proxy-middleware` 等与网关相关的包已写在根目录 `package.json` 的 `dependencies` 中，无需再进入 `web/server` 单独安装。）

### 1）构建 Web 前端

```bash
npm run web:build
```

产物在 **`web/dist/`**（入口为 **`web/dist/index.html`**，勿与旧版 `web/dist/web/` 混淆）。网关会托管该目录（`server.js` 里 `express.static`）。

### 2）启动网关（含 NCM API + Unblock + 反代 `/ncm`）

```bash
npm run web:server
```

默认：

- 网关：`http://0.0.0.0:37890`（环境变量 `GATEWAY_PORT`）
- 网易云 API：`127.0.0.1:36530`（`NCM_PORT`）

浏览器访问 **`http://<NAS-IP>:37890/`**。

### 3）本地联调（热更新）

终端 A：

```bash
npm run web:server
```

终端 B：

```bash
npm run web:dev
```

打开 **`http://127.0.0.1:5174/`**（Vite 会把 `/api`、`/ncm` 代理到 37890）。

## 与桌面版的差异（已知）

- **选择目录 / 字体**：`openFile`、`selectFile` 在 Web 上通过 `prompt` 输入服务器绝对路径（NAS 路径）。
- **窗口控制、托盘、全局快捷键、自动更新**：无系统窗口时相关调用为 no-op 或仅更新网页标题。
- **在文件夹中显示**：`openLocalFolder` 在 Web 上为 no-op。
- **下载 / 本地曲库路径**：均指向**服务器磁盘**上配置的目录（与 Electron 本机路径语义一致，只是机器换成 NAS）。

## 数据与配置

网关将 `electron-store` 等价数据写在：

`web/server/data/*.json`

首次启动会写入默认设置（与 `ipcMain.js` 中初始设置一致）。

## 开机自启（Ubuntu / systemd）

仓库内示例单元文件：**`web/systemd/hydrogen-music-web.service.example`**。

1. 把其中的 **`WorkingDirectory`**、**`ExecStart` 里的路径**、**`User=`** 改成你的本机路径与用户名。  
2. **`ExecStart` 必须用本机 `which node` 的绝对路径**（若用 nvm，常见为 `/home/用户名/.nvm/versions/node/v…/bin/node`，不要用裸 `node`）。  
3. 复制到 `/etc/systemd/system/hydrogen-music-web.service`（系统服务）或 `~/.config/systemd/user/`（用户服务），然后 `daemon-reload`、`enable`、`start`。  
4. 用户服务若希望**未登录也运行**：`sudo loginctl enable-linger 你的用户名`。

详细命令见示例文件顶部注释。

## 反代示例（可选）

若希望 443 与路径统一，可在 NAS 上用 nginx 将 `/` 指到静态资源、`/api` 与 `/ncm` 指到本网关（或仅反代到 37890 由网关一体处理）。

## 若曾单独安装过 `web/server/node_modules`

可删除该目录，只保留根目录一次 `npm install` 即可：

```bash
rm -rf web/server/node_modules
```
