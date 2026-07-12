# Build log — quality loop 3: audit-driven bugs + craft pass (v0.27.0)

**Session:** 2026-07-13. Four-lens audit (Opus taste, Sonnet state-machine /
plumbing / consistency) → three-implementor fix wave.

## Bugs fixed (all audit-confirmed)

- Ghost rows after external tab closure; unguarded activate() rejection →
  try/catch + "Couldn't reach tab" hint + TAB_REMOVED broadcast/prune.
- Audio-mode raw-index selection stolen by live inserts → identity re-anchor
  (selectedIdRef + prev-keys compare, mirrors useRovingCursor).
- Prefetch LRU never revalidated → render-cached-then-revalidate by capturedAt.
- No event.repeat guard → consumed in preKeyDown.
- Content script double-injection (flat var top-level; onStartup sweep racing
  declarative injection → toggle flash) → IIFE + window.__tabknightLoaded.
- Standalone context PNGs leaked in storage.local forever → 10min TTL sweep.
- commands.onCommand unguarded → try/catch + one standalone retry.
- Unknown message types hung senders → HANDLED_MESSAGE_TYPES early false.

## Craft pass

- Skeleton hand-off: ready gated on !loading (+1500ms cap, safe vs 4s host
  backstop); in-React ghost rows continue the host shimmer.
- Motion system: --tk-ease token; transition-colors 100ms globally (was only
  inside reduced-motion — backwards); 160→150ms alignment.
- Pending hero tier (neutral wash) kills the downgrade-then-upgrade flash.
- EQ-in-pill (was Unicode ♪ amid lucide), pressed states, just-now pulse,
  overscroll-contain, featured-rail entrance stagger (first paint only).
- Copy: sentence case everywhere, … everywhere, "Couldn't …" voice, Kbd
  component (was 5 duplicated class strings), one focus-visible ring token,
  TabItem focus:→focus-visible:, "Storage size unavailable" (was "~unknown
  used"), isStandalonePreview rename, dead view=preview param removed,
  CmdKHintBanner live-syncs dismissal.

## Verification

typecheck + build green; smoke test green (exercises injection guard + ready
gate paths). Review gate: independent agent killed by monthly spend limit
mid-run (second occurrence); completed inline by orchestrator — verified ready
gate single-fire, "just now" comparison survived the copy sweep,
HANDLED_MESSAGE_TYPES covers all 5 sender types, thumbPending resolves on all
paths (request-id ownership).

## Deferred (logged, not shipped)

- NavigatorTab type hoist to types/index.ts (crosses two owners).
- White-opacity ramp + text-scale consolidation (large sweep, low urgency).
- themeColor ambient echo in right pane; audio footer progressive disclosure.
- manifest command id open_tab_navigator vs description mismatch (renaming the
  id would reset users' custom shortcuts — intentionally left).
