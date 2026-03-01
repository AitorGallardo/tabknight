# TabKnight

Arc-inspired, keyboard-first tab navigator and session manager for Chrome (Manifest V3).

## What It Does

- Arc-style tab search dialog overlay on normal web pages (`http/https`)
- Includes all open tabs in results, including Chrome native pages such as `chrome://extensions/`, `chrome://settings/`, and other `chrome://` tabs
- Fast switch to existing tabs across windows
- Open typed input as a URL or search query in a new tab
- Save open tabs as bookmarks
- Close saved tabs and restore them from the saved bookmark folder
- Domain-grouped tab list for bulk tab operations in the popup flow

## Keyboard Shortcuts

- `Cmd+K` (macOS): opens the tab navigator
- `Cmd+Ctrl+T` (macOS): opens the in-page overlay on normal web pages
- `Enter`: activate selected tab or open the typed query
- `Arrow Up/Down`: move selection through results
- `Esc`: close the navigator

Notes:
- Native `Cmd+T` cannot be reliably overridden in Chrome.
- On normal `http/https` pages, `Cmd+K` opens the in-page overlay first.
- On restricted Chrome pages (`chrome://...`) where content scripts are blocked, `Cmd+K` falls back to a temporary adjacent extension tab that renders the navigator with a blurred screenshot/halftone background and closes after selection.

## UX Modes

### 1) In-page Arc Dialog (Primary)

The content script renders a centered glassmorphism dialog with:
- translucent blurred backdrop
- Arc-style search row
- full scrollable result list
- keyboard selection with auto-scroll to the active row

### 2) Restricted-page Fallback (Chrome native pages)

For `chrome://...` pages, the extension cannot inject DOM into the page. In those cases, TabKnight:
- opens a temporary adjacent extension tab in the same window
- captures the current visible tab and uses it as a blurred backdrop
- adds a halftone overlay so the fallback page does not read as a flat black canvas
- closes the temporary navigator tab after selection
- returns to the origin tab on `Esc`

### 3) Extension Popup (Secondary)

The popup still provides:
- tab save workflow
- close + restore workflow
- navigator access inside the popup

Popup size:
- width: `400px`
- height: `500px`

## Architecture

- `src/background/index.ts`
  - MV3 service worker
  - badge updates
  - command handling (`open_tab_navigator`)
  - runtime message bridge for querying tabs, activating tabs, and opening query tabs
  - content-script injection bootstrap (`chrome.scripting`)
  - restricted-page fallback launcher with screenshot/context handoff

- `src/content/index.ts`
  - in-page Arc dialog UI in a shadow root
  - keyboard handling and result rendering
  - scroll synchronization for keyboard-selected items
  - sends runtime messages to query and activate tabs

- `src/popup/App.tsx`
  - popup shell
  - standalone fallback shell for restricted pages
  - blurred screenshot + halftone background renderer for fallback mode

- `src/popup/views/TabNavigatorView.tsx`
  - shared React navigator used in popup and restricted-page fallback
  - auto-closes temporary navigator tab after selection
  - restores origin tab on `Esc` in temporary mode

- `src/popup/*`
  - bookmark/session save, close, and restore workflows

## Chrome APIs Used

- `chrome.commands`
- `chrome.tabs`
  - `query`
  - `get`
  - `getCurrent`
  - `update`
  - `highlight`
  - `create`
  - `remove`
  - `captureVisibleTab`
- `chrome.windows`
  - `getCurrent`
  - `update`
- `chrome.scripting`
  - `executeScript`
- `chrome.runtime`
  - `sendMessage`
  - `onMessage`
- `chrome.bookmarks`
- `chrome.action` badge APIs
- `chrome.storage.local`

## Permissions

Declared in `public/manifest.json`:
- `tabs`
- `bookmarks`
- `activeTab`
- `windows`
- `scripting`
- `storage`
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

- `Cmd+K` opens the in-page Arc dialog on an `https` page
- `Cmd+K` on `chrome://extensions/` opens the restricted-page fallback navigator in an adjacent tab
- `Cmd+Ctrl+T` opens the in-page overlay on a normal page
- Search filters results by title/URL
- The navigator shows the full list of matching tabs, including `chrome://` tabs
- Keyboard navigation auto-scrolls the active row into view
- `Enter` on a tab switches/focuses that tab window
- `Enter` on free text opens URL/search tab
- Save tabs flow creates a bookmark folder and entries
- Close flow can restore tabs from the saved folder

## Versioning

- Current version: `0.15.3`
- SemVer is used while remaining in major `0`
- Keep `package.json` and `public/manifest.json` versions synchronized

## License

[MIT](LICENSE)
