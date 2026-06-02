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
- Preview/snapshot feature in `src/popup/lib/preview/`

## Design System (the canonical surface going forward)
The **tab-preview overlay** (Cmd+K) is the primary UI and the reference design
for all new surfaces. Match it rather than reviving older patterns.

- **In-page, never a detour.** Primary UI renders *over the current page* as a
  blended dialog — the user never leaves their tab. We achieve this with a
  content-script shadow-DOM host that draws a blurred backdrop, and an
  extension-origin `<iframe>` panel hosting the React view. On restricted /
  strict-CSP pages, fall back to a standalone tab (`?standalone=1`).
- **Visual language:** dark glassmorphism — translucent panels, `backdrop-blur`,
  subtle white borders (`border-white/10`–`/15`), soft radial tints, generous
  rounding (`rounded-[18px]`), `box-shadow: 0 30px 80px rgba(0,0,0,.5)`.
- **Keyboard-first:** arrow keys move selection, Enter activates, Esc closes;
  the search input stays focused.
- **Tiered, never-blank previews:** always render the best tier available now
  and upgrade in place — favicon+title (Tier 0) → rich card / og:image (Tier 1)
  → pixel thumbnail (Tier 2, planned). Never show a spinner or an empty pane.
- **Snapshot architecture:** the content script *harvests* lightweight content
  cards from the live DOM and messages them to the background, which persists to
  **IndexedDB** (`src/popup/lib/preview/db.ts`). Content scripts can't reach the
  extension DB directly — always go page → background → DB. Keyed by normalized
  URL hash; LRU-evicted.

## Commit Style (open-source standard — short and human)
- **Conventional Commits:** `type(scope): summary` — types: `feat`, `fix`,
  `chore`, `refactor`, `docs`, `perf`, `test`, `build`.
- Summary ≤ ~60 chars, imperative mood, lowercase, no trailing period.
- Be concise and factual. **No AI-speak, no filler, no emoji, no marketing.**
- Body only when it adds real signal (the *why*, a breaking change, a caveat);
  otherwise omit it. Prefer a one-line commit.
- Never mention tools/assistants in commit messages.

## Versioning (deliberate, trust-building)
Bump the version (`public/manifest.json` **and** `package.json`, kept in sync)
on **every** shipped patch, fix, or feature — no silent changes. Semver:
- **patch** (`0.0.x`) — bug fixes, small internal/refactor changes.
- **minor** (`0.x.0`) — new user-facing features or notable behavior changes.
- **major** (`x.0.0`) — breaking changes (reserve for post-1.0).
The version bump belongs in the same commit as the change it ships.
