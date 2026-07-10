# Build log — coherence pass: one design system, one keyboard (v0.22.0)

**Session:** 2026-07-11. Roadmap item 5 + remaining paper cuts. Closes out the
four quality contracts (latency, motion, memory, coherence + trust).

## What shipped

- **Shared modules:** `lib/rank.ts` (scoreTab, was duplicated byte-for-byte) and
  `hooks/useListNavigation.ts` (capture-phase keys, clamp, reset-on-query,
  scroll-into-view — ~140 duplicated lines absorbed). View-specific behavior is
  now explicit parameters (`preKeyDown`, `onEscape`, `scrollInsets`) instead of
  silent drift.
- **One design language:** all four popup views (navigator/save/close/restore)
  and their components + shadcn primitives migrated onto the canonical glass
  token system from an Opus spec — #0a84ff single-select cursor, 12%-tint
  multi-select rows with blue checkboxes, kbd-chip footers everywhere, one
  typography ramp, clamp() sizing killed, `ui/badge.tsx` deleted (dead).
- **Staged Escape everywhere:** the navigator now clears the query before
  dismissing, matching the overlay and its own footer hint.
- **Overlay polish:** 70ms thumbnail-fetch debounce (with stale-request guard),
  150ms tier-upgrade cross-fade, 120ms mode-switch fade (both respect
  reduced-motion), duplicate-title rows get a domain hint line, empty-state copy
  is honest per context ("No other tabs open" / "No tabs to save").
- **RestoreView** now loads the default folder on mount (pre-existing bug: the
  pre-selected folder never fetched until manual change).

## Review gate

Refactor verified regression-free (staged Esc, media keys, synthetic Open row,
aria wiring all preserved). Three must-fix findings fixed pre-ship: hero
thumbnail lagging one tab behind its metadata; navigator Esc contradicting its
footer; SaveTabsView double header padding. Plus reduced-motion gap and copy
nits.

## Quality contracts — status

1. Latency is the product — instant skeleton, animated shell, debounced IDB. ✅
2. Motion is information — open/close, tier, and mode transitions, all ≤150ms. ✅
3. The tool remembers — session continuity, selection continuity, staged Esc. ✅
4. One system — single design language, single keyboard/ranking source. ✅
0. Trust — first-run hint, options/privacy page, purge, PRIVACY.md, failure
   surfacing, per-window/no-receiver hardening. ✅

V2 backlog (from the design spec): segmented view nav, roving cursor for
multi-select lists, thumbnails in save/close rows, virtualized long lists,
DomainGroup collapse persistence, media scrubber/analyser EQ.
