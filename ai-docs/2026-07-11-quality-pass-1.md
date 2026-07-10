# Build log — quality pass 1: motion, continuity, failure surfacing (v0.20.0)

**Session:** 2026-07-11. Executes items 1–3 of the Raycast/Linear level-up
roadmap (see the audit rationale) plus the stability undercard.

## What shipped

- **Instant skeleton shell:** the overlay panel paints as a matching glass card
  with shimmer ghost rows the same frame Cmd+K fires — never an empty hole.
  Includes a pre-mount transparency fix (`html.tk-overlay` class set synchronously
  in `index.tsx`; inline scripts are blocked by MV3 CSP) so the iframe's default
  white body can't flash over the skeleton.
- **Motion:** 140ms open/close (opacity + scale 0.98→1, `cubic-bezier(0.2,0.8,0.2,1)`),
  all close paths routed through one animated teardown with a `transitionend` +
  200ms backstop; `prefers-reduced-motion` renders instantly.
- **Softer fallback:** blind 1800ms teardown → 4000ms backstop + `iframe.onerror`;
  a slow-but-working load is no longer torn down; a dismissed overlay can no
  longer spawn a late standalone tab.
- **Session continuity:** `{mode, selectedTabId}` persisted in
  `chrome.storage.session` (key `previewSession`), restored on open; audio mode
  falls back to tabs if nothing is audible anymore.
- **Failure surfacing:** play/mute failures show a per-row "couldn't reach tab"
  hint (2.5s) and announce via the aria-live region — no more dead clicks.
- **Background hardening:** per-window capture guard (was one global boolean);
  content-script re-injection only on genuine "no receiver" errors; "message
  port closed" no longer opens a redundant standalone preview.

## Review-gate findings fixed before ship

1. (high) Session restore permanently no-oped when storage resolved after the
   tab load — restore now keyed on `savedSession` state, re-runs on late reads.
2. (high) "Message port closed" error caused a redundant standalone tab.
3. (medium) Late `iframe.onerror` during the close animation popped an unwanted
   standalone tab (`previewDismissed` flag).
4. (low) Write-through could persist a stale pre-restore selection (`persistReady` gate).
5. (visual) Pre-mount white iframe body would have hidden the skeleton.

## Accepted tradeoffs

- A Cmd+K press during the ~200ms close animation is swallowed (debounce, not a
  stuck state).
- Session-restored audio mode doesn't seed `rememberedTabId`, so backing out
  lands on index 0 (cosmetic).

## Still open from the roadmap

- Item 4: first-run Cmd+K hint + privacy/options page with data purge.
- Item 5: extract shared list-nav hook + `scoreTab`; unify popup views onto the
  glass design system (own session).
