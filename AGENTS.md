# TabKnight - Agent Instructions

## Design System
Always use shadcn/ui Mira style. Reference:
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
