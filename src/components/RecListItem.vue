<script setup>
  import { onActivated, onUnmounted, ref } from 'vue'
  import { useRouter } from 'vue-router';
  import { getNewAlbum } from '../api/album';
  import { getRecommendedArtists } from '../api/artist';
  import {
    getRecommendedSongList,
    getHomepageBlockPage,
    getRecommendResource,
    playlistsFromHomepageBlockPage,
    playlistsFromRecommendResource,
    artistsFromHomepageBlockPage,
    albumsFromHomepageBlockPage,
    mergePlaylistsById,
    getTopList,
  } from '../api/playlist'
  import { isLogin } from '../utils/authority'
  import { useLibraryStore } from '../store/libraryStore'
  import { useLocalStore } from '../store/localStore';
  import { usePlayerStore } from '../store/playerStore';
  const libraryStore = useLibraryStore()
  const localStore = useLocalStore()
  const playerStore = usePlayerStore()
  const router = useRouter()
  //0为歌单,1为歌手,2为专辑,3为排行榜
  const props = defineProps(['recType'])
  const recType = ref(props.recType)
  const recTitle = ref('')
  const recTitleEN = ref('')
  const recommendationList = ref([{}])
  const isRefreshing = ref(false)
  let refreshTimer = null

  onActivated(() => {
    /**
     * 第一个参数为推荐歌手的国家,第二个为推荐歌单请求数量，第三个为最新专辑的国家，
     * 最后为当前列表的类型
     */
    loadData(1, 10, 'all', recType.value)
    // 设置半小时自动刷新
    if (refreshTimer) clearInterval(refreshTimer)
    refreshTimer = setInterval(() => {
      loadData(1, 10, 'all', recType.value)
    }, 30 * 60 * 1000)
  })

  onUnmounted(() => {
    if (refreshTimer) {
      clearInterval(refreshTimer)
      refreshTimer = null
    }
  })

  const refreshData = () => {
    if (isRefreshing.value) return
    isRefreshing.value = true
    loadData(1, 10, 'all', recType.value).finally(() => {
      isRefreshing.value = false
    })
  }
  //设置标题
  const setTitle = (cn, en) => {
    recTitle.value = cn
    recTitleEN.value = en
  }
  //随机选取数据
  const shuffleData = (originData, limit, total) => {
    let indexs = [];
    while (indexs.length < limit) {
        let num = parseInt(Math.random() * total)
        if (!indexs.includes(num)) indexs.push(num)
        else indexs = [];
    }
    return originData.filter((item,index) => {
        return indexs.includes(index)
    });
  }

  //加载数据
  async function loadData(artistNation,limit,albumNation,recType) {
    if(recType == 0) {
        let playlists = []
        if (isLogin()) {
            try {
                const hp = await getHomepageBlockPage(true)
                playlists = playlistsFromHomepageBlockPage(hp)
            } catch {
                playlists = []
            }
            if (playlists.length < limit) {
                try {
                    const resourceBody = await getRecommendResource()
                    const more = playlistsFromRecommendResource(resourceBody)
                    playlists = mergePlaylistsById(playlists, more, limit)
                } catch {
                    /* 保持已有 playlists */
                }
            }
        }
        if (playlists.length < limit) {
            const listData = await getRecommendedSongList(limit)
            playlists = mergePlaylistsById(
                playlists,
                listData.result || [],
                limit,
            )
        }
        recommendationList.value = playlists.slice(0, limit)
        setTitle("推荐歌单", "RECOMMENDED SONG LIST")
    } else if(recType == 1) {
        const poolLimit = 50
        let artists = []
        if (isLogin()) {
            try {
                const hp = await getHomepageBlockPage(true)
                artists = artistsFromHomepageBlockPage(hp)
            } catch {
                artists = []
            }
        }
        if (artists.length < poolLimit) {
            const listData = await getRecommendedArtists(artistNation)
            artists = mergePlaylistsById(
                artists,
                listData.artists || [],
                poolLimit,
            )
        }
        setTitle("推荐歌手", "RECOMMENDED ARTISTS")
        const pick = Math.min(5, artists.length)
        if (pick === 0) recommendationList.value = []
        else
            recommendationList.value = shuffleData(
                artists,
                pick,
                artists.length,
            )
    } else if(recType == 2) {
        let albums = []
        if (isLogin()) {
            try {
                const hp = await getHomepageBlockPage(true)
                albums = albumsFromHomepageBlockPage(hp)
            } catch {
                albums = []
            }
        }
        if (albums.length < limit) {
            const listData = await getNewAlbum({
                limit: limit,
                area: albumNation,
            })
            albums = mergePlaylistsById(
                albums,
                listData.albums || [],
                limit,
            )
        }
        setTitle("最新专辑", "NEWEST ALBUM")
        recommendationList.value = albums.slice(0, limit)
    } else if(recType == 3) {
        const listData = await getTopList()
        setTitle("排行榜", "TOP LIST")
        //选取指定排行榜
        let indexs = [0,3,8,11,15]
        recommendationList.value = listData.list.filter((item,index) => {
            return indexs.includes(index)
        });;
    }
    // console.log(recommendationList.value)
  }

  const checkDetail = (id) => {
    libraryStore.libraryInfo = null
    localStore.currentSelectedSongs = null
    if(props.recType == 0) router.push('/mymusic/playlist/' + id)
    if(props.recType == 1) router.push('/mymusic/artist/' + id)
    if(props.recType == 2) router.push('/mymusic/album/' + id)
    if(props.recType == 3) router.push('/mymusic/playlist/' + id)
    playerStore.forbidLastRouter = true
  }
  const checkArtist = (artistId) => {
    router.push('/mymusic/artist/' + artistId)
    playerStore.forbidLastRouter = true
  }
</script>

<template>
  <div class="rec-list-item">
    <div class="item-header">
        <div class="header">
            <div class="header-title-en">{{recTitleEN}}</div>
            <div class="line"></div>
            <div class="header-refresh" @click="refreshData()" :class="{'refreshing': isRefreshing}">
              <svg viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg" width="14" height="14">
                <path d="M934.4 193.6v225.6c0 8-6.4 14.4-14.4 14.4h-225.6c-8 0-14.4-6.4-14.4-14.4s6.4-14.4 14.4-14.4h177.6c-33.6-100.8-129.6-172.8-241.6-172.8-142.4 0-257.6 115.2-257.6 257.6s115.2 257.6 257.6 257.6c62.4 0 120-22.4 164.8-59.2 6.4-5.6 7.2-15.2 1.6-21.6-5.6-6.4-15.2-7.2-21.6-1.6-38.4 31.2-87.2 50.4-140 50.4-121.6 0-220.8-99.2-220.8-220.8s99.2-220.8 220.8-220.8c92.8 0 173.6 58.4 205.6 140.8v-143.2c0-8 6.4-14.4 14.4-14.4s14.4 6.4 14.4 14.4zM516.8 830.4c-121.6 0-220.8-99.2-220.8-220.8s99.2-220.8 220.8-220.8c62.4 0 120-22.4 164.8-59.2 6.4-5.6 7.2-15.2 1.6-21.6-5.6-6.4-15.2-7.2-21.6-1.6-38.4 31.2-87.2 50.4-140 50.4-142.4 0-257.6 115.2-257.6 257.6s115.2 257.6 257.6 257.6c92.8 0 173.6-58.4 205.6-140.8v143.2c0 8 6.4 14.4 14.4 14.4s14.4-6.4 14.4-14.4v-225.6c0-8-6.4-14.4-14.4-14.4h-225.6c-8 0-14.4 6.4-14.4 14.4s6.4 14.4 14.4 14.4h177.6c-33.6 100.8-129.6 172.8-241.6 172.8z" fill="currentColor"/>
              </svg>
              <span>刷新</span>
            </div>
        </div>
        <div class="header-title-cn">{{recTitle}}</div>
    </div>
    <div class="item-list">
        <div class="item" v-for="(item,index) in recommendationList">
            <div class="item-img" :class="recType == 1 ? 'item-img-circle' : 'item-img-sqaure'" @click="checkDetail(item.id)">
                <img v-if="item && (item.coverImgUrl || item.img1v1Url || item.picUrl)" :src="(item.coverImgUrl || item.img1v1Url || item.picUrl) + '?param=450y450'" alt="">
            </div>
            <div class="item-name" :class="{'item-name-center': recType == 1}">{{item.name}}</div>
            <div class="item-sub" @click="checkArtist(item.artist.id)" v-if="item.artist">{{ item.artist.name }}</div>
            <div class="item-sub" v-else>{{ item.updateFrequency}}</div>
        </div>
    </div>
  </div>
</template>

<style scoped lang="scss">
  @keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }
  .rec-list-item{
    .item-header{
        .header{
            width: 100%;
            display: flex;
            flex-direction: row;
            align-items: center;
            .header-title-en{
                margin-right: 6px;
                padding: 1px 0 1px 2px;
                width: 20cqw;
                background-color: black;
                font: 0.7cqw Geometos;
                color: white;
                text-align: left;
                white-space: nowrap;
            }
            .line{
                width: 100%;
                height: 1px;
                background-color: rgb(176 176 176);
            }
            .header-refresh{
                display: flex;
                flex-direction: row;
                align-items: center;
                gap: 4px;
                padding: 4px 10px;
                font: 10px SourceHanSansCN-Bold;
                color: rgb(112 112 112);
                transition: 0.2s;
                white-space: nowrap;
                &:hover{
                    cursor: pointer;
                    color: black;
                }
                &.refreshing{
                    opacity: 0.6;
                    cursor: not-allowed;
                    svg{
                        animation: spin 1s linear infinite;
                    }
                }
                svg{
                    width: 12px;
                    height: 12px;
                }
            }
            .header-more{
                width: 60px;
                text-align: right;
                font: 10px SourceHanSansCN-Bold;
                color: rgb(112 112 112);
                transition: 0.2s;
                &:hover{
                    cursor: pointer;
                    color: black;
                }
            }
        }
        .header-title-cn{
            text-align: left;
            font: 2.1cqw SourceHanSansCN-Bold;
            line-height: 2.5cqw;
            color: black;
        }
    }
    .item-list{
        margin-top: 13px;
        width: 100%;
        display: grid;
        grid-template-columns: repeat(5, 1fr);
        gap: 3.4cqw 2.5cqw;
        .item{
            .item-img{
                // width: 168px;
                // height: 168px;
                overflow: hidden;
                transition: 0.2s;
                &:hover{
                    cursor: pointer;
                    box-shadow: 0 0 10Px 1Px rgba(0, 0, 0, 0.1);
                }
                img{
                    width: 100%;
                    height: 100%;
                    border: 1px solid rgba(0,0,0,0.04);
                    vertical-align: bottom;
                }
            }
            .item-img-sqaure{
                border-radius: 0;
            }
            .item-img-circle{
                border-radius: 50%;
                img{
                    border-radius: 50%;
                }
            }
            .item-name,.item-sub{
                margin-top: 5px;
                text-align: left;
                font: 1.5cqw SourceHanSansCN-Bold;
                font-weight: bold;
                color: black;
                overflow: hidden;
                display: -webkit-box;
                -webkit-box-orient:vertical;
                -webkit-line-clamp: 2;
                word-break: break-all;
                transition: 0.2s;
                &:hover{
                    cursor: pointer;
                    color: rgba(43, 43, 43, 1);
                }
            }
            .item-name-center{
                margin-top: 15px;
                text-align: center;
            }
            .item-sub{
                font: 1.2cqw Source Han Sans;
                font-weight: normal;
                color: rgb(109, 109, 109);
                &:hover{
                    color: black;
                }
            }
        }
    }
  }
</style>
