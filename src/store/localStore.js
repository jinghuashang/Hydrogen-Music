import { defineStore } from "pinia";
import { noticeOpen } from "../utils/dialog";

export const useLocalStore = defineStore('localStore', {
    state: () => {
        return {
            isFirstDownload: true,
            isDownloading: false,
            downloadList: [],
            downloadedFolderSettings: null,
            downloadedMusicFolder: null,
            downloadedFiles: null,
            localFolderSettings: [],
            localMusicFolder: null,
            localMusicList: null,
            localMusicClassify: null,

            currentSelectedFile: {name: null},

            currentType: null,
            currentSelectedInfo: null,
            currentSelectedSongs: null,
            currentSelectedFilePicUrl: null,
            isRefreshLocalFile: false,

            quitApp: null,
        }
    },
    actions: {
        //对象数组去重(根据batch参数去重)
        removedup(arr, batch) {
            if (!Array.isArray(arr)) {
              return arr;
            }
            if (arr.length == 0) {
              return [];
            }
            let seen = {};
            return arr.filter(item => {
                const key = item[batch]
                if(seen[key]) return false
                seen[key] = true
                return true
            });
        },
        updateDownloadList(list) {
            if(!this.downloadedFolderSettings) {noticeOpen("请先在设置中设置下载目录", 2);return}
            this.downloadList = this.downloadList.concat(list)
            this.downloadList = this.removedup(this.downloadList, 'id')
            if(!this.isDownloading && this.isFirstDownload) {
                windowApi.startDownload()
                this.isFirstDownload = false
            }
            noticeOpen('已添加到下载列表', 2)
        },
        getSongs(arr) {
            if(!this.currentSelectedSongs) this.currentSelectedSongs = []
            arr.forEach(song => {
              if(song.children) this.getSongs(song.children)
              else {
                this.currentSelectedSongs.push(song)
              }
            })
        },
        getFolderSongs(arr, folderName) {
            arr.forEach(item => {
              if(item.name == folderName) {
                this.currentSelectedInfo = {
                    name: item.name,
                    dirPath: item.dirPath
                }
                this.currentSelectedSongs = []
                this.getSongs(item.children)
                return
              } else if(item.children) this.getFolderSongs(item.children, folderName)
        
            });
        },
        async getImgBase64(fileUrl) {
            return await windowApi.getLocalMusicImage(fileUrl)
        },
        updateLocalMusicDetail(type, query, id) {
            this.currentType = type
            if(type == 'localFiles') {
                if(query.type == 'downloaded')
                    this.getFolderSongs(this.downloadedFiles, query.name)
                if(query.type == 'local')
                    this.getFolderSongs(this.localMusicList, query.name)
            }
            if(type == 'localAlbum') {
                const albums = this.localMusicClassify?.albums || []
                const index = albums.findIndex((item) => item.id == id)
                if(index == -1) return
                this.currentSelectedInfo = {
                    id: albums[index].id,
                    name: albums[index].name
                }
                this.currentSelectedSongs = albums[index].songs
                const firstSong = this.currentSelectedSongs?.[0]
                if(firstSong?.common?.fileUrl)
                    this.getImgBase64(firstSong.common.fileUrl).then(res => {
                        this.currentSelectedFilePicUrl = res
                    }).catch(() => {})
            }
            if(type == 'localArtist') {
                const artists = this.localMusicClassify?.artists || []
                const index = artists.findIndex((item) => item.id == id)
                if(index == -1) return
                this.currentSelectedInfo = {
                    id: artists[index].id,
                    name: artists[index].name
                }
                this.currentSelectedSongs = artists[index].songs
                const firstSong = this.currentSelectedSongs?.[0]
                if(firstSong?.common?.fileUrl)
                    this.getImgBase64(firstSong.common.fileUrl).then(res => {
                        this.currentSelectedFilePicUrl = res
                    }).catch(() => {})
            }
        }
    },
})