<script setup>
  import { computed, ref, onMounted } from 'vue'
  import { RecycleScroller } from 'vue-virtual-scroller'
  import 'vue-virtual-scroller/dist/vue-virtual-scroller.css'
  import { songTime } from '../utils/player'
  import { nanoid } from 'nanoid'
  import { addToList, addSong, setShuffledList, addToNext } from '../utils/player'
  import { noticeOpen } from '../utils/dialog'
  import { useRouter, useRoute } from 'vue-router'
  import { useUserStore } from '../store/userStore';
  import { useLibraryStore } from '../store/libraryStore'
  import { usePlayerStore } from '../store/playerStore';
  import { useOtherStore } from '../store/otherStore';
  import { storeToRefs } from 'pinia'

  const router = useRouter()
  const userStore = useUserStore()
  const libraryStore = useLibraryStore()
  const { libraryInfo } = storeToRefs(libraryStore)
  const playerStore = usePlayerStore()
  const { songId, playMode } =storeToRefs(playerStore)
  const otherStore = useOtherStore()
  const props = defineProps(['songlist', 'type'])

  const unblockEnabled = ref(true)
  onMounted(async () => {
    try {
      const settings = await windowApi.getSettings()
      unblockEnabled.value = settings?.unblock?.enabled !== false
    } catch (_) {}
  })

  const getData = computed(() => {
    props.songlist.map((item) => {
      if(!item.nid)
        Object.assign(item, {nid: nanoid()})
    })
    return props.songlist
  })

  // 歌单内搜索：仅「我的音乐 → 歌单详情」展示（专辑/歌手/搜索结果页不显示）
  const route = useRoute()
  const isPlaylistPage = computed(() => route.name == 'playlist')
  const searchText = ref('')
  const searchTokens = computed(() => searchText.value.trim().toLowerCase().split(/\s+/).filter(Boolean))
  // 歌名 / 歌手 / 专辑 包含匹配；空白分隔的多个关键词需全部命中（AND）
  const matchSong = (song, token) => {
    const artists = Array.isArray(song.ar) ? song.ar : (Array.isArray(song.artists) ? song.artists : [])
    const album = (song.al && song.al.name) || (song.album && song.album.name) || ''
    const fields = [song.name, song.songName, song.localName, song.title, album]
      .concat(artists.map((a) => (a && a.name) || a))
    return fields.some((f) => typeof f === 'string' && f.toLowerCase().includes(token))
  }
  // 过滤条件变化时重建虚拟列表：v3 RecycleScroller 对 items 整体替换不会重算可见项
  const searchKey = computed(() => (isPlaylistPage.value ? searchText.value.trim().toLowerCase() : ''))
  // 过滤后仍携带原歌单下标，播放时不会串位
  const displayItems = computed(() => {
    const list = getData.value || []
    const tokens = searchTokens.value
    const rows = list.map((song, index) => ({ song, index, nid: song.nid }))
    if (!isPlaylistPage.value || !tokens.length) return rows
    return rows.filter(({ song }) => tokens.every((t) => matchSong(song, t)))
  })

  const checkArtist = (artistId) => {
    router.push('/mymusic/artist/' + artistId)
    playerStore.forbidLastRouter = true
  }
  const play = (song, index) => {
    if (!unblockEnabled.value && song.playable === false) {
      noticeOpen(song.reason || '无法播放', 2)
      return
    }
    if(props.type == 'search') {addToNext(song, true);return}
    addToList(router.currentRoute.value.name, props.songlist)
    addSong(song.id, index, true)
    if(playMode.value == 3) setShuffledList()
  }

  const openMenu = (e, item) => {
    otherStore.contextMenuShow = true
    otherStore.selectedItem = item
    otherStore.selectedPlaylist = libraryInfo.value

    if(otherStore.selectedPlaylist && otherStore.selectedPlaylist.creator && otherStore.selectedPlaylist.creator.userId == userStore.user.userId) otherStore.menuTree = otherStore.tree1
    else otherStore.menuTree = otherStore.tree2
    
    const { clientX, clientY } = e
    const menuList = document.getElementById('menu')
    const screenWidth = document.body.clientWidth
    const screenHeight = document.body.clientHeight
    if(screenWidth - clientX < 120) {
      menuList.style.left = screenWidth - 120 + 'Px'
      menuList.style.right = null
    } else {
      menuList.style.right = null
      menuList.style.left = clientX + 'Px'
    }
    if(screenHeight - clientY < 240) {
      menuList.style.top = screenHeight - 240 + 'Px'
      menuList.style.bottom = null
    } else {
      menuList.style.bottom = null
      menuList.style.top = clientY + 'Px'
    }
  }
</script>

<template>
  <div class="library-content">
    <div class="list-search" v-if="isPlaylistPage">
      <svg class="search-icon" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" width="200" height="200"><path d="M909.6 854.5L649.9 594.8C690.2 542.7 712 479 712 412c0-80.2-31.3-155.4-87.9-212.1-56.6-56.7-132-87.9-212.1-87.9s-155.5 31.3-212.1 87.9C143.2 256.5 112 331.8 112 412c0 80.1 31.3 155.5 87.9 212.1C256.5 680.8 331.8 712 412 712c67 0 130.6-21.8 182.7-62l259.7 259.6a8.2 8.2 0 0 0 11.6 0l43.6-43.5a8.2 8.2 0 0 0 0-11.6zM570.4 570.4C528 612.7 471.8 636 412 636s-116-23.3-158.4-65.6C211.3 528 188 471.8 188 412s23.3-116.1 65.6-158.4C296 211.3 352.2 188 412 188s116.1 23.2 158.4 65.6S636 352.2 636 412s-23.3 116.1-65.6 158.4z" p-id="5372" fill="currentColor"></path></svg>
      <input v-model="searchText" type="text" placeholder="在歌单内搜索歌曲" @keydown.esc="searchText = ''" />
      <span class="search-count" v-if="searchText.trim()">{{ displayItems.length }}/{{ (props.songlist || []).length }}</span>
      <div class="search-clear" v-if="searchText" @click="searchText = ''">×</div>
    </div>
    <RecycleScroller
      v-if="props.songlist"
      id="libraryScroll"
      class="library-song-list"
      :key="searchKey"
      :items="displayItems"
      :item-size="44"
      key-field="nid"
      v-slot="{ item }"
    >
      <div class="list-item" :class="{'list-item-playing': songId == item.song.id, 'unplayable': !unblockEnabled && item.song.playable === false}" @dblclick="play(item.song, item.index)" @contextmenu="openMenu($event,item.song)">
        <div class="item-title">
            <div class="item-state">
              <svg v-show="(songId == item.song.id)" t="1669115475194" class="icon" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" p-id="10562" width="200" height="200"><path d="M158.249961 614.402466c37.219322 0 67.372153 30.559802 67.372153 68.272422v273.065023c0 37.700288-30.152831 68.260089-67.372153 68.260089S90.865475 993.440198 90.865475 955.739911V682.674888a68.753387 68.753387 0 0 1 19.731914-48.269194 66.977515 66.977515 0 0 1 47.652572-20.003228zM394.083329 0.04933c37.20699 0 67.372153 30.572134 67.372153 68.272422v887.418159c0 37.700288-30.165163 68.260089-67.372153 68.260089s-67.322823-30.559802-67.322824-68.260089V68.272422c0-37.700288 30.103501-68.223092 67.322824-68.223092zM629.916696 273.077355c37.20699 0 67.384486 30.559802 67.384486 68.260089v614.402467c0 37.700288-30.177496 68.260089-67.384486 68.260089s-67.384486-30.559802-67.384486-68.260089v-614.402467c0-37.700288 30.165163-68.260089 67.384486-68.260089z m235.833368-136.544844a66.878855 66.878855 0 0 1 47.640239 20.003228 68.704057 68.704057 0 0 1 19.731914 48.269194v750.934978c0 37.700288-30.177496 68.260089-67.384486 68.260089s-67.384486-30.559802-67.384486-68.260089V204.767936a68.753387 68.753387 0 0 1 19.731914-48.269195 66.928185 66.928185 0 0 1 47.652572-20.003227z m0 0" p-id="10563"></path></svg>
              <div class="item-num" v-show="!(songId == item.song.id)">{{ item.index + 1 }}</div>
            </div>
            <span class="item-name">
              <span>{{item.song.name}}</span>
            </span>
        </div>
        <div class="item-other">
            <div class="item-author" v-if="item.song.ar">
              <span class="item-singer" @click="checkArtist(singer.id)" v-for="(singer, singerIndex) in item.song.ar" :key="singerIndex">{{singer.name}}{{singerIndex == item.song.ar.length -1 ? '' : '/'}}</span>
            </div>
            <span class="item-time">{{songTime(item.song.dt || item.song.duration)}}</span>
        </div>
      </div>
    </RecycleScroller>
    <div class="list-empty" v-if="isPlaylistPage && searchText.trim() && !displayItems.length">未找到匹配的歌曲</div>
  </div>
</template>

<style scoped lang="scss">
  .library-content{
    width: 100%;
    height: 100%;
    display: flex;
    flex-direction: column;
    .list-search{
        flex: 0 0 auto;
        display: flex;
        align-items: center;
        margin-bottom: 6px;
        padding: 0 8px;
        height: 32px;
        border-bottom: 0.5px solid rgba(0, 0, 0, 0.2);
        .search-icon{
            flex: 0 0 auto;
            width: 15px;
            height: 15px;
            margin-right: 8px;
            opacity: 0.45;
        }
        input{
            flex: 1 1 auto;
            min-width: 0;
            height: 100%;
            background: transparent;
            border: none;
            outline: none;
            font: 13px SourceHanSansCN-Bold;
            color: black;
            &::placeholder{
                color: rgba(0, 0, 0, 0.35);
                font: 13px SourceHanSansCN-Bold;
            }
        }
        .search-count{
            flex: 0 0 auto;
            margin-left: 8px;
            font: 12px SourceHanSansCN-Bold;
            color: rgba(0, 0, 0, 0.45);
        }
        .search-clear{
            flex: 0 0 auto;
            margin-left: 8px;
            width: 18px;
            height: 18px;
            line-height: 16px;
            text-align: center;
            font-size: 15px;
            color: rgba(0, 0, 0, 0.45);
            &:hover{
                cursor: pointer;
                color: black;
            }
        }
    }
    .list-empty{
        flex: 1 1 auto;
        display: flex;
        align-items: center;
        justify-content: center;
        font: 13px SourceHanSansCN-Bold;
        color: rgba(0, 0, 0, 0.45);
    }
    .library-song-list{
        flex: 1 1 auto;
        min-height: 0;
        overflow: auto;
        &::-webkit-scrollbar {
          width: 5px;
          height: 10px;
          background-color: rgba(0, 0, 0, 0);
        }
        &::-webkit-scrollbar-thumb {
          background-color: rgba(0, 0, 0, 0.0);
        }
        &::-webkit-scrollbar-track {
          display: none;
        }
        &:hover::-webkit-scrollbar-thumb{
          background-color: rgba(0, 0, 0, 0.04);
        }
        .list-item{
          padding: 12Px 8Px;
          display: flex;
          flex-direction: row;
          justify-content: space-between;
          align-items: center;
          transition: 0.2s;
          user-select: text;
          &:hover{
            cursor: default;
            background-color: rgba(0, 0, 0, 0.045);
          }
          &.unplayable{
            opacity: 0.5;
            cursor: not-allowed;
          }
          .item-title{
            width: 50%;
            display: flex;
            flex-direction: row;
            align-items: center;
            svg{
              width: 14Px;
              height: 14Px;
            }
            .item-state{
              width: 26Px;
              .item-num{
                font: 14Px Geometos;
                color: rgb(127, 127, 127);
              }
            }
            .item-name{
              width: calc(100% - 26Px - 14Px);
              margin-left: 14Px;
              font: 14Px SourceHanSansCN-Bold;
              font-weight: bold;
              color: black;
              overflow: hidden;
              text-align: left;
              overflow: hidden;
              display: -webkit-box;
              -webkit-box-orient: vertical;
              -webkit-line-clamp: 1;
              word-break: break-all;
            }
          }
          .item-other{
            margin-left: 14Px;
            width: 45%;
            display: flex;
            flex-direction: row;
            justify-content: space-between;
            span{
              font: 14Px SourceHanSansCN-Bold;
              font-weight: bold;
              color: black;
            }
            .item-author{
              width: 70%;
              text-align: left;
              overflow: hidden;
              display: -webkit-box;
              -webkit-box-orient: vertical;
              -webkit-line-clamp: 1;
              word-break: break-all;
              .item-singer{
                transition: 0.1s;
                &:hover{
                  cursor: pointer;
                  opacity: 0.6;
                }
              }
            }
            .item-time{
              width: 30%;
            }
          }
        }
        .list-item:last-child{
          margin-bottom: 10Px;
        }
        .list-item-playing{
          background-color: rgba(0, 0, 0, 0.045);
        }
    }
  }
</style>