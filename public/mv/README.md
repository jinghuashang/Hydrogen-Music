# Hydrogen Music MV workspace

This directory embeds JIZURA v0.10.0 from upstream commit `3fa77b27c18fd932a598e0eaf7772a602da2df29`, repository https://github.com/852wa/JIZURA.

JIZURA is distributed under MIT. See `LICENSE` and `THIRD_PARTY_NOTICES.md` beside this directory. The upstream lyric-motion generator, rendering, and export code stay intact; `hydrogen.css` and `scripts/patch-jizura.mjs` apply the Hydrogen shell, remove sample lyrics from fresh projects, hide the redundant editor toolbar, and expose a constrained host bridge. The patcher retains JIZURA's original renderer stylesheet as-is and maintains exactly one separate Hydrogen shell style block.

The **自制 MV** entry sits in the empty lower area of the existing 添加视频 player overlay, preserving the lyric and video icons. It is keyboard-focusable and uses the selected track's title, artist names, and available original LRC; already parsed timed lyric lines are reused if the player has consumed the original text. The MV route board stays inset from Hydrogen's window edges and its responsive navigation reserves a separate row below the app brand and search. It does not capture or export protected streaming audio. Choose a local file inside JIZURA for beat analysis and exports. The MV editor stores its project at `jizura.project.v1`; selected audio uses JIZURA's `jizura` IndexedDB database and is never stored in Hydrogen player/profile state or sent to third parties by this integration. The modal entry snapshots lyrics without rewriting Hydrogen's lyric payloads and closes using the add-video overlay's existing behavior.

JIZURA lazily loads typefaces from Google Fonts; the generator and renderer are bundled locally. Fonts may fall back to installed system fonts offline.
