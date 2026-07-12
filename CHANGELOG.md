# Changelog

All notable changes to TabKnight are documented in this file.

Format loosely follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [0.27.0] - 2026-07-13

### Fixed

- Closing a tab elsewhere now removes its row from an open overlay; activating
  a just-closed tab shows "Couldn't reach tab" instead of silently failing.
- Audio-mode selection is anchored to the tab, not the list position — a tab
  that starts playing mid-navigation can no longer steal the selection.
- Preview thumbnails revalidate against fresher captures instead of showing a
  stale cached image for the whole session.
- Holding Tab/Space/arrows no longer spams mode switches or play/pause.
- The content script guards against double injection (overlay could flash
  open-then-closed after a browser restart).
- Orphaned standalone-preview data in storage is now swept (10-minute TTL).
- The Cmd+K handler can no longer fail silently; unknown runtime messages
  fail fast instead of hanging their sender.

### Changed

- The overlay's opening skeleton now hands off seamlessly to the loaded panel
  (no more "Loading tabs…" flash); one motion system (single easing curve,
  100ms hover feedback everywhere).
- Selection changes show a neutral wash while the screenshot loads instead of
  flashing a lower-quality tier first.
- The audio pill shows a live equalizer; controls have pressed states; the
  freshness dot pulses when a capture is seconds old; featured rows stagger in
  on first open (all reduced-motion aware).
- One copy voice across the product: sentence case, unified ellipsis,
  "Couldn't …" error style; one keyboard-chip component; one focus-ring
  treatment (and rings no longer fire on mouse clicks).

## [0.26.0] - 2026-07-12

### Added

- Album artwork, track title and artist in the audio panel, read from the
  page's Media Session (locally, via script injection — no network); artwork
  becomes the preview hero for audio tabs, cross-fading on track changes.
- Restore view: arrow keys move a cursor over bookmarks, Enter opens the
  selected one, ⌘↵ opens all.
- `bun run smoke` — end-to-end smoke test driving the built extension in a
  real headless Chrome over the DevTools Protocol (overlay injects, options
  page mounts, overlay closes).

### Fixed

- Media-session data from the page is type-validated and artwork URLs are
  scheme-checked before rendering.

## [0.25.0] - 2026-07-11

### Added

- Full keyboard reach in the Save and Close flows: arrow keys move a cursor
  through the visible list (collapse-aware), Space toggles the row's checkbox,
  and the cursor re-anchors to the same tab when groups collapse.
- Restore view keyboard wiring — Enter opens all tabs, Esc goes back; the
  footer hints are now real.
- "Now playing" media block in the audio panel: elapsed / total time with a
  progress bar for the selected audio tab, updating live; live streams show a
  Live label.

### Changed

- The toolbar popup's view switches (navigator / save / close / restore) now
  cross-fade instead of hard-swapping; respects reduced-motion.
- A tab that reported no reachable media becomes controllable again the moment
  it audibly starts playing.

## [0.24.0] - 2026-07-11

### Added

- Featured rail in the Cmd+K overlay: "Recent" (top 5) and "Most visited" (top
  5 by per-session visit count) sections above the full list, with a subtle
  blue tint.
- Per-session visit tracking — the background worker counts tab activations
  and mirrors them to `chrome.storage.session` so counts survive
  service-worker restarts within the same browser session.
- Favicon fallback chain: the tab's own `favIconUrl`, then Chrome's local
  favicon cache (new `favicon` permission, no network request), then a
  letter tile — all local, no network.

### Changed

- Thumbnail captures upgraded to 1600px (from 1280px) to stay retina-sharp on
  the larger hero pane at 2x DPR.
- Hero rendering is now aspect-aware: tier-2 thumbnails only get a cover-crop
  when their captured aspect ratio is close to the 16/10 hero, otherwise they
  render letterboxed instead of reading as a zoomed-in fragment.

## [0.23.0] - 2026-07-11

### Changed

- Preview hero locked to a 16/10 aspect with top-anchored cropping; small
  captures are never upscaled beyond a small tolerance — they render crisp at
  natural size over a blurred copy of themselves instead.
- `og:image` demoted (in favor of the typographic card) when it's logo-shaped
  or under 200px wide, so an unrelated banner no longer stands in for a real
  preview.
- Thumbnails now show a freshness chip ("just now / 2m ago / 1h ago") with a
  green dot under an hour old, ticking live every 30s.
- Neighbor rows (±2 from the selection) are prefetched into a small blob
  cache, and long lists (60+ tabs) use `content-visibility` for smoother
  scrolling.

### Added

- Typographic card fallback (Tier 0.5): title, description, and favicon over
  a theme-color gradient when no usable image exists — a missing preview now
  looks designed, not broken.
- Row status glyphs in tabs mode: audible mini-EQ, muted, pinned, sleeping,
  and other-window badges (priority-ordered, max two per row).
- Search-match highlighting in row titles.

## [0.22.0] - 2026-07-11

### Changed

- Unified dark-glass design system across every popup view (navigator, save,
  close, restore) — one selection/multi-select token set, one typography
  ramp, kbd-chip footers everywhere.
- Extracted shared `scoreTab` ranking and a `useListNavigation` hook so all
  list views share one keyboard/ranking implementation instead of duplicated
  logic drifting apart.
- Staged Escape (clear query, then close) now applies to the navigator too,
  matching the overlay.
- Overlay polish: debounced thumbnail fetches, cross-fades on tier upgrades
  and mode switches, domain hints on duplicate-titled rows.

### Fixed

- Restore view now loads the default folder on mount instead of waiting for
  a manual selection change.

## [0.21.0] - 2026-07-11

### Added

- First-run hint banner showing the real bound Cmd+K shortcut (or a prompt to
  set one), auto-dismissing once the shortcut is actually used.
- Options page: shortcut display, plain-language privacy explanation, live
  counts and approximate size of stored preview data, and a one-click
  "Clear preview data" purge.
- `PRIVACY.md` documenting what's collected, that it never leaves the
  browser, retention limits, and how to purge it.

## [0.20.0] - 2026-07-11

### Added

- Instant skeleton shell — the overlay paints a matching glass card with
  shimmer rows the same frame Cmd+K fires, instead of an empty hole.
- Session continuity: the overlay remembers its mode and selection across
  opens (falls back gracefully if the tab or audio source is gone).
- Per-row failure hints when a play/mute control can't reach its tab.

### Changed

- Open/close motion (140ms, respects `prefers-reduced-motion`) replaces the
  previous abrupt show/hide.
- Background capture and content-script re-injection hardened per-window to
  avoid redundant standalone-tab fallbacks.

## [0.19.0] - 2026-07-11

### Added

- Staged Escape: one Esc clears the query, the next steps back from audio
  mode, the next closes — never a surprise dismissal.
- Selection continuity between tabs and audio mode.
- Full accessibility pass: listbox/option ARIA roles, `aria-activedescendant`,
  labeled row controls, an `aria-live` region for mode/control announcements,
  and `prefers-reduced-motion` support.

## [0.18.0] - 2026-07-11

### Added

- Audio playground: a `Tab`-key toggle into an "Audio" mode inside the Cmd+K
  overlay listing tabs currently playing or muted audio, with a live
  CSS-only equalizer.
- Per-tab controls: mute/unmute (works on any tab, including restricted
  pages) and play/pause (routed through the tab's content script).
- Keyboard shortcuts in audio mode: `Space` play/pause, `←/→` mute, `Enter`
  jump to tab.

## [0.17.x and earlier]

Tab-preview overlay foundation, bookmark-backed sessions, and the original
Arc-style tab navigator. See `git log` for the full history predating this
file.
