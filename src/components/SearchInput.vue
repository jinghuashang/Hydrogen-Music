<script setup>
  import { ref, watch, onMounted, onUnmounted } from 'vue'
  import { useRouter } from 'vue-router';
  import { noticeOpen } from '../utils/dialog';
  import { search } from '../api/other';
  import { getNewestSong } from '../api/song';
  import { mapSongsPlayableStatus } from '../utils/songStatus';
  import { addSong, addToNext } from '../utils/player';
  import { usePlayerStore } from '../store/playerStore';
  import { isHydrogenWeb } from '../utils/webProfileNas'
  const playerStore = usePlayerStore()
  const isWebClient = isHydrogenWeb()
  const router = useRouter()

  const searchInput = ref(null)
  const searchShow = ref(false)
  const isHovering = ref(false)
  const searchKeyword = ref('')
  const searchResults = ref([])
  const recommendSongs = ref([])
  const isSearching = ref(false)
  const recommendLoaded = ref(false)
  const searchLimit = ref(10)
  let searchTimer = null

  onMounted(() => {
    loadRecommendSongs()
    windowApi.getSettings().then(settings => {
      if (settings && settings.music && settings.music.searchResultLimit) {
        searchLimit.value = settings.music.searchResultLimit
      }
    })
  })

  const showPreview = ref(false)

  function updatePreviewVisibility() {
    showPreview.value = searchShow.value || isHovering.value
  }

  function searchFoucs(event, state) {
    if (state === 'focus') {
        event.target.placeholder = ''
        searchShow.value = true
        if (!isWebClient) windowApi.unregisterShortcuts()
        if (!JTrim(searchKeyword.value) && !recommendLoaded.value) {
          loadRecommendSongs()
        }
    } else {
        if (!isWebClient) windowApi.registerShortcuts()
        event.target.placeholder = 'SEARCH'
        searchShow.value = false
        updatePreviewVisibility()
    }
  }

  function handleMouseEnter() {
    isHovering.value = true
    updatePreviewVisibility()
    if (!JTrim(searchKeyword.value) && !recommendLoaded.value && !searchShow.value) {
      loadRecommendSongs()
    }
  }

  function handleMouseLeave() {
    isHovering.value = false
    updatePreviewVisibility()
  }

  function JTrim(s) {
    return s.replace(/(^\s*)|(\s*$)/g, "");
  }

  const searchInfo = () => {
    if(JTrim(searchInput.value.value) != "") {
        router.push({name: 'search', query: {keywords: searchInput.value.value}})
        searchShow.value = false
        isHovering.value = false
        searchResults.value = []
        if(!playerStore.widgetState) {
          playerStore.widgetState = true
          playerStore.lyricShow = false
          if(playerStore.videoIsPlaying) playerStore.videoIsPlaying = false
        }
    } else {
        noticeOpen("输入不能为空", 2)
    }
  }

  const loadRecommendSongs = () => {
    if (recommendLoaded.value) return
    getNewestSong().then(data => {
      if (data && data.result) {
        recommendSongs.value = data.result.slice(0, searchLimit.value).map(item => ({
          id: item.id,
          name: item.name,
          ar: item.song ? item.song.artists : (item.artists || []),
          al: item.song ? item.song.album : (item.album || {}),
          dt: item.song ? item.song.duration : (item.duration || 0),
          playable: true
        }))
        recommendLoaded.value = true
      }
    }).catch(() => {})
  }

  const doSearchPreview = (keyword) => {
    if (!keyword || JTrim(keyword) === '') {
      searchResults.value = []
      return
    }
    isSearching.value = true
    search({
      keywords: keyword,
      type: 1,
      limit: searchLimit.value
    }).then(data => {
      if (data.result && data.result.songs) {
        searchResults.value = mapSongsPlayableStatus(data.result.songs)
      } else {
        searchResults.value = []
      }
    }).catch(() => {
      searchResults.value = []
    }).finally(() => {
      isSearching.value = false
    })
  }

  watch(searchKeyword, (newVal) => {
    if (searchTimer) clearTimeout(searchTimer)
    if (!newVal || JTrim(newVal) === '') {
      searchResults.value = []
      return
    }
    searchTimer = setTimeout(() => {
      doSearchPreview(newVal)
    }, 300)
  })

  onUnmounted(() => {
    if (searchTimer) clearTimeout(searchTimer)
  })

  const playSong = (song) => {
    if (!song.playable) {
      noticeOpen(song.reason || '无法播放', 2)
      return
    }
    const songData = {
      id: song.id,
      name: song.name,
      ar: song.ar,
      al: song.al,
      dt: song.dt,
      playable: true
    }
    addToNext(songData, true)
    searchShow.value = false
    isHovering.value = false
    searchResults.value = []
  }

  const formatArtists = (artists) => {
    if (!artists) return ''
    return artists.map(a => a.name).join('/')
  }

  const formatDuration = (ms) => {
    if (!ms) return ''
    const seconds = Math.floor(ms / 1000)
    const min = Math.floor(seconds / 60)
    const sec = seconds % 60
    return `${min}:${sec.toString().padStart(2, '0')}`
  }

  const isSuggestMode = () => JTrim(searchKeyword.value) !== ''
  const currentList = () => isSuggestMode() ? searchResults.value : recommendSongs.value
  const currentTitle = () => isSuggestMode() ? 'SEARCH' : 'RECOMMEND'
  const currentEmptyText = () => isSuggestMode() ? 'NO RESULT' : 'NO RECOMMEND'
  const currentLoading = () => isSearching.value
</script>

<template>
  <Transition name=fade>
    <div :class="{'search-container': true, 'search-container-foucs': searchShow}" v-show="playerStore.playerShow" @mouseenter="handleMouseEnter" @mouseleave="handleMouseLeave">
        <div class="search-input-wrapper">
          <input class="search-input" type="text" ref="searchInput" v-model="searchKeyword" @keyup.enter="searchInfo()" @focus="searchFoucs($event, 'focus')" @blur="searchFoucs($event, 'blur')" placeholder="SEARCH" spellcheck="false">
          <Transition name="assist-fade">
            <div class="search-preview" v-if="showPreview && (currentList().length > 0 || currentLoading() || isSuggestMode())">
              <div class="assist-corner assist-corner1"></div>
              <div class="assist-corner assist-corner2"></div>
              <div class="assist-corner assist-corner3"></div>
              <div class="assist-corner assist-corner4"></div>
              <div class="assist-header">
                <span class="assist-title">{{ currentTitle() }}</span>
                <span class="assist-count" v-if="currentList().length > 0">[{{ currentList().length }}]</span>
                <div class="assist-line"></div>
              </div>
              <div class="assist-body">
                <div class="assist-status" v-if="currentLoading()">LOADING...</div>
                <div class="assist-status" v-else-if="currentList().length === 0">{{ currentEmptyText() }}</div>
                <template v-else>
                  <div class="search-preview-item" v-for="(song, index) in currentList()" :key="song.id" @mousedown.prevent="playSong(song)" :class="{'unplayable': !song.playable}">
                    <span class="item-index">{{ String(index + 1).padStart(2, '0') }}</span>
                    <div class="song-info">
                      <span class="song-name">{{ song.name }}</span>
                      <span class="song-artist">{{ formatArtists(song.ar) }}</span>
                    </div>
                    <span class="song-duration" v-if="song.dt">{{ formatDuration(song.dt) }}</span>
                  </div>
                </template>
              </div>
            </div>
          </Transition>
        </div>
        <div class="search-border search-border1"></div>
        <div class="search-border search-border2"></div>
        <div class="search-border search-border3"></div>
        <div class="search-border search-border4"></div>
        <div class="search-border-2 search-border5"></div>
        <div class="search-border-2 search-border6"></div>
        <div class="search-border-2 search-border7"></div>
        <div class="search-border-2 search-border8"></div>
    </div>
  </Transition>
</template>

<style scoped lang="scss">
    $boderpx: 2 + Px;
    $boderPosition: -1Px;
  .search-container{
    width: 130Px;
    height: 20Px;
    position: relative;
    bottom: -3px;
    display: flex;
    transition: 0.3s cubic-bezier(.24,.97,.59,1);
    .search-input-wrapper{
        width: 100%;
        position: relative;
    }
    .search-input{
        width: 100%;
        padding: 0 10Px;
        color: black;
        border: none;
        border-style: none;
        background: none;
        outline: none;
        text-align: center;
        font: 12Px SourceHanSansCN-Bold;
        &::-webkit-input-placeholder{
            font: 12Px Geometos;
            color: black;
        }
    }
    .search-preview{
        --assist-bg: rgba(183, 208, 216, 0.56);
        --assist-border: rgba(62, 86, 94, 0.26);
        --assist-corner: rgba(38, 52, 58, 0.58);
        --assist-title: rgba(20, 34, 39, 0.92);
        --assist-muted: rgba(45, 64, 71, 0.64);
        --assist-line: rgba(55, 77, 84, 0.28);
        --assist-item-text: rgba(20, 34, 39, 0.9);
        --assist-item-divider: rgba(58, 80, 88, 0.14);
        --assist-hover-fill: rgba(52, 73, 80, 0.72);
        --assist-hover-text: rgba(244, 248, 250, 0.96);
        --assist-status: rgba(45, 64, 71, 0.66);
        --assist-shadow: 0 12px 24px rgba(43, 61, 68, 0.14);

        position: absolute;
        top: 30Px;
        left: 50%;
        transform: translateX(-50%);
        width: 280Px;
        max-height: 364Px;
        background: var(--assist-bg);
        backdrop-filter: blur(12px);
        border: 1px solid var(--assist-border);
        box-shadow: var(--assist-shadow);
        overflow: hidden;
        z-index: 1000;

        .assist-corner {
            width: 7px;
            height: 7px;
            position: absolute;
            border: 1px solid var(--assist-corner);
            z-index: 1;
        }
        .assist-corner1 {
            top: -1px;
            left: -1px;
            border-right: none;
            border-bottom: none;
        }
        .assist-corner2 {
            top: -1px;
            right: -1px;
            border-left: none;
            border-bottom: none;
        }
        .assist-corner3 {
            bottom: -1px;
            right: -1px;
            border-left: none;
            border-top: none;
        }
        .assist-corner4 {
            bottom: -1px;
            left: -1px;
            border-right: none;
            border-top: none;
        }

        .assist-header{
            height: 33px;
            display: flex;
            align-items: center;
            gap: 7px;
            padding: 0 12px;
            border-bottom: 1px solid var(--assist-border);
            .assist-title{
                font: 11px Bender-Bold, monospace;
                font-weight: bold;
                letter-spacing: 1.2px;
                color: var(--assist-title);
                white-space: nowrap;
            }
            .assist-count{
                font: 10px Bender-Bold, monospace;
                color: var(--assist-muted);
                white-space: nowrap;
            }
            .assist-line{
                height: 1px;
                flex: 1;
                background: linear-gradient(90deg, var(--assist-line), transparent);
            }
        }

        .assist-body{
            max-height: 330px;
            overflow-y: auto;
            overflow-x: hidden;
            scrollbar-width: none;
            &::-webkit-scrollbar{
                width: 0;
                height: 0;
                display: none;
            }
            .assist-status{
                height: 42px;
                display: flex;
                align-items: center;
                justify-content: center;
                font: 11px Bender-Bold, monospace;
                letter-spacing: 1px;
                color: var(--assist-status);
            }
            .search-preview-item{
                min-height: 32px;
                display: flex;
                flex-direction: row;
                align-items: center;
                padding: 6px 12px;
                cursor: pointer;
                transition: color 0.28s ease, background-size 0.32s cubic-bezier(0.22, 1, 0.36, 1);
                background-image: linear-gradient(90deg, var(--assist-hover-fill), var(--assist-hover-fill));
                background-repeat: no-repeat;
                background-size: 0 100%;
                border-bottom: 1px solid var(--assist-item-divider);
                &:last-child{
                    border-bottom: none;
                }
                &:hover{
                    color: var(--assist-hover-text);
                    background-size: 100% 100%;
                    .item-index, .song-artist, .song-duration{
                        color: var(--assist-hover-text);
                    }
                }
                &.unplayable{
                    opacity: 0.5;
                    cursor: not-allowed;
                }
                .item-index{
                    font: 10px Bender-Bold, monospace;
                    color: var(--assist-muted);
                    letter-spacing: 1px;
                    margin-right: 10px;
                    min-width: 20px;
                }
                .song-info{
                    flex: 1;
                    overflow: hidden;
                    display: flex;
                    flex-direction: column;
                    .song-name{
                        font: 12px SourceHanSansCN-Bold;
                        color: var(--assist-item-text);
                        white-space: nowrap;
                        overflow: hidden;
                        text-overflow: ellipsis;
                    }
                    .song-artist{
                        font: 10px SourceHanSansCN-Bold;
                        color: var(--assist-muted);
                        margin-top: 2px;
                        white-space: nowrap;
                        overflow: hidden;
                        text-overflow: ellipsis;
                    }
                }
                .song-duration{
                    font: 10px Bender-Bold;
                    color: var(--assist-muted);
                    margin-left: 12px;
                }
            }
        }
    }
    .search-border{
        width: 7Px;
        height: 7Px;
        position: absolute;
    }
    .search-border1{
        top: 0;
        left: 0;
        border: {
            top: $boderpx solid black;
            left: $boderpx solid black;
        };
    }
    .search-border2{
        top: 0;
        right: 0;
        border: {
            top: $boderpx solid black;
            right: $boderpx solid black;
        };
    }
    .search-border3{
        bottom: 0;
        right: 0;
        border: {
            bottom: $boderpx solid black;
            right: $boderpx solid black;
        };
    }
    .search-border4{
        bottom: 0;
        left: 0;
        border: {
            bottom: $boderpx solid black;
            left: $boderpx solid black;
        };
    }
    .search-border-2{
        width: 4Px;
        height: 4Px;
        background-color: black;
        position: absolute;
    }
    .search-border5{
        top: $boderPosition;
        left: $boderPosition;
    }
    .search-border6{
        top: $boderPosition;
        right: $boderPosition;

    }
    .search-border7{
        bottom: $boderPosition;
        right: $boderPosition;
    }
    .search-border8{
        bottom: $boderPosition;
        left: $boderPosition;
    }
  }
  .search-container-foucs{
    width: 160Px;
    .search-preview{
        width: 300Px;
    }
  }
  .assist-fade-enter-active,
  .assist-fade-leave-active {
    transition: 0.18s ease;
  }
  .assist-fade-enter-from,
  .assist-fade-leave-to {
    opacity: 0;
    transform: translateX(-50%) translateY(-4px);
  }
  .fade-enter-active,
  .fade-leave-active {
    transition: 0.2s;
  }

  .fade-enter-from,
  .fade-leave-to {
    transform: scale(0.9);
    opacity: 0;
  }
</style>
