import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const bundle = await readFile(new URL('../public/mv/jizura/index.html', import.meta.url), 'utf8')
const styles = [...bundle.matchAll(/<style>([\s\S]*?)<\/style>/g)]

test('keeps JIZURA rendering CSS intact beside one Hydrogen shell stylesheet', () => {
  assert.equal(styles.length, 2)
  assert.match(styles[0][1], /--ink:\s*#0c0c0e;/)
  assert.match(styles[0][1], /\.viewport \{[^}]*background:\s*#000;/)
  assert.match(styles[0][1], /\.cut-pick \.tcard canvas \{[^}]*background:\s*#0c0c0e;/)
  assert.match(styles[1][1], /\/\* Hydrogen shell styles \*\//)
  assert.match(styles[1][1], /\.viewport \{[^}]*background-color:\s*#182226;/)
})
