import { defineStore } from "pinia";
import { getPlaylistDetail, getPlaylistAll, getRecommendSongs, playlistDynamic } from '../api/playlist'
import { getAlbumDetail, albumDynamic } from '../api/album'
import { getArtistDetail, getArtistFansCount, getArtistTopSong, getArtistAlbum } from '../api/artist'
import { getArtistMV } from '../api/mv'
import { mapSongsPlayableStatus } from "../utils/songStatus";

// 歌单/专辑/歌手详情加载序号：快速切换时丢弃过期响应，避免慢请求覆盖新数据
let detailRequestSeq = 0

export const useLibraryStore = defineStore('libraryStore', {
    state: () => {
        return {
            listType1: 0,
            listType2: 0,
            artistPageType: 0,
            libraryList: null,
            libraryListAlbum: null,
            libraryListAritist: null,
            playlistCount: null,
            playlistUserCreated: null,
            playlistUserSub: null,
            libraryInfo: null,
            librarySongs: null,
            libraryAlbum: null,
            libraryMV: null,
            needTimestamp: [],
            libraryChangeAnimation: false,
        }
    },
    actions: {
        changeAnimation() {
            this.libraryChangeAnimation = true
        },
        changeLibraryList(type) {
            if(type == 0) this.libraryList = this.playlistUserCreated
            else if (type == 1) this.libraryList = this.playlistUserSub
        },
        updateLibrary(libraryData) {
            this.libraryData = libraryData
        },
        updateUserPlaylistCount(listCount) {
            this.playlistCount = listCount
        },
        updateUserPlaylist(playlist) {
            // 使用 slice 非原地分割，避免修改调用方数组；计数缺失时降级为不分割
            const arr = playlist || []
            const created = this.playlistCount?.createdPlaylistCount
            const sub = this.playlistCount?.subPlaylistCount
            if(created == null && sub == null) {
                this.playlistUserCreated = arr
                this.playlistUserSub = []
                return
            }
            const createdCount = created || 0
            this.playlistUserCreated = arr.slice(0, createdCount)
            this.playlistUserSub = arr.slice(createdCount, createdCount + (sub || 0))
        },
        async updateLibraryDetail(id, routerName) {
            this.changeAnimation()
            if(routerName == 'playlist') await this.updatePlaylistDetail(id)
            if(routerName == 'album') await this.updateAlbumDetail(id)
            if(routerName == 'artist') await this.updateArtistDetail(id)
            this.artistPageType = 0
            this.libraryAlbum = null
            this.libraryMV = null
        },
        async updatePlaylistDetail(id) {
            const seq = ++detailRequestSeq
            let params = {
                id: id,
                limit: 1000,
                offset: 0,
                // timestamp: new Date().getTime()
            }
            try {
                await Promise.all([getPlaylistDetail(params), getPlaylistAll(params), playlistDynamic(id)]).then(async results => {
                    if(seq != detailRequestSeq) return // 已切换到其他歌单，丢弃过期响应
                    const playlist = results[0]?.playlist
                    if(!playlist) throw new Error('歌单不存在或已删除')
                    this.libraryInfo = playlist
                    this.librarySongs = mapSongsPlayableStatus(results[1].songs, results[1].privileges)
                    if(playlist.trackIds && playlist.trackIds.length > 1000) {
                        for (let i = 1; i < (playlist.trackIds.length / 1000); i++) {
                            const params = {
                                id: id,
                                limit: 1000,
                                offset: i * 1000,
                            }
                            const res = await getPlaylistAll(params)
                            if(seq != detailRequestSeq) return
                            const songs = mapSongsPlayableStatus(res.songs, res.privileges)
                            this.librarySongs = this.librarySongs.concat(songs)
                        }
                    }
                    if(seq != detailRequestSeq) return
                    this.libraryInfo.followed = results[2].subscribed
                    this.libraryChangeAnimation = false
                })
            } catch (e) {
                console.error('[library] 歌单详情加载失败', e)
                // 请求失败也要结束加载动画，避免页面卡在加载态
                if(seq == detailRequestSeq) this.libraryChangeAnimation = false
            }
        },
        async updateAlbumDetail(id) {
            const seq = ++detailRequestSeq
            let params = {
                id: id,
                // timestamp: new Date().getTime()
            }
            try {
                await Promise.all([getAlbumDetail(params), albumDynamic(id)]).then(results => {
                    if(seq != detailRequestSeq) return
                    this.libraryInfo = results[0].album
                    this.librarySongs = mapSongsPlayableStatus(results[0].songs)
                    this.libraryInfo.followed = results[1].isSub
                    this.libraryChangeAnimation = false
                })
            } catch (e) {
                console.error('[library] 专辑详情加载失败', e)
                if(seq == detailRequestSeq) this.libraryChangeAnimation = false
            }
        },
        async updateArtistDetail(id) {
            const seq = ++detailRequestSeq
            let params = {
                id: id,
                // timestamp: new Date().getTime()
            }
            try {
                await Promise.all([getArtistDetail(params), getArtistFansCount(id)]).then(results => {
                    if(seq != detailRequestSeq) return
                    results[0].artist.follow = results[1].data
                    results[0].artist.followed = results[1].data.follow
                    this.libraryInfo = results[0].artist
                    this.librarySongs = mapSongsPlayableStatus(results[0].hotSongs)
                    this.libraryChangeAnimation = false
                })
            } catch (e) {
                console.error('[library] 歌手详情加载失败', e)
                if(seq == detailRequestSeq) this.libraryChangeAnimation = false
            }
        },
        //获取歌手热门歌曲前50首，并更新Store数据
        async updateArtistTopSong(id) {
            let params = {
                id: id,
                // timestamp: new Date().getTime()
            }
            await getArtistTopSong(params).then(result => {
                this.librarySongs = mapSongsPlayableStatus(result.songs)
            }).catch(e => console.error('[library] 歌手热门歌曲加载失败', e))
        },
        //获取歌手专辑，并更新Store数据
        async updateArtistAlbum(id) {
            let params = {
                id: id,
                limit: 500,
                offset: 0
                // timestamp: new Date().getTime()
            }
            await getArtistAlbum(params).then(result => {
                this.libraryAlbum = result.hotAlbums
            }).catch(e => console.error('[library] 歌手专辑加载失败', e))
        },
        //获取歌手MV，并更新Store数据
        async updateArtistsMV(id) {
            let params = {
                id: id,
                limit: 500,
                offset: 0
                // timestamp: new Date().getTime()
            }
            await getArtistMV(params).then(result => {
                this.libraryMV = result.mvs
            }).catch(e => console.error('[library] 歌手MV加载失败', e))
        },
        async updateRecommendSongs() {
            await getRecommendSongs().then(result => {
                this.librarySongs = mapSongsPlayableStatus(result.data.dailySongs)
            }).catch(e => console.error('[library] 每日推荐加载失败', e))
        },
    },
})