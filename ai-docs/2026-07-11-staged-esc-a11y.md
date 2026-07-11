# Build log — staged Esc + accessibility pass (v0.19.0)

**Session:** 2026-07-11. Follow-up on user feedback: "Esc should unselect the
playing tab, not only Tab goes back."

## What shipped

- **Staged Escape (Raycast model):** Esc = one step back, never a surprise close.
  Order: query non-empty → clear query; audio mode → back to tabs; else → close.
- **Backspace symmetry:** Backspace on an empty query in audio mode also steps back.
- **Selection continuity:** switching tabs→audio remembers the selected tab id and
  restores it on return (falls back to 0 if the tab closed).
- **Truthful footer:** the esc kbd chip label reflects what Esc will actually do
  right now — "clear" / "back" / "close".
- **ARIA pass:** listbox/option roles + `aria-activedescendant`, action+target
  `aria-label`s on row controls, `aria-pressed` on mute and the pill, one
  `aria-live="polite"` region announcing mode switches and control results.
- **prefers-reduced-motion:** equalizer animation disabled (static bars), hover
  transitions capped.

## Deviations

- No `stopPropagation` added to the Escape branch (task text suggested mirroring
  it, but the existing code never used it — mirrored reality instead).
- Backspace-to-back is deliberately NOT gated on `!targetIsInput`: the search input
  is always focused and native backspace on an empty value is a no-op.

## Verification

`bun run typecheck` + `bun run build` green. Quality audit for the broader
level-up roadmap lives in the session notes (perceived perf, motion, continuity,
error surfacing, coherence, stability, trust).
