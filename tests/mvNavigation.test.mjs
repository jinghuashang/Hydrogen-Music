import test from 'node:test'
import assert from 'node:assert/strict'
import { preparePlayerForMv } from '../src/utils/mvNavigation.mjs'

test('prepares the player for MV without mutating audio, playback, or lyric state', () => {
  const lyricsObjArr = [{ lyric: 'Timed line', time: 12 }]
  const lyricEle = { current: true }
  const lyric = { lrc: { lyric: '[00:12.00]Timed line' } }
  const currentMusic = { seek: () => 12 }
  const playerStore = {
    addMusicVideo: null,
    widgetState: false,
    playlistWidgetShow: true,
    lyricShow: true,
    videoIsPlaying: true,
    playerShow: false,
    songId: 9,
    currentIndex: 3,
    currentMusic,
    playing: true,
    progress: 12,
    time: 220,
    lyric,
    lyricsObjArr,
    lyricEle,
    currentMusicVideo: { path: 'video.mp4' },
  }
  const otherStore = {
    videoPlayerShow: true,
    player: { destroy() {} },
    currentVideoId: 'BV123',
  }
  let videoUnloadCount = 0
  const unloadMusicVideo = () => {
    videoUnloadCount++
    playerStore.currentMusicVideo = null
    playerStore.videoIsPlaying = false
    playerStore.playerShow = true
  }

  preparePlayerForMv(playerStore, otherStore, unloadMusicVideo)

  assert.equal(videoUnloadCount, 1)
  assert.equal(playerStore.widgetState, true)
  assert.equal(playerStore.playlistWidgetShow, false)
  assert.equal(playerStore.lyricShow, false)
  assert.equal(playerStore.videoIsPlaying, false)
  assert.equal(playerStore.playerShow, true)
  assert.equal(playerStore.songId, 9)
  assert.equal(playerStore.currentIndex, 3)
  assert.equal(playerStore.currentMusic, currentMusic)
  assert.equal(playerStore.playing, true)
  assert.equal(playerStore.progress, 12)
  assert.equal(playerStore.time, 220)
  assert.equal(playerStore.lyric, lyric)
  assert.equal(playerStore.lyricsObjArr, lyricsObjArr)
  assert.equal(playerStore.lyricEle, lyricEle)
  assert.equal(playerStore.currentMusicVideo, null)
  assert.equal(otherStore.videoPlayerShow, false)
  assert.equal(otherStore.player, null)
  assert.equal(otherStore.currentVideoId, null)
})
