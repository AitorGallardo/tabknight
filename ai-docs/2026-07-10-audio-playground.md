# Build log — Audio Playground (v0.18.0)

**Session:** 2026-07-10. Adds a "what's playing in the background" mode to the Cmd+K overlay.

## What shipped

- **Entry:** a `♪ N playing` pill in the search row (auto-hides at zero); `Tab` key
  cycles Tabs ⇄ Audio mode. Mode is internal state in `TabPreviewView` — works
  identically in the overlay iframe and the `?standalone=1` fallback.
- **Rail:** "Now Playing" list of audible/muted tabs, session-sticky (a row you pause
  doesn't vanish — it flips to ▶). Pure-CSS 4-bar equalizer (`tk-eq` keyframes,
  zero re-render). Search query filters the list.
- **Controls:** mute/unmute via `chrome.tabs.update({muted})` straight from the
  extension-origin view (works on every tab, including restricted pages). Play/pause
  routes view → background (`MEDIA_CONTROL_REQUEST`) → target tab's content script
  (`MEDIA_CONTROL`, inject-if-missing retry) → pauses all playing media or resumes
  the longest-duration element.
- **Keys (audio mode):** `Space` play/pause (query empty), `←/→` mute, `↵` go to tab,
  `Tab` back, `esc` close.
- **Live updates:** background broadcasts `AUDIBLE_STATE_CHANGED` on
  `tabs.onUpdated` audible/muted changes; the view patches state with an 800ms
  debounce on audible→false to avoid flicker.

## Deviations from the design spec (and why)

1. **Mute key is `←/→`, not `m`.** Review gate found the shipped `m` binding
   permanently swallowed the first letter of any audio-mode search starting with
   "m" (Mail, Music…). Arrows are non-printable so they never fight the filter.
2. **Right pane reuses the existing tiered preview unchanged** (V2 media block with
   scrubber/analyser not built — see cut-line below).

## Known limitations (by design, MVP cut-line)

- **Cross-origin iframe audio** (e.g. embedded YouTube players) is unreachable from
  the top-frame content script → those tabs report `no-media` and degrade to
  mute-only (play/pause rendered disabled, "mute only" tooltip). Fixing needs
  `all_frames: true` + per-frame targeting.
- **Programmatic `.play()`** can be blocked by autoplay policy when the tab has no
  prior user gesture → row shows a transient "click the tab to resume" hint.
- The **tab hosting the overlay** is excluded from the list (pre-existing filter;
  matches the "background tabs" framing of the feature).
- Tabs that **start playing after the overlay opened but weren't in the initial
  snapshot** only appear if they were in the loaded tab list (new tabs created
  mid-session are ignored until reopen).
- V2 backlog: real current-time scrubber, analyser-driven EQ, multi-element
  expansion, per-element volume, "mute all others", media-session metadata cards.

## Verification

`bun run typecheck` and `bun run build` green. Review gate (independent pass over
the full diff): message protocol clean, no stale closures, existing tabs-mode
behavior byte-identical; its 1 major + 2 minor findings were fixed and re-verified.
