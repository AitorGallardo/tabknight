# Build log — quality loop 1: keyboard reach, motion, now-playing (v0.25.0)

**Session:** 2026-07-11. Self-directed quality loop after 0.24.0 shipped to
main. Goals chosen for perceived quality (Raycast/Linear bar).

## Goals and outcomes

1. **Every footer hint keyboard-real.** New `useRovingCursor` hook: arrows move
   a cursor through the flattened, collapse-aware list in Save/Close flows;
   Space toggles (excluded when any interactive element has focus); Enter/Cmd+A
   /Esc unchanged. RestoreView's previously-decorative footer wired for real
   (Enter = Open all, Esc = Back). Cursor visual: hairline ring, never blue
   (blue saturation stays reserved for select semantics).
2. **No hard-swaps in the popup.** View switches cross-fade (reuses
   tk-mode-fade, reduced-motion covered). Overlay transparency cleanup now
   restores documentElement too.
3. **Audio panel shows real playback position.** MEDIA_STATUS protocol
   (passive poll, deliberately no inject-retry); 1Hz elapsed/duration +
   progress bar for the selected audio row; Live label for streams; renders
   nothing when no reachable media; drift-corrects local playing state.

## Review gate findings (fixed pre-ship)

- (must) Space stole activation from every focused button — exclusion broadened
  to all interactive elements.
- Cursor now re-anchors by tab id when domain groups collapse (was raw index —
  Space after a collapse could toggle the wrong tab).
- The "no media" gate un-sticks when a tab audibly starts playing again
  (event-driven re-probe via AUDIBLE_STATE_CHANGED).
- CloseTabsView cursor callback memoized (listener churn).

Verified clean by the gate: dual capture/bubble listener partition, ScrollArea
ref math, poll interval lifecycle, sendResponse ordering, key={view} remount
scope, RestoreView Enter single-fire.
