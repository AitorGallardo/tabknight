# TabKnight

Arc-inspired, keyboard-first tab navigator and session manager for Chrome (Manifest V3).

## What It Does

- Arc-style tab search dialog overlay on web pages
- Fast switch to existing tabs across windows
- Open typed input as URL or search query
- Save open tabs as bookmarks
- Close saved tabs and restore from saved bookmark folder
- Domain-grouped tab list for bulk tab operations

## Keyboard Shortcuts

- `Cmd+K` (macOS): opens the Arc-style dialog via extension command
- `Cmd+Ctrl+T` (macOS): opens the Arc-style dialog from the content script
- `Enter`: activate selected tab / open query
- `Arrow Up/Down`: move selection in results
- `Esc`: close dialog

Notes:
- Native `Cmd+T` cannot be reliably overridden in Chrome.
- Dialog shortcuts work on regular `http/https` pages. Chrome internal pages (`chrome://...`) do not allow content scripts.

## UX Modes

### 1) In-page Arc Dialog (Primary)

The content script renders a centered glassmorphism dialog with:
- translucent blurred backdrop
- large search input row
- compact result rows with favicon, title, URL, and action hint

### 2) Extension Popup (Secondary)

Popup still provides:
- tab save workflow
- close + restore workflow
- Arc-style navigator view inside popup

Popup size:
- width: `400px`
- height: `500px`

## Architecture

- `src/background/index.ts`
  - service worker
  - badge updates
  - command handling (`open_tab_navigator`)
  - runtime message bridge for query/activate/open actions
  - content-script injection bootstrap (`chrome.scripting`)

- `src/content/index.ts`
  - in-page Arc dialog UI and keyboard handling
  - queries tab data via background messaging
  - sends activate/open actions and waits for success

- `src/popup/*`
  - bookmark/session workflows
  - popup navigator and related UI components

## Chrome APIs Used

- `chrome.commands`
- `chrome.tabs` (`query`, `get`, `update`, `highlight`, `create`)
- `chrome.windows` (`getCurrent`, `update`)
- `chrome.scripting` (`executeScript`)
- `chrome.runtime` messaging (`sendMessage`, `onMessage`)
- `chrome.bookmarks`
- `chrome.action` badge APIs

## Permissions

Declared in `public/manifest.json`:
- `tabs`
- `bookmarks`
- `activeTab`
- `windows`
- `scripting`
- `host_permissions: <all_urls>`

## Tech Stack

- TypeScript (strict)
- React 18
- Tailwind CSS
- shadcn/ui components
- Bun (build/runtime)
- Chrome Extension Manifest V3

## Development

### Prerequisites

- [Bun](https://bun.sh/)

### Install

```bash
bun install
```

### Typecheck

```bash
bun run typecheck
```

### Build

```bash
bun run build
```

### Watch mode

```bash
bun run dev
```

## Load Extension in Chrome

1. Open `chrome://extensions/`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select `dist/`
5. After code changes: run build and click **Reload** on the extension

## Manual Test Checklist

- `Cmd+K` opens Arc dialog on an `https` page
- `Cmd+Ctrl+T` opens the same dialog
- Search filters results by title/URL
- `Enter` on a tab switches/focuses that tab window
- `Enter` on free text opens URL/search tab
- Save tabs flow creates bookmark folder and entries
- Close flow can restore tabs from saved folder

## Versioning

- Current version: `0.13.0`
- SemVer is used while remaining in major `0`
- Keep `package.json` and `public/manifest.json` versions synchronized

## License

[MIT](LICENSE)
