import test from 'node:test'
import assert from 'node:assert/strict'
import { createMvHandoff, getAvailableMvLyrics, isMvHandoff, lyricLinesToLrc } from '../src/utils/mvHandoff.mjs'

test('prefers available original LRC and falls back to parsed timed lines only when raw lyrics are absent', () => {
  const parsed = [{ lyric: 'Parsed line', time: 1.25 }]
  assert.equal(getAvailableMvLyrics({ lrc: { lyric: '[00:03.00]Raw line' } }, parsed), '[00:03.00]Raw line')
  assert.equal(getAvailableMvLyrics(null, parsed), '[00:01.25]Parsed line')
  assert.equal(getAvailableMvLyrics(null, null), '')
})

test('copies selected song metadata and timestamped original LRC intact', () => {
  const payload = createMvHandoff(
    { id: 37, name: 'Track', ar: [{ name: 'Singer A' }, { name: 'Singer B' }] },
    37,
    '[00:01.00]First line\n[00:02.50]Second line',
  )

  assert.deepEqual(payload, {
    version: 1,
    songId: 37,
    title: 'Track',
    artist: 'Singer A / Singer B',
    lyrics: '[00:01.00]First line\n[00:02.50]Second line',
  })
})

test('uses local-track names and empty metadata when online fields are absent', () => {
  assert.deepEqual(createMvHandoff({ localName: 'File.flac' }, null, null), {
    version: 1,
    songId: null,
    title: 'File.flac',
    artist: '',
    lyrics: '',
  })
})

test('accepts only a valid version-one metadata and lyrics payload', () => {
  assert.equal(isMvHandoff({ version: 1, songId: 37, title: 'Track', artist: '', lyrics: '[00:01.00]line' }), true)
  assert.equal(isMvHandoff({ version: 2, songId: 37, title: 'Track', artist: '', lyrics: '' }), false)
  assert.equal(isMvHandoff({ version: 1, songId: 37, title: 'Track', artist: '', lyrics: null }), false)
  assert.equal(isMvHandoff(null), false)
})
test('rebuilds timestamped LRC when the player has already consumed its raw lyric payload', () => {
  assert.equal(lyricLinesToLrc([
    { lyric: 'REAL TIMED LRC', time: 1.25 },
    { lyric: 'SECOND LINE', time: 62.5 },
  ]), '[00:01.25]REAL TIMED LRC\n[01:02.50]SECOND LINE')
})
test('carries rounded centiseconds into the next minute', () => {
  assert.equal(lyricLinesToLrc([{ lyric: 'Carry', time: 59.999 }]), '[01:00.00]Carry')
})
