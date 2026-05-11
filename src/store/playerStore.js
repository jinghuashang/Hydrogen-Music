import { defineStore } from "pinia";

export const usePlayerStore = defineStore('playerStore', {
    state: () => {
        return {
            widgetState: true,//是否开启widget
            currentMusic: null,//播放列表的索引
            playing: false,//是否正在播放
            progress: 0,//进度条
            volume: 0.3,//音量
            // volumeBeforeMuted: 0,//静音前音量
            playMode: 0,//0为顺序播放，1为列表循环，2为单曲循环，3为随机播放
            listInfo: null,
            songList: null,//播放列表
            shuffledList: null,//随机播放列表
            shuffleIndex: 0,//随机播放列表的索引
            songId: null,
            currentIndex: 0,
            time: 0, //歌曲总时长
            quality: null,
            playlistWidgetShow: false,
            playerChangeSong: false, //player页面切换歌曲更换歌名动画,
            lyric: null,
            lyricsObjArr: null,
            lyricSize: null,
            tlyricSize: null,
            rlyricSize: null,
            lyricType: ['original'],
            lyricInterludeTime: null, //歌词间奏等待时间
            lyricShow: false, //歌词是否显示
            lyricEle: null,//歌词DOM
            isLyricDelay: true, //调整进度的时候禁止赋予delay属性
            localBase64Img: null, //如果是本地歌曲，获取封面
            forbidLastRouter: false, //在主动跳转router时禁用回到上次离开的路由的地址功能
            musicVideo: false,
            addMusicVideo: false,
            currentMusicVideo: null,
            musicVideoDOM: null,
            videoIsPlaying: false,
            playerShow: true,
            coverBlur: false,
            lyricBlur: false,
            coverUrl: null,
            /** Web：全屏播放页过渡；`webRightEmbed` 从右侧分栏进入（横向滑入），`widget` 从底栏进入（沿用 translateY） */
            fullPlayerOpenSource: null,
            /** Web 主页分栏右侧嵌入：为 true 时不启用音乐视频层与封面模糊（不写入 persist） */
            webHomeSplitEmbed: false,
        }
    },
    actions: {
    },
    persist: {
        storage: localStorage,
        paths: ['progress','volume','playMode','shuffleIndex','listInfo','songId','currentIndex','time','quality','lyricType','musicVideo','coverBlur','lyricBlur']
    },
})
