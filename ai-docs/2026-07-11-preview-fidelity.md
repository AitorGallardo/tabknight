# Build log — preview fidelity + 50-tab awareness (v0.23.0)

**Session:** 2026-07-11. User feedback: previews feel "off — zoomed out, pixelated,
not loaded, or unrelated to what's useful." Root-caused to render-side (aspect
indiscipline, upscaling, junk og:images, no freshness signal) more than capture.

## Capture side

- Source `captureVisibleTab` jpeg-90; downscale to ≤1280px WebP q0.82; thumbnails
  carry width/height + capturedAt.
- Freshness triggers: Cmd+K captures the tab you're leaving (bypasses the 3s
  throttle only if the stored thumb is >30s old); window-focus changes
  opportunistically capture the newly focused window's active tab. Old low-res
  records churn out passively.

## Render side (the taste layer, from an Opus spec)

- Hero locked to 16/10, `object-cover object-top`; small images are never
  stretched — they render crisp at natural size over a blurred copy of
  themselves. Top-edge scrim keeps light screenshots seated in the glass.
- og:images demoted when logo-shaped (ratio 0.8–1.25) or <200px wide →
  typographic card instead of an unrelated banner.
- **Typographic card (Tier 0.5):** bottom-anchored title (2-line clamp) +
  description (3-line) + favicon eyebrow on a themeColor gradient. Replaces the
  giant blurry favicon; a missing image now looks designed, not broken.
- **Freshness chip** on pixel thumbnails: "just now / 2m ago / 1h ago", green dot
  under 1h, dims when stale, never claims "live". 30s live tick.
- **Row status glyphs** (tabs mode): audible mini-EQ, muted, pinned, sleeping
  (dimmed + moon), other-window badge — priority-ordered, max 2, plain tabs stay
  empty. The 50-tab picture at a glance.
- **Match highlighting** in row titles (indexOf, both modes).
- **Fluidity:** neighbor prefetch ±2 (Blob-only LRU cache, concurrency 3; cache
  hits skip the 70ms debounce), `content-visibility:auto` past 60 rows with
  per-row-height intrinsic sizing.

## Review gate

SAFE TO SHIP verdict. Object-URL lifecycle and hero keying verified *more*
correct than pre-diff (single URL at a time; tier-keyed remounts fixed a
potential remount loop). Three cosmetic nits fixed post-review (two-line row
intrinsic size, dead dpr field, inert ml-auto).

## Deviations of note

- og:image never gets a "contain" mode — small/square og assets go straight to
  the typographic card (spec sections 1 vs 2 reconciled toward demotion).
- heroBoxWidth measured live via ResizeObserver (seeded 600px), not hardcoded.
