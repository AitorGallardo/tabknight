# Build log — first-run discoverability + privacy/options (v0.21.0)

**Session:** 2026-07-11. Roadmap item 4 (trust layer).

## What shipped

- **First-run hint banner** in the toolbar popup: shows the *real* bound shortcut
  (via `chrome.commands.getAll`), "Set a shortcut…" when unbound (opens
  `chrome://extensions/shortcuts`). Dismissible; auto-dismisses forever once the
  user actually uses the command (set from background on both the overlay and
  standalone paths). Defaults hidden until the storage read resolves — no flash.
- **Options page** (`options_ui`, opens in tab): real `dist/popup/options.html`
  reusing the popup bundle, routed by pathname in `App.tsx` (sidesteps the
  options_ui-query-string uncertainty). Glass panel with: version header,
  shortcut display + change button, plain-language privacy copy, live
  card/thumbnail counts + approximate size (`navigator.storage.estimate`), and a
  "Clear preview data" purge wiping both IndexedDB stores with inline
  confirmation.
- **`PRIVACY.md`** at repo root: what's collected (titles/descriptions/og:image/
  screenshots), everything local-only (IndexedDB, no network/analytics), LRU caps
  300 cards / 150 thumbnails, purge instructions. Claims verified against code by
  the review gate (the only `fetch()` in the codebase is a local data-URI
  conversion).
- New db helpers: `countCards()`, `countThumbnails()`, `clearAllThumbnails()`.

## Review gate

No correctness findings. Two accepted nits: dismiss write is fire-and-forget
(house style), and an effectively-unreachable empty-kbd render if the manifest
command ever went missing.

## Roadmap state

Items 1–4 shipped (0.20.0, 0.21.0). Item 5 (shared list-nav hook + `scoreTab`
extraction, unify popup views onto the glass design system) is the remaining
strategic piece — planned as its own session.
