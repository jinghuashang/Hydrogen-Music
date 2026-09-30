# Hydrogen Music MV Module — Design Specification

**Status:** Implemented and verified for dev review
**Date:** 2026-09-30
**Upstream:** [852wa/JIZURA](https://github.com/852wa/JIZURA), MIT, upstream v0.10.0 observed during discovery

## Goal

Add a first-party Hydrogen-styled **MV** workspace that incorporates JIZURA's lyric-motion generation, preview, and export capabilities. Place the player entry in the empty bottom area of the existing 添加视频 overlay, keeping the video and lyric icon column unchanged. Opening the workspace from the overlay seeds it with the currently selected track's title, artists, ID, and available original lyrics.

## User-visible behavior

1. The existing **添加视频** overlay adds a labeled **自制 MV / MV** action in its empty lower area. Keep the existing player-side 添加视频 icon and lyric controls unchanged; do not insert the new action into the icon column. The player modal entry is available in full-player mode, not the compact web split-player.
2. The application navigation adds a first-class **MV** destination, making the editor reachable without entering the full player. Opening it from navigation without a current track shows an empty JIZURA project with normal manual lyric/audio entry.
3. From the full player, MV entry reveals Hydrogen's home/navigation surface, compacts the player, closes the add-video modal through its existing `close()` behavior, and clears blocking video presentation. It preserves the selected song, active audio, play/pause state, playback position, and lyric source state.
4. Entering through the overlay entry snapshots a one-shot handoff from the currently selected song: ID, display title, artist names, and available original LRC text. It consumes the existing lyric source only; it never asks Netease for new lyrics or fabricates timestamps. Missing lyrics remain editable in JIZURA's lyric editor; creating the snapshot does not rewrite or clear Hydrogen's lyric state.
5. JIZURA's existing audio-file chooser remains the source of render/export audio. The modal action does not capture, record, or export protected streaming audio; track metadata and lyrics are carried over, not the streaming audio bytes.
6. The Hydrogen route remains usable while the editor is active. Back/navigation returns to Hydrogen without disturbing the active music player. Leaving MV pauses JIZURA's preview/export loop; audio imports, project data, project editing, and file export stay in the local JIZURA project workspace and do not upload user media.
7. The MV workspace provides the upstream lyric editor, LRC import, audio selection/timing, style/effect tools, generated preview, and MP4/PNG/LRC/project export paths available in the packaged JIZURA version. Unsupported browser/device export modes must display JIZURA's own limitation rather than claim an export succeeded.

## Architecture

- Keep `src/components/Player.vue`'s existing 添加视频 icon unchanged. Its `MusicVideo.vue` overlay owns the accessible 自制 MV button in its empty lower area, snapshots the selected track and available lyrics into the transient one-shot handoff, closes through the overlay's existing `close()` behavior, clears player video presentation, and navigates to `/mv`. The MV page consumes that one-shot value so stale handoffs do not overwrite later direct visits.
- Keep full JIZURA source and its browser editor local to this repository/build. Use a same-origin packaged entry as a self-contained editor surface, hosted by the Vue MV route. A narrow origin-checked `postMessage` contract sends initial metadata/LRC and a leave/visibility notification; it does not send local files, player audio, credentials, or arbitrary persisted application settings. Retain the upstream engine and export implementation rather than reimplementing it.
- Restyle JIZURA's shell and controls in its local built entry to follow Hydrogen's existing light glass surface, cyan/neutral colors, typography, spacing, and subtle transition language. Retain readable contrast for its rendered MV canvas and focused export progress; do not expose the unmodified upstream dark interface as a visually separate website.
- Include the upstream MIT copyright/license text and `THIRD_PARTY_NOTICES.md` (including bundled mp4-muxer and external font notices) with the vendored distribution, plus a concise repository note pointing to those notices and identifying the upstream revision. Do not silently strip attribution.
- Preserve both the root Electron build (which serves `dist/index.html` from `background.js`) and the `web/vite.config.mjs` build (which serves the built entry under `web/dist`). Build configuration must package/copy the complete local editor asset tree into each app's correct `dist` tree and preserve relative asset resolution. The editor may not depend on `https://852wa.github.io/JIZURA/` for app boot, animation, or rendering.

## UI and interaction requirements

- The Hydrogen MV route owns page title, back/navigation context, and Hydrogen surface styling; editor layout remains usable in the minimum desktop window size (1024×672), narrower windows, and the responsive web client.
- Retain the JIZURA generation workspace rather than reducing the integration to a launch link: editable original lyric text, local audio selection, canvas preview, timing controls, regeneration/customization, and working output actions remain accessible.
- Preserve upstream keyboard shortcuts while focused in the editor; prevent editor shortcuts from leaking to the Hydrogen player/window. When editor is inactive, it must not intercept Hydrogen keyboard input.
- Empty, loading, missing-lyric, and engine/export-error states have explicit readable UI and an actionable path (edit/import/try another supported export); do not show fake media/sample output as if it came from the user's song.
- Follow the existing Vue keep-alive lifecycle: stop JIZURA rendering/timers/audio playback when the MV view is deactivated, and restore a usable edit session when revisited.

## Data and privacy contract

- Handoff data is transient route-entry state, not part of the persisted playback schema and not part of generated URLs. Escape rendered metadata as text.
- Check the message sender's exact origin and only accept the versioned initialization/visibility message types; use `postMessage` with an explicit target origin. Reject messages from other origins.
- The editor's local project persistence remains isolated from Hydrogen's localStorage keys/profile settings. Audio, lyric contents, and project data stay in browser/Electron local storage and are never transmitted to third-party services by this integration. JIZURA's documented Google Fonts requests may occur when needed for selected typography; offline system-font fallback remains.
- The editor cannot inject a web page over Hydrogen's remote Netease/Bilibili player source and cannot use the active streaming session audio for download/export.

## Acceptance criteria
1. Clicking the existing player-side add-video icon opens its original overlay unchanged. The overlay places an accessible, keyboard-focusable 自制 MV entry in the lower empty space; the lyric/video icon column has no added control.
2. Clicking the modal entry reveals Hydrogen navigation, minimizes the full player, uses the modal's existing `close()` path, and opens `/mv` without interrupting or seeking music playback or mutating Hydrogen lyric state; the MV page prefills current title, artist, and the currently available original LRC with timestamps intact. Missing lyrics leave the editor ready for manual input.
3. Direct MV navigation without a playing song opens an editable empty project without exceptions or stale prior track metadata.
4. JIZURA's local engine runs without an upstream-hosted editor dependency; users can edit lyrics, select local audio, preview a generated composition, and download output through a supported JIZURA export action.
5. The editor visually fits Hydrogen's MV module instead of presenting an unrelated upstream web page; it remains usable at 1024×672 and in the web app's responsive layout.
6. Returning from/deactivating MV halts editor preview playback and animation work; the Hydrogen track and playback position are preserved.
7. Both Electron/Vite and web/Vite builds contain the local editor assets; license and third-party notices accompany redistributed code.
8. Launch the actual app preview for visual inspection, and exercise the MV entry, metadata handoff, editor preview, local-audio selection surface, and leave/return lifecycle. Run relevant build checks after implementation; add behavior tests for the handoff/route contract where the existing test setup permits.

## Deliberate non-goals

- Capturing or exporting protected audio from a Netease/Bilibili playback stream.
- Rewriting JIZURA's lyric-motion engine, encoder, or effect catalog in Vue.
- Importing the MV into Hydrogen's existing online-video playback cache or associating an exported file with the upstream song catalog.
- Depending on the public JIZURA website at runtime, adding a server-side lyrics/media service, adding a backend, or installing a separate dependency solely for this editor.
- Broadly redesigning the main player or existing “添加视频” functionality.
