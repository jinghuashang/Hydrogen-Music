const { ipcMain } = require("electron");
const path = require("path");
const https = require("https");
const http = require("http");
const fs = require("fs");
const Store = require("electron-store");
const { nanoid } = require('nanoid')
const { File, Picture, PictureType, ByteVector } = require('node-taglib-sharp')

function fetchBuffer(url) {
    return new Promise((resolve, reject) => {
        const client = url.startsWith('https') ? https : http
        const get = (u) => {
            client.get(u, (res) => {
                if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                    get(res.headers.location)
                    return
                }
                if (res.statusCode !== 200) { reject(new Error('HTTP ' + res.statusCode)); return }
                const chunks = []
                res.on('data', c => chunks.push(c))
                res.on('end', () => resolve(Buffer.concat(chunks)))
                res.on('error', reject)
            }).on('error', reject)
        }
        get(url)
    })
}

function fetchLyric(songId) {
    return new Promise((resolve) => {
        const url = `http://localhost:36530/lyric?id=${songId}`
        http.get(url, (res) => {
            let data = ''
            res.on('data', c => data += c)
            res.on('end', () => {
                try {
                    const json = JSON.parse(data)
                    const lrc = json?.lrc?.lyric || ''
                    resolve(lrc)
                } catch { resolve('') }
            })
        }).on('error', () => resolve(''))
    })
}

async function embedMetadata(filePath, meta, options) {
    try {
        if (!fs.existsSync(filePath)) {
            console.error('[download] 文件不存在:', filePath)
            return false
        }

        const file = File.createFromPath(filePath)
        let changed = false

        if (options.info && meta) {
            if (meta.name) { file.tag.title = meta.name; changed = true }
            if (meta.artists) { file.tag.performers = [meta.artists]; changed = true }
            if (meta.album) { file.tag.album = meta.album; changed = true }
            console.log('[download] 歌曲信息:', meta.name, meta.artists, meta.album)
        }

        if (options.cover && meta?.picUrl) {
            try {
                console.log('[download] 下载封面:', meta.picUrl)
                const imgBuffer = await fetchBuffer(meta.picUrl)
                console.log('[download] 封面大小:', imgBuffer.length, 'bytes')
                const pic = new Picture()
                pic.data = ByteVector.fromByteArray(imgBuffer)
                pic.type = PictureType.FrontCover
                pic.mimeType = 'image/jpeg'
                pic.description = 'Cover'
                file.tag.pictures = [pic]
                changed = true
            } catch (e) {
                console.error('[download] 封面下载失败:', e.message)
            }
        }

        if (options.lyric && meta?.id) {
            try {
                console.log('[download] 获取歌词, id:', meta.id)
                const lrcText = await fetchLyric(meta.id)
                console.log('[download] 歌词长度:', lrcText.length)
                if (lrcText) {
                    file.tag.lyrics = lrcText
                    changed = true
                }
            } catch (e) {
                console.error('[download] 歌词获取失败:', e.message)
            }
        }

        if (changed) {
            file.save()
            console.log('[download] 元数据嵌入成功:', filePath)
        }
        file.dispose()
        return changed
    } catch (e) {
        console.error('[download] 嵌入元数据异常:', e.message, e.stack)
        return false
    }
}

module.exports = MusicDownload = (win) => {
    const settingsStore = new Store({ name: "settings" });
    let isClose = false;
    let downloadObj = {
        downloadUrl: "",
        fileName: "",
        type: "",
        savePath: "",
        meta: null,
        options: { cover: false, info: false, lyric: false },
    };
    ipcMain.on("download", async (event, args) => {
        downloadObj.fileName = args.name.replaceAll("/", " - ").replaceAll("\\", " - ");
        downloadObj.downloadUrl = args.url;
        downloadObj.type = args.type;
        downloadObj.meta = args.meta || null;
        downloadObj.options = args.options || { cover: false, info: false, lyric: false };
        const savePath = await settingsStore.get("settings");
        downloadObj.savePath = savePath.local.downloadFolder;
        win.webContents.downloadURL(downloadObj.downloadUrl);
    });

    win.webContents.session.on("will-download", (event, item, webContents) => {
        const filePath = path.join(downloadObj.savePath, downloadObj.fileName + "." + downloadObj.type);
        item.setSavePath(filePath);

        const totalBytes = item.getTotalBytes();

        let interruptedTimes = 0;
        item.on("updated", (event, state) => {
            let progress = item.getReceivedBytes() / totalBytes;
            progress = Math.round(progress * 100);
            win.setProgressBar(progress / 100);

            if (state === "interrupted") {
                let alterPath = path.join(downloadObj.savePath, downloadObj.fileName);
                if (
                    alterPath.indexOf('"') != -1 ||
                    alterPath.indexOf("?") != -1 ||
                    alterPath.indexOf("<") != -1 ||
                    alterPath.indexOf(">") != -1 ||
                    alterPath.indexOf(":") != -1
                ) {
                    interruptedTimes++;
                    alterPath = alterPath.replaceAll('"', "＂");
                    alterPath = alterPath.replaceAll("?", "？");
                    alterPath = alterPath.replaceAll("<", "＜");
                    alterPath = alterPath.replaceAll(">", "＞");
                    alterPath = alterPath.replaceAll(":", "：");
                    item.setSavePath(alterPath + "." + downloadObj.type);
                    if (interruptedTimes > 3) {
                        item.setSavePath(
                            path.join(downloadObj.savePath, "undefined_name_" + nanoid()  + "." + downloadObj.type)
                        );
                        interruptedTimes = 0;
                    }
                    item.resume();
                }
            }
            win.webContents.send("download-progress", progress);
        });
        item.once("done", async (event, state) => {
            if (!win.isDestroyed()) {
                win.setProgressBar(-1);
            }
            if (state === 'completed') {
                const { cover, info, lyric } = downloadObj.options
                if (cover || info || lyric) {
                    const actualPath = item.getSavePath() || filePath
                    console.log('[download] 准备嵌入元数据:', actualPath, 'options:', downloadObj.options)
                    await embedMetadata(actualPath, downloadObj.meta, downloadObj.options)
                }
            }
            if (!isClose) win.webContents.send("download-next");
        });
        ipcMain.on("download-resume", () => {
            item.resume();
        });
        ipcMain.on("download-pause", (close) => {
            if (close == "shutdown") {
                isClose = true;
                item.cancel();
            } else item.pause();
        });
        ipcMain.on("download-cancel", () => {
            item.cancel();
        });
    });
};
