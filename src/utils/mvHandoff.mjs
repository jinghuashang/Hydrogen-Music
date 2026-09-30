export function lyricLinesToLrc(lines) {
  return (lines || [])
    .filter((line) => line && typeof line.lyric === 'string' && line.lyric.trim() && Number.isFinite(line.time))
    .map((line) => {
      const totalCentiseconds = Math.round(line.time * 100)
      const minutes = Math.floor(totalCentiseconds / 6000)
      const seconds = Math.floor(totalCentiseconds / 100) % 60
      const centiseconds = totalCentiseconds % 100
      const timestamp = `[${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(centiseconds).padStart(2, '0')}]`
      return `${timestamp}${line.lyric.trim()}`
    })
    .join('\n')
}

export function getAvailableMvLyrics(lyric, parsedLines) {
  const rawLyrics = lyric?.lrc?.lyric
  if (typeof rawLyrics === 'string') return rawLyrics
  return lyricLinesToLrc(parsedLines)
}

export function createMvHandoff(song, songId, lrcText) {
  const artists = Array.isArray(song?.ar)
    ? song.ar.map((artist) => artist?.name).filter((name) => typeof name === 'string' && name)
    : []

  return {
    version: 1,
    songId: songId ?? song?.id ?? null,
    title: song?.name || song?.localName || '',
    artist: artists.join(' / '),
    lyrics: typeof lrcText === 'string' ? lrcText : '',
  }
}

export function isMvHandoff(value) {
  return value !== null &&
    typeof value === 'object' &&
    Object.getPrototypeOf(value) === Object.prototype &&
    value.version === 1 &&
    (value.songId === null || ['string', 'number'].includes(typeof value.songId)) &&
    typeof value.title === 'string' &&
    typeof value.artist === 'string' &&
    typeof value.lyrics === 'string'
}
