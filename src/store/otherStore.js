import { defineStore } from 'pinia'
import { getMVDetail, getMVUrl } from '../api/mv'
import { search } from '../api/other';
import { mapSongsPlayableStatus } from '../utils/songStatus';

// 搜索请求序号：丢弃慢响应，避免旧搜索结果覆盖新搜索
let searchRequestSeq = 0

export const useOtherStore = defineStore('otherStore', {
    state: () => {
        return {
          screenWidth: 1056,
          contextMenuShow: false,
          menuTree: null,
          tree1: [
            {
                id: 1,
                name: '播放'
            },
            {
                id: 2,
                name: '下一首播放'
            },
            {
                id: 3,
                name: '下载'
            },
            {
                id: 4,
                name: '添加到歌单'
            },
            {
                id: 5,
                name: '从歌单中删除'
            }
          ],
          tree2: [
            {
                id: 1,
                name: '播放'
            },
            {
                id: 2,
                name: '下一首播放'
            },
            {
                id: 3,
                name: '下载'
            },
            {
                id: 4,
                name: '添加到歌单'
            }
          ],
          tree3: [
            {
                id: 6,
                name: '新建歌单'
            },
            {
                id: 7,
                name: '删除此歌单'
            }
          ],
          tree4: [
            {
                id: 8,
                name: '播放'
            },
            {
                id: 9,
                name: '下一首播放'
            },
            {
                id: 10,
                name: '打开本地文件夹'
            }
          ],
          selectedPlaylist: null,
          selectedItem: null,
          addPlaylistShow: false,
          dialogShow: false,
          dialogHeader: null,
          dialogText: null,
          noticeShow: false,
          noticeText: null,
          niticeOutAnimation: false,
          videoPlayerShow: false,
          player: null,
          videoIsBlur: false,
          currentVideoId: null,
          videoIsFull: false,
          searchResult: {},
          toUpdate: false,
          newVersion: null,
          updateDownloadUrl: null,
          updateDigest: '',
          updateIsWindows: false,
          releaseBody: '',
          autoUpdateStatus: null,
          autoUpdateProgress: 0,
          autoUpdateTotalSize: '',
          autoUpdateDownloadedSize: '',
          autoUpdateError: null,
        }
    },
    actions: {
        // setRem() {
        //     const scale = this.screenWidth / 16
        //     const htmlWidth = document.documentElement.clientWidth || document.body.clientWidth
        //     const htmlDom = document.getElementsByTagName('html')[0]
        //     htmlDom.style.fontSize = htmlWidth / scale + 'px'
        // },
        getMvData(id) {
            this.videoPlayerShow = true
            this.currentVideoId = id
            getMVDetail(id).then(async(detail) => {
                const brs = detail?.data?.brs || []
                // 并行获取各码率地址，单个失败不阻塞整体
                const results = await Promise.all(brs.map(b => getMVUrl(id, b.br).catch(() => null)))
                let sources = []
                results.forEach(res => {
                    if(res?.data?.url) {
                        sources.push({
                            src: res.data.url,
                            type: "video/mp4",
                            size: res.data.r
                        })
                    }
                })
                if(!this.player) {
                    console.warn('[mv] 播放器尚未就绪，放弃设置视频源')
                    return
                }
                this.player.source = {
                    type: 'video',
                    title: detail?.data?.name,
                    sources: sources,
                    poster: detail?.data?.cover
                }
            }).catch(e => {
                console.error('[mv] MV 加载失败', e)
            })
        },
        getSearchInfo(keywords) {
            const seq = ++searchRequestSeq
            let types = [1, 10, 100, 1000, 1004]
            types.forEach(type => {
                let params = {
                    keywords: keywords,
                    type: type,
                }
                if(type == 100) params.limit = 10
                if(type == 1000) params.limit = 10
                if(type == 1004) params.limit = 10
                search(params).then(data => {
                    if(seq != searchRequestSeq) return // 已发起新搜索，丢弃过期结果
                    if(type == 1) {
                        this.searchResult.searchSongs = mapSongsPlayableStatus(data.result.songs)
                    }
                    if(type == 10) this.searchResult.searchAlbums = data.result.albums
                    if(type == 100) this.searchResult.searchArtists = data.result.artists
                    if(type == 1000) this.searchResult.searchPlaylists = data.result.playlists
                    if(type == 1004) this.searchResult.searchMvs = data.result.mvs
                }).catch(e => {
                    console.warn('[search] 搜索失败', type, e)
                })
            });
        }
    },
})
