export function preparePlayerForMv(playerStore, otherStore, unloadMusicVideo) {
  playerStore.addMusicVideo = null
  playerStore.widgetState = true
  playerStore.playlistWidgetShow = false
  playerStore.lyricShow = false
  playerStore.videoIsPlaying = false
  playerStore.playerShow = true
  unloadMusicVideo()

  otherStore.videoPlayerShow = false
  otherStore.player = null
  otherStore.currentVideoId = null
}
