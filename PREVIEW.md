# Hydrogen Music Preview 分支

独立于主线的预览分支，当前基于 `v0.2.3`。本分支用于验证「一起听」功能，不合并回主线。

## 功能范围

### 独立「一起听」页面

- 新增独立路由 `/listentogether`，导航名称「一起听」，不依赖播放器弹窗或全屏播放页。
- 设置页新增「开启一起听页面」开关，状态随 `userStore` 持久化。
- 进入页面后隐藏底部 dock；Web 宽屏不再启用右侧嵌入播放器，页面保持完整独立布局。
- 大厅：创建房间、粘贴邀请链接/房间号加入、自动恢复账号已有房间。
- 房间：房间号、HOST/GUEST 身份、成员列表、邀请链接复制、共享队列、当前播放、重新同步、结束/退出。
- 房间 ID、邀请链接、房主 ID 均支持从完整链接或纯房间号解析。

### 播放同步

- 每 3 秒轮询 `/listentogether/status` 获取房间和成员状态。
- 每 3 秒轮询 `/listentogether/sync/playlist/get` 获取：
  - 共享播放列表 `playlist.displayList.result`；
  - 最新播放命令 `playCommand`。
- 每 30 秒发送 `/listentogether/heatbeat` 心跳，携带当前歌曲、播放状态、毫秒进度。
- 支持的播放命令：`PLAY`、`PAUSE`、`GOTO`、`seek`。
- 播放/暂停、切歌、拖动进度、播放模式变化都会上报到房间。
- 用命令签名去重，同一个 `playCommand` 在轮询中重复返回时只执行一次。
- 过滤自己发出的 `userId` 命令，避免回声同步。
- `PLAY` 命令按 `serverSeq`（服务端毫秒时间戳）外推进度，加入正在播放的房间时不会从旧进度开始。
- 远端切歌目标不在本地队列时，会重新拉取共享队列；仍不存在则单独补歌曲详情。
- 房主共享列表为空（创建时上报失败或重进页面）时，自动补发当前播放列表并发布当前歌曲。
- 播放模式通过 Electron 自定义 `/listentogether/sync/list/command` 模块写入 `playMode`。

### 歌词与播放界面

- 参考「心动」页布局：封面在左，标题左对齐，歌词在右，底部整行进度条/音量/控制。
- 歌词支持 LRC 原文、翻译、罗马音；`ABC` / `译` 可分别开关。
- 当前行黑条高亮，上下行按距离模糊，整条歌词轨道随进度滚动。
- 歌词使用 120ms 独立时钟直接读取 Howler 实际位置，不依赖每秒更新一次的 `progress`。
- 进度时间码默认隐藏，鼠标悬停进度条时显示；进度条 hover 时加粗并显示圆点。
- 播放控件使用原版细线风格 `<`、`||`、`>`，直角无边框；移除按钮 focus 外框。
- 暂停后恢复播放会校正底层 seek，避免声音从头开始而进度条/歌词停在暂停位置。

### 进度条拖动

- 一起听页使用 pointer 拖动：按下暂停进度刷新，松开后 `changeProgressByDragEnd` 并上报 `seek`。
- 全屏播放器、底栏、标题栏的 `vue-slider` 补上 `@drag-end="changeProgress(progress)"`，拖动结束才真正 seek 音频。
- 拖动产生的进度跳变由一起听 store 自动上报给房间，不需要额外操作。

## 关键修复记录

- 修复一起听歌曲在几秒内循环：官方 `/status` 不返回当前歌曲/进度，旧逻辑把本机创建时的进度当作远端进度反复 seek。现改为只认 `playCommand`。
- 修复暂停后播放从头开始：恢复播放前若 Howler seek 为 0 而 store 进度仍有效，先 seek 回暂停位置。
- 修复拖动进度条不生效：滑块原先只监听 `click`，拖动结束不会调用 `changeProgress`。
- 修复歌词延迟：歌词时钟从 1s 的 `progress` 改为 120ms 读取 Howler 实际位置，并收紧高亮/滚动过渡。
- 修复一起听页重新进入后共享歌曲为 0：轮询共享列表并支持房主自动补发。

## 涉及文件

新增：

- `src/views/ListenTogether.vue`
- `src/store/listenTogetherStore.js`
- `src/api/listenTogether.js`
- `src/utils/listenTogether.js`
- `src/server/custom-listen-together-sync.js`
- `src/server/custom-listen-together-leave.js`

修改：

- `src/App.vue`
- `src/router/router.js`
- `src/views/Home.vue`
- `src/views/Settings.vue`
- `src/store/userStore.js`
- `src/api/song.js`
- `src/electron/services.js`
- `src/components/Player.vue`
- `src/components/MusicWidget.vue`
- `src/components/Title.vue`

## 验证

开发预览环境实测：

- `npm run build` 通过。
- 真实账号房间：共享队列 35 首，状态稳定 `SYNCED`。
- 连续播放采样：`176.3s → 185.3s` 持续递增，`applying=false`，不再循环。
- 暂停/恢复：`210.96s` 暂停，恢复后 `212.74s` 继续，未从头播放。
- 全屏播放器拖动：`184.9s → 238.9s`。
- 一起听页拖动：`240.9s → 198.1s`，服务端最新命令为 `seek 197160ms`。
- 歌词边界延迟：`68ms`、`75ms`。
- 模拟远端 `PAUSE` / `PLAY`：正确暂停、恢复；自己的命令被过滤。

## 已知限制

- 官方一起听为双人房间；成员列表可显示服务端返回的所有成员，但播放同步以最新 `playCommand` 为准。
- Web 部署的房客退出依赖上游 API 是否提供 `/listentogether/leave`；缺失时降级为仅清理本地房间状态。
- 播放模式同步依赖 Electron 自定义同步模块；外部 Web API 若不支持 `playMode` 字段会被忽略。
- 歌词依赖 `/lyric` 接口；本地歌曲或纯音乐可能显示「暂无歌词」。

## 本地预览

```bash
npm run dev      # Vite 渲染层，端口 5173
npm start        # Electron 桌面窗口
```

或 Web 预览：

```bash
npm run web:dev
```
