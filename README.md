<br />
<p align="center">
  <a href="https://github.com/Kaidesuyo/Hydrogen-Music" target="blank">
    <img src="img/icon.png" alt="Logo" width="156" height="156">
  </a>
  <h2 align="center" style="font-weight: 600">Hydrogen Music</h2>

## ⚠️ 注意：
- 本项目是 [Kaidesuyo/Hydrogen-Music](https://github.com/Kaidesuyo/Hydrogen-Music/) 的备份库，没有根据软件工程规范编写，仅供参考！

## 📦️ 安装

访问 [Releases](https://github.com/jinghuashang/Hydrogen-Music/releases)
页面下载安装包。

## 👷‍♂️ 打包客户端

因为`Snap`打包特殊性只打包了Windows平台和macOs的安装包且并未适配Linux平台。
如有可能，您可以在开发环境中自行适配。

```shell
# 打包
npm run dist
```
## :computer: 配置开发环境

运行本项目

```shell
# 安装依赖
npm install

# 运行Vue服务
npm run dev

# 运行Electron客户端
npm start
```

## 🌐 部署到 Vercel

除了下载安装包使用，你还可以将本项目部署到 Vercel 或你的服务器上。

### 快速部署

1. 点击本仓库右上角的 **Fork**，复制本仓库到你的 GitHub 账号。

2. 部署网易云 API，详情参见 [Binaryify/NeteaseCloudMusicApi](https://github.com/Binaryify/NeteaseCloudMusicApi)。你也可以将 API 部署到 Vercel。

3. 点击仓库的 **Add File**，选择 **Create new file**，输入 `vercel.json`，将下面的内容复制粘贴到文件中，并将 `https://your-netease-api.example.com` 替换为你刚刚部署的网易云 API 地址：

```json
{
  "rewrites": [
    {
      "source": "/api/:match*",
      "destination": "https://your-netease-api.example.com/:match*"
    }
  ]
}
```

4. 打开 [Vercel.com](https://vercel.com)，使用 GitHub 登录。

5. 点击 **Import Git Repository** 并选择你刚刚复制的仓库并点击 **Import**。

6. 点击 **PERSONAL ACCOUNT** 旁边的 **Select**。

7. 点击 **Environment Variables**，填写：
   - **Name**: `VITE_NCM_API_URL`
   - **Value**: 你的 NCM API 地址（如 `https://your-ncm-api.vercel.app`）
   - 点击 **Add**

8. 最后点击底部的 **Deploy** 就可以部署到 Vercel 了。

> 详细部署说明请参考 [VERCEL_DEPLOYMENT.md](./VERCEL_DEPLOYMENT.md)

Powered by Vercel

## 📜 开源许可

本项目仅供个人学习研究使用，禁止用于商业及非法用途。

基于 [MIT license](https://opensource.org/licenses/MIT) 许可进行开源。

## 灵感来源

网易云音乐API：[NeteaseCloudMusicApiEnhanced/api-enhanced](https://github.com/neteasecloudmusicapienhanced/api-enhanced)<br />
哔哩哔哩API：[SocialSisterYi/bilibili-API-collect](https://github.com/SocialSisterYi/bilibili-API-collect)

- [qier222/YesPlayMusic](https://github.com/qier222/YesPlayMusic)
- [Apple Music](https://music.apple.com)
- [网易云音乐](https://music.163.com)

## 🖼️ 截图

![lyric2][lyric2-screenshot]
![home][home-screenshot]
![playlist][playlist-screenshot]
![lyric1][lyric1-screenshot]
![music_video][music_video-screenshot]

[lyric2-screenshot]: img/lyric2.png
[home-screenshot]: img/home.png
[playlist-screenshot]: img/playlist.png
[lyric1-screenshot]: img/lyric1.png
[music_video-screenshot]: img/music_video.png

