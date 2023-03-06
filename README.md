<br />
<p align="center">
  <a href="https://github.com/Kaidesuyo/Hydrogen-Music" target="blank">
    <!-- <img src="img/icon.png" alt="Logo" width="156" height="156"> -->
    <img src="img/wait for rebuild.png" alt="">
  </a>
  <h2 align="center" style="font-weight: 600">Hydrogen Music</h2>

## ⚠️ 注意：
- 本项目是为了尽快应付毕业设计的产物，没有根据软件工程规范编写，仅供参考！
- 本项目下半年会进行重构，届时会重写所有源代码，请在接受此条件的前提下提交PR。
- 由于本地管理功能并不完善，请尽量将其作为流媒体播放器使用。
- 因网易增加了网易云盾验证，密码与邮箱登录无法使用，请使用二维码登录。
- 请尽量不要使用云盘中的上传功能，目前上传失败概率大且内存无法得到释放。
- <a href="#%EF%B8%8F-安装" target="blank"><strong>📦️ 下载安装包</strong></a>

## 📦️ 安装

访问 [Releases](https://github.com/Kaidesuyo/Hydrogen-Music/releases)
页面下载安装包。

## 👷‍♂️ 打包客户端

由于个人设备限制，只打包了Windows平台的安装包且并未适配macOs与Linux平台。
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

## 📜 开源许可

本项目仅供个人学习研究使用，禁止用于商业及非法用途。

基于 [MIT license](https://opensource.org/licenses/MIT) 许可进行开源。

## 灵感来源

网易云音乐API：[Binaryify/NeteaseCloudMusicApi](https://github.com/Binaryify/NeteaseCloudMusicApi)<br />
哔哩哔哩API：[SocialSisterYi/bilibili-API-collect](https://github.com/SocialSisterYi/bilibili-API-collect)

- [qier222/YesPlayMusic](https://github.com/qier222/YesPlayMusic)
- [Apple Music](https://music.apple.com)
- [网易云音乐](https://music.163.com)

## 🖼️ 截图

![home][home-screenshot]
![playlist][playlist-screenshot]
![lyric][lyric-screenshot]
![music_video][music_video-screenshot]

<!-- MARKDOWN LINKS & IMAGES -->
<!-- https://www.markdownguide.org/basic-syntax/#reference-style-links -->

[home-screenshot]: img/home.png
[playlist-screenshot]: img/playlist.png
[lyric-screenshot]: img/lyric.png
[music_video-screenshot]: img/music_video.png
