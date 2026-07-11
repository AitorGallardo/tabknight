# Build log — quality loop 2: media metadata, restore cursor, smoke test (v0.26.0)

**Session:** 2026-07-12 (continues the 0.25.0 loop).

## What shipped

- **Media-session metadata:** background reads `navigator.mediaSession.metadata`
  via MAIN-world `executeScript` (content scripts can't see it), 5s-TTL cache
  riding the existing 1Hz poll, cleared on tab close. Audio panel shows track
  title · artist; album artwork becomes a new top-priority hero tier (audio
  mode only, contain-over-blur since art is square), cross-fading on track
  change, with failed-URL demotion.
- **Restore view cursor:** arrows + Enter-opens-selected, ⌘↵ opens all
  (backward-compatible `onSaveWithModifier` added to useKeyboardShortcuts —
  verified byte-identical fallback for Save/Close). Footer: ↑↓ Move · ↵ Open ·
  ⌘↵ Open all · esc Back.
- **Smoke harness:** `bun run smoke` (scripts/smoke.ts, zero deps, Bun
  WebSocket CDP). Launches headless Chrome, loads dist/, asserts overlay
  inject/render, options mount, overlay close. ~4-8s.
  Load-bearing discoveries: Chrome ≥137 silently ignores `--load-extension`
  (fallback: CDP `Extensions.loadUnpacked` + `--enable-unsafe-extension-debugging`);
  CDP `Page.reload` on an attached session strands renderers (fix: reload via
  the extension SW, then attach fresh).

## Review gate note

The independent review agent was cut off by the account's monthly spend limit
mid-run. Substituted with an orchestrator-led focused review of the riskiest
items: TTL gating order (correct), hostile-page executeScript throws (caught),
modifier-Enter backward compat (verified byte-identical via diff), artwork URL
usage (img-src only). Two hardenings applied: trusted-side type validation of
the page-world result (a shadowed mediaSession returning objects would have
crashed React) and an http(s)/data-image scheme allowlist for artwork URLs.
Accepted risk: a transient MAIN-world read failure at a TTL boundary can drop
the artwork tier for ~5s (rare; self-heals).

## Verification

typecheck + build green; `bun run smoke` green against the final build
(the smoke test now runs as a standing checks gate alongside build).
