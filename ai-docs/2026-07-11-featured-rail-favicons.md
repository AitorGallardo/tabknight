# Build log — featured rail, truthful crops, favicon chain (v0.24.0)

**Session:** 2026-07-11. User feedback with screenshots: previews still showed
zoomed fragments/low-res; some favicons broken; wanted featured sections atop
the rail.

## What shipped

- **Featured rail** (tabs mode, empty query): "Recent" = top 5 by lastAccessed
  (the stack under the current tab), then "Most visited" = top 5 remaining tabs
  with ≥2 activations this session, then the usual recency buckets (deduped).
  Featured rows get a subtle blue resting tint (`bg-[#0a84ff]/[0.06]`). Keyboard
  order always matches visual order.
- **Visit tracking:** background counts `tabs.onActivated` per tab in
  `chrome.storage.session` (dies with the browser; SW-restart safe).
- **Hero crops fixed:** cover only when the capture is big enough AND its aspect
  is within ±12% of the 16/10 box — otherwise the whole screenshot letterboxes
  over its own blur. Kills the "zoomed into a random part" reads from the
  screenshots. Captures bumped to 1600px / q0.85 for retina heroes. Legacy
  low-res or width-less records defer to a good og:image.
- **Favicon fallback chain** (`components/Favicon.tsx`, adopted everywhere):
  tab icon → Chrome's local favicon cache (`_favicon` API, new `favicon`
  permission, zero network) → letter tile. Known caveat: `_favicon` serves a
  generic icon rather than failing, so the letter tile rarely triggers — docs
  claims worded accordingly.
- **Docs:** README refreshed (features, keyboard tables, permissions);
  CHANGELOG.md created (0.18.0 → 0.24.0); stale changelog.mdx deleted.

## Review gate

Verified clean: featured reorder vs keyboard/session-restore/prefetch integrity;
"Recent" purity (empty-query sort is pure lastAccessed — pinned boost only
affects search); no onError loops; `favicon` permission sufficient without WAR.
Fixed pre-ship: version sync, legacy width-undefined og-deferral, changelog
date, orphaned changelog.mdx, softened favicon absolutes.

## Follow-ups

- Live-verify letter-tile reachability (does `_favicon` ever error?).
- `persistVisitCounts` last-write-wins race across SW restarts (best-effort,
  acceptable).
