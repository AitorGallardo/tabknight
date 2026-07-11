# TabKnight - Agent Instructions

## Design System
Always use Arc-style command/navigation UI patterns for tab switching surfaces. Keep the look close to Arc's quick switcher: dark translucent modal, strong search focus, large type in the query row, and compact/high-contrast result rows.

If a component is not part of the tab navigator experience, use shadcn/ui Mira style. Reference:
https://github.com/shadcn-ui/ui/blob/a29185c9cf2e33e3dcfc0ea171b31ef99da03960/apps/v4/registry/styles/style-mira.css

Key Mira characteristics:
- Compact, dense interfaces
- `text-xs/relaxed` typography
- Tight spacing (px-2, py-1.5, gap-2)
- Subtle borders and rings
- Focus states with `ring-[2px] ring-ring/30`

## Required Technologies
- TypeScript (never JavaScript)
- React (never Vue/Svelte/etc.)
- Tailwind CSS (never CSS modules or styled-components)
- Bun (never npm/yarn/pnpm)
- shadcn/ui (never MUI/Chakra/etc.)

## Chrome Extension Rules
- Use Manifest V3
- Service worker for background (not background page)
- All permissions must be declared in manifest.json
- Use async/await for Chrome APIs, never callbacks

## Testing
- Manual testing in Chrome
- Load unpacked extension from `dist/` folder
- Refresh extension after rebuilds

## UI Constraints
- Popup: 400px width, 500px height
- Follow system dark/light mode
- Support keyboard navigation

## Versioning Rules
- The current version is whatever `public/manifest.json` says. Do not use `1.x` versions yet.
- Use SemVer: `MAJOR.MINOR.PATCH`.
- Keep `version` synchronized in both `package.json` and `public/manifest.json`.
- Bump `PATCH` (`0.x.y`) for bug fixes, refactors, style tweaks, and non-breaking internal changes.
- Bump `MINOR` (`0.x.0`) for new user-facing features, new permissions, new commands, or notable UX flows that are backward-compatible.
- `MAJOR` remains `0` until explicitly approved to declare API/behavior stability for `1.0.0`.
- Never skip synchronization: if one version changes, update the other in the same change.
