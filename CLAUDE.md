# TabKnight - Claude Code Configuration

## Tech Stack
- **Runtime/Bundler**: Bun
- **Language**: TypeScript (strict mode)
- **UI Framework**: React 18
- **Styling**: Tailwind CSS
- **Component Library**: shadcn/ui with Mira style
- **Target**: Chrome Extension (Manifest V3)

## Build Commands
- `bun run dev` - Development build with watch
- `bun run build` - Production build
- `bun run typecheck` - Type checking

## Code Style
- Use functional React components with hooks
- Prefer `const` over `let`
- Use async/await for Chrome APIs
- Use TypeScript strict mode
- Follow shadcn/ui Mira style patterns
- Mobile-first responsive design not needed (fixed popup size)

## Important Patterns
- Chrome APIs are wrapped in `src/popup/lib/chrome-api.ts`
- All Chrome API calls must be async/await
- State management via React Context + useReducer
- Keyboard shortcuts handled in `useKeyboardShortcuts` hook

## File Organization
- Components in `src/popup/components/`
- Views (full screens) in `src/popup/views/`
- Custom hooks in `src/popup/hooks/`
- Utilities in `src/popup/lib/`
- Types in `src/popup/types/`
