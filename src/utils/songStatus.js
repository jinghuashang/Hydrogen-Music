function checkSongPlayable(song, privilege) {
  // If privilege data is available, use it for the most accurate check
  if (privilege) {
    const { st, pl, dl, subp } = privilege
    // st < 0 means restricted/unavailable
    if (st < 0 && pl === 0 && dl === 0) {
      return { playable: false, reason: '无版权' }
    }
    // Can't play at even the lowest quality
    if (pl === 0 && dl === 0 && subp !== 1) {
      return { playable: false, reason: '付费歌曲' }
    }
  }
  // If song has its own st/privilege fields from API response
  if (song) {
    if (song.st !== undefined && song.st < 0) {
      return { playable: false, reason: '无版权' }
    }
  }
  return { playable: true, reason: '' }
}

// 只有调用 getPlaylistAll接口时，才需传入privileges数组
export function mapSongsPlayableStatus(songs, privilegeList = []) {
  if(songs?.length === undefined) return

  if(privilegeList.length === 0){
    return songs.map(song => {
      Object.assign(song, { ...checkSongPlayable(song) })
      return song
    })
  }

  return songs.map((song, i) => {
    Object.assign(song, { ...checkSongPlayable(song, privilegeList[i]) })
    return song
  })
}
