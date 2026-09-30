import test from 'node:test'
import assert from 'node:assert/strict'
import { consumeMvHandoff, stageMvHandoff } from '../src/utils/mvHandoffSession.mjs'

test('consumes the selected song handoff exactly once', () => {
  const payload = { version: 1, songId: 37, title: 'Track', artist: 'Singer', lyrics: '[00:01.00]line' }
  stageMvHandoff(payload)
  assert.deepEqual(consumeMvHandoff(), payload)
  assert.equal(consumeMvHandoff(), null)
})
test('routes consume the most recently staged handoff without store coupling', () => {
  const previous = { version: 1, songId: 37, title: 'Old', artist: '', lyrics: '' }
  const latest = { version: 1, songId: 52, title: 'Current', artist: 'Singer', lyrics: '[00:02.00]current' }
  stageMvHandoff(previous)
  stageMvHandoff(latest)
  assert.deepEqual(consumeMvHandoff(), latest)
  assert.equal(consumeMvHandoff(), null)
})

test('keeps only the latest selection when route entry is delayed', () => {
  stageMvHandoff({ version: 1, songId: 37, title: 'Old', artist: '', lyrics: '' })
  const latest = { version: 1, songId: 52, title: 'Current', artist: 'Singer', lyrics: '[00:02.00]current' }
  stageMvHandoff(latest)
  assert.deepEqual(consumeMvHandoff(), latest)
})
