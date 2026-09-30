# Hydrogen Music MV Module Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use the test-driven-development skill for the owned MV handoff behavior and subagent-free inline implementation. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrate the pinned, locally packaged JIZURA lyric-motion maker as a first-class Hydrogen **MV** module, entered from the empty lower area of the existing add-video modal without interrupting playback. After pushing the feature to `dev`, keep all dev source and files in the sibling `../Hydrogen-Music-dev` checkout and leave the parent/main checkout on `main` without dev-only files.

**Architecture:** Vue owns the `/mv` route, Hydrogen-styled navigation/page shell, and a transient one-shot track/lyric handoff. A local, prebuilt upstream JIZURA editor runs as the MV route's packaged editor surface and receives only versioned metadata/LRC messages from its owning frame. A small maintained bridge in the vendored local editor applies seeds and pausing; no audio bytes or credentials cross the bridge. Copy the editor output into both Vite build destinations and retain required MIT/third-party notices.

**Tech Stack:** Vue 3, Vue Router, Pinia, Vite, Sass, JIZURA v0.10.0 (`852wa/JIZURA`), Node.js built-in test runner, Hydrogen's Electron and web preview targets.

**Spec:** `docs/superpowers/specs/2026-09-29-jizura-mv-module-design.md`

## Global Constraints

- Retain all approved behavior, route, privacy, accessibility, Electron/web-build, visual integration, and non-goal requirements verbatim from the spec.
- MV metadata/LRC handoff stays in memory; never pass through a URL, persisted Hydrogen player state, network API, or generated audio bytes. Snapshot lyrics without mutating Hydrogen's raw or parsed lyric sources.
- The MV edit action preserves selected song, active audio, `playing`, `progress`, `time`, and lyric sources; it uses the existing modal `close()` behavior, and the MV route compacts the player and clears video overlays through the existing unload lifecycle before navigation settles.
- JIZURA's editor engine and local-file MP4/PNG/LRC/project export remain the real upstream implementation; no lookalike or nonfunctional editor controls.
- Host postMessage accepts only the versioned payload from the exact iframe `contentWindow`; use exact same-origin targeting on HTTP(S), and source-window validation plus the required opaque-origin target behavior for Electron `file://`.
- The local app cannot boot the editor from GitHub Pages or require a network request for its engine. Runtime font requests follow upstream's documented Google Fonts behavior.
- Preserve the repo's Vue/router/Sass conventions and the separate `vite.config.js` and `web/vite.config.mjs` build paths. Do not add package dependencies for this feature.
- Preserve the upstream JIZURA and bundled `mp4-muxer` MIT copyright/license text and upstream third-party notices beside the vendored editor.
- Do not change version numbers. Commit only MV feature files and exclude unrelated working-tree changes. Relocate the `dev` checkout only after pushing and preserve ignored user files during relocation.

---

## Files and interfaces

- Create `src/utils/mvHandoff.mjs` — pure normalization/validation for the one-shot metadata and LRC initialization payload. It will have no Pinia, router, DOM, filesystem, or renderer dependencies.
- Create `tests/mvHandoff.test.mjs` — Node built-in `node:test` checks for malformed/missing metadata and intact timestamped lyric handoff.
- Keep all player and lyric transient handoff data in the in-memory `src/utils/mvHandoffSession.mjs` buffer; do not add persisted or session-wide MV state to Pinia.
- Keep the existing video and lyric icon column in `src/components/Player.vue` unchanged. Modify `src/components/MusicVideo.vue` to place the `自制 MV` entry in the empty bottom area of the existing 添加视频 overlay; carry current track metadata and available original LRC into the same `/mv` route without changing audio state.
- Modify `src/router/router.js` — register `MV` named route `mv` at `/mv` with Hydrogen navigation components.
- Modify `src/views/Home.vue` — add the always-accessible `MV` nav item, active underline target, narrow-layout spacing, and route-order entry.
- Create `src/views/MV.vue` and its focused local style/module — Hydrogen header/back context, packaged JIZURA frame, one-shot handoff consumption, and Vue keep-alive visibility/pause lifecycle.
- Create `public/mv/jizura/index.html` — upstream single-file app pinned to its commit hash; apply the minimum durable integration changes at the host bridge and Hydrogen visual shell without replacing JIZURA's engine/UI behaviors.
- Create `public/mv/LICENSE` and `public/mv/THIRD_PARTY_NOTICES.md` — full upstream notices distributed adjacent to the vendored application.
- Create `public/mv/README.md` — provenance, precise upstream revision, license, audio/privacy behavior, and external-font disclosure.
- Modify `README.md` — one concise feature and license-notice pointer for maintainers/users, using the existing Chinese documentation style.
- No test-only helper is exported into a production store, and no editor media asset is put in Hydrogen persistence.

## Task 1: Implement and test the transient metadata handoff

**Files:** Create `tests/mvHandoff.test.mjs`, create `src/utils/mvHandoff.mjs`, modify `src/store/playerStore.js` and `src/components/Player.vue`.

**Interface produced:** `createMvHandoff(song, songId, lrcText)` returns `{ version: 1, songId, title, artist, lyrics }`; title uses the display-name fallback already used by `Player.vue`, artists are the track's artist names joined with ` / `, missing text/names produce empty strings, and LRC text is copied exactly. `isMvHandoff(value)` accepts only version `1`, plain object payloads, and string-valued title/artist/lyrics; it returns false for null, wrong versions, or malformed data. Nothing sanitizes lyrics by parsing or rewriting LRC timestamps.

- [ ] **Step 1: Write the red behavior tests** in `tests/mvHandoff.test.mjs`, using Node's built-in test/assert modules and table literals:

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import { createMvHandoff, isMvHandoff } from '../src/utils/mvHandoff.mjs'

test('copies the selected song display metadata and timestamped original LRC intact', () => {
  const lrc = '[00:01.00]First line\n[00:02.50]Second line'
  const payload = createMvHandoff(
    { id: 37, name: 'Track', ar: [{ name: 'Singer A' }, { name: 'Singer B' }] },
    37,
    lrc,
  )
  assert.deepEqual(payload, {
    version: 1,
    songId: 37,
    title: 'Track',
    artist: 'Singer A / Singer B',
    lyrics: '[00:01.00]First line\n[00:02.50]Second line',
  })
})

test('uses local-track names and empty metadata when Netease fields are absent', () => {
  assert.deepEqual(createMvHandoff({ localName: 'File.flac' }, null, null), {
    version: 1,
    songId: null,
    title: 'File.flac',
    artist: '',
    lyrics: '',
  })
})

test('accepts only a version-one plain payload with string lyric fields', () => {
  assert.equal(isMvHandoff({ version: 1, songId: 37, title: 'Track', artist: '', lyrics: '[00:01.00]line' }), true)
  assert.equal(isMvHandoff({ version: 2, songId: 37, title: 'Track', artist: '', lyrics: '' }), false)
  assert.equal(isMvHandoff({ version: 1, songId: 37, title: 'Track', artist: '', lyrics: null }), false)
  assert.equal(isMvHandoff(null), false)
})
```

- [ ] **Step 2: Run the tests before implementation; verify RED for the missing production export.**

Run: `node --test tests/mvHandoff.test.mjs`

Expected: FAIL because `src/utils/mvHandoff.mjs` is not implemented; do not treat a command/module resolution error as the expected contract failure.

- [ ] **Step 3: Implement the pure tested contract minimally:** plain versioned payload, safe optional-field fallback, metadata names, unchanged original LRC string, and strict validator. Do not parse lyrics as HTML or invent timings.

- [ ] **Step 4: Run the test again; verify GREEN.**

Run: `node --test tests/mvHandoff.test.mjs`

Expected: 3 passing assertions/tests and no failures.
- [ ] **Step 5: Add the transient modal handoff and preserve the side-icon layout.** Do not change the existing `src/components/Player.vue` add-video or lyric SVG actions. Add the semantic `自制 MV` button at the bottom of the existing add-video modal in `src/components/MusicVideo.vue`. When clicked, read the selected `songList[currentIndex]`, `songId`, and already available raw lyric or parsed timestamped lines, stage the one-shot handoff without mutating Hydrogen lyric state, use the overlay's existing `close()` behavior, compact the player, clear video overlays through the normal MV route transition, preserve track/playback state, and route to `mv` without contacting lyric APIs.

- [ ] **Step 6: Run the pure handoff tests after wiring and inspect the real preview in Task 5.** No permanent tests that assert Vue/router forwarding alone.

## Task 2: Add the Hydrogen MV navigation route

**Files:** Modify `src/router/router.js` and `src/views/Home.vue`; create `src/views/MV.vue` shell in Task 4.

- [ ] **Step 1: Register the lazy/normal project-convention import and `{ path: '/mv', name: 'mv', component: MV }` route.** Route must not require login; media/file editing is local.
- [ ] **Step 2: Add the navigation label and active state.** Add `.button-mv` after “听歌识曲” or “心动” according to space; add the class to the current route selection, underline calculation, and responsive margin selectors. Add `mv` to page direction ordering.
- [ ] **Step 3: Verify route navigation when running the real app in Task 5.** The always-visible nav opens MV even with an empty player; no login or playback dependency.

## Task 3: Vendor the complete upstream JIZURA distribution

**Files:** Create `public/mv/jizura/index.html`, `public/mv/LICENSE`, `public/mv/THIRD_PARTY_NOTICES.md`, `public/mv/README.md`; modify root and web Vite build configuration only if the actual Vite preview/build evidence requires it.

- [ ] **Step 1: Resolve and record the immutable Git commit for upstream `VERSION` v0.10.0** before downloading; if v0.10.0 is not an upstream Git tag, record the exact observed commit hash that contains `VERSION` `0.10.0`. Never claim a tag that does not exist.
- [ ] **Step 2: Download the upstream built browser app and accompanying full MIT/third-party notices from that immutable revision.** Verify the app has the real renderer, audio analysis, preview, MP4/PNG/LRC/project export source; no external JIZURA runtime `<script src>` or remote editor dependency. Preserve upstream text verbatim before local edits.
- [ ] **Step 3: Apply durable local host/CSS changes after reviewing upstream IDs/functions in the pinned artifact:** keep Hydrogen's parent page/frame as the only global navigation shell, align the editor header, panels, controls, and mobile/tight-window layout to Hydrogen's light-blue/neutral brand, Chinese font, thin borders, and restrained hover feedback. Keep Hydrogen shell CSS in its own style block; preserve JIZURA's renderer stylesheet and authored canvas palette unchanged.
- [ ] **Step 4: Add a versioned narrow host bridge to the upstream local app.** Expose JIZURA UI actions to set only the provided title, artist, and original LRC in the active editable project, recompute rendering/UI, and pause any editor audio/animation/export on hide. Do not serialize/import player file paths, bytes, cookies, or broader Vue/Pinia settings. Initialize after JIZURA's `boot()` and preserve unrelated appearance settings. On return, deliver a new one-shot payload only when supplied by a player-originated navigation action.
- [ ] **Step 5: Implement exact host message boundaries.** For HTTP(S), compare message `origin` to the app origin and set `targetOrigin` to that exact origin. In Electron `file://` the iframe origin is opaque (`"null"`): check `event.source === iframe.contentWindow`, accept only the app's versioned message type/schema from that exact WindowProxy, and choose `'*'` only as the technically required target origin when parent origin is opaque. Never accept messages from another WindowProxy or pass file/audio data through the bridge. Test actual `file://` renderer behavior in the Electron smoke if available.
- [ ] **Step 6: Include the upstream copyright, JIZURA `LICENSE`, and complete `THIRD_PARTY_NOTICES.md` next to the packaged editor; add `public/mv/README.md` with provenance and notices.** Do not remove the vendored upstream credit.
- [ ] **Step 7: Build both application modes and inspect produced relative assets.**

Run: `npm run build`

Then: `npm run web:build`

Expected: both commands exit successfully; the root build has its MV editor under `dist/mv/jizura/index.html`; the web build has it under `web/dist/mv/jizura/index.html`; `LICENSE` and third-party notices accompany both outputs. Use build output rather than assuming Vite's `publicDir` resolution.

## Task 4: Host the packaged editor inside the Hydrogen MV module

**Files:** Create `src/views/MV.vue`; modify `src/utils/mvHandoff.mjs`, `src/store/playerStore.js`, `src/router/router.js` if actual interface inspection shows needed; `src/views/Home.vue` link target.

- [ ] **Step 1: Consume the in-memory handoff once.** The MV route reads `consumeMvHandoff()` from `src/utils/mvHandoffSession.mjs`, validates it with `isMvHandoff`, and transfers it to editor bootstrap state. A direct visit with no staged handoff starts a blank project and cannot replay a consumed song.
- [ ] **Step 2: Add a Hydrogen-styled page/header, a keyboard-focusable back/home control, and a local editor frame rooted at `./mv/jizura/index.html`/root-relative `/mv/jizura/index.html` after proving both preview base modes.** Ensure iframe dimensions allow the editor to use the full route size; responsive display at 1024×672 and constrained browser width.
- [ ] **Step 3: Gate bridge setup on frame load and JIZURA-ready.** Use `postMessage` with explicit typed actions and strict source/origin checks. Initialize the frame with only the route's one-shot seed. Forward visibility false in `onDeactivated` and component-unload cleanup, which pauses JIZURA's preview; on reactivation remeasure/refit and restore editing. Do not interrupt Hydrogen song playback.
- [ ] **Step 4: Contain editor-local keyboard shortcuts.** JIZURA controls run only while the iframe document owns keyboard focus; on app-level listeners verify route/focus boundaries so playback shortcuts cannot bubble into Hydrogen. Never add editor-global shortcuts to Hydrogen's window.
- [ ] **Step 5: Give the empty case a real path.** The empty editor permits lyric paste/LRC load and local audio selection. If editor bootstrap or load fails, render an actionable local module error that offers reload/back and does not show a fake output preview.

## Task 5: Real app preview, changed-path checks, and documentation cleanup

**Files:** May update the affected source/tests and `README.md`; do not leave an app smoke harness in production.

- [ ] **Step 1: Run focused TDD checks and both builds.**

Run: `node --test tests/mvHandoff.test.mjs`

Run: `npm run build`

Run: `npm run web:build`

Expected: tests pass; both Vue builds include the packaged editor and licensing assets.

- [ ] **Step 2: Launch the actual Hydrogen front-end in the owner's development environment with `npm run dev`** (Electron development preview runs on `http://localhost:5173`; if the desktop app is available, launch it using the existing README `npm start` flow). Keep the preview server running and report the exact preview URL. If launching Electron is unavailable, keep the Vite surface live and identify that as a browser-only preview, not an Electron result.
- [ ] **Step 3: Exercise the real UI:** navigate to MV from Hydrogen nav when no song is selected; verify empty lyric/audio editor and make a short lyric-motion preview. Import a small user/local test audio file through JIZURA and verify it is usable in the preview/export UI; don't commit a generated demo file. With a current-playing fixture/song, click the full-player `自制 MV` action and observe title/artist/LRC prefilling with timestamp spelling unchanged and the song continuing at the same playback state/position. Check missing lyric state. Navigate away and back, verify the preview stops and edits remain. Verify a supported output download using a short test project, and inspect that both Vite builds have local same-origin JIZURA assets. Evaluate the rendered Hydrogen style and adjust actual visual mismatches.
- [ ] **Step 4: Exercise responsive, license, and degraded states.** Inspect actual app at `1024×672` and a narrower web viewport; confirm tabbed/workspace tools remain reachable, iframe does not overlay the Hydrogen title/nav globally, missing font network does not block editing, unsupported codec reports upstream's actual limit, notices remain accessible.
- [ ] **Step 5: Update repository-facing `README.md`** with a concise Chinese entry documenting the MV button/route, imported track title/artist/LRC vs user-selected local audio (no streaming-audio transfer), app preview URL convention and licensing-notices location. No changelog/version change unless the user directs a release update.
- [ ] **Step 6: Remove all throwaway smoke projects and temporary downloaded test media created for verification.** Preserve legitimate owner files and any ongoing preview process the owner asked to keep live; keep the Vite development server running so the user can inspect it.

## Implementation handoff
The editor integration is implemented with playback-preserving route cleanup, native modal close behavior, in-memory lyric handoff, and renderer CSS protection. Re-run focused tests, both builds, and browser preview before pushing.
