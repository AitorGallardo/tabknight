# TabKnight

TabKnight is a Chrome Manifest V3 extension for keyboard-first tab navigation and lightweight session management.

The project has two core jobs:
- provide an Arc-style tab switcher that prioritizes speed, keyboard control, and cross-window tab jumping
- provide a compact popup workflow for saving, closing, and restoring tab sets as bookmark-backed sessions

The navigator is intentionally split by browser capability:
- on normal web pages, TabKnight renders an in-page translucent command dialog overlay
- on restricted Chrome-native pages such as `chrome://extensions/`, where Chrome blocks content scripts, TabKnight falls back to a temporary extension-owned navigator tab in the same browser window

## Core Features

### Arc-style Tab Navigator

- `Cmd+K` on macOS opens the tab navigator
- `Cmd+Ctrl+T` also opens the in-page navigator on normal web pages
- search matches against tab title and URL
- results include tabs across all Chrome windows
- results include Chrome-native tabs such as:
  - `chrome://extensions/`
  - `chrome://settings/`
  - `chrome://history/`
- `Enter` activates the selected tab or opens the typed query in a new tab
- `Arrow Up` / `Arrow Down` move through results
- `Escape` closes the navigator
- the active row auto-scrolls into view and preserves bottom breathing so the focused item does not stick to the frame edge
- the full matching result set is shown; results are no longer artificially capped to a small subset

### Strong Keyboard UX

- the navigator is built to remain usable even if the input loses DOM focus inside the active window
- arrow keys, `Enter`, `Escape`, `Backspace`, and printable characters continue working while the navigator is open
- clicking non-interactive space inside the panel re-focuses the search input
- the input caret is restored to the end of the current query so typing can continue naturally

### Cross-window Tab Switching

- selecting a tab can jump across Chrome windows
- TabKnight focuses the destination window before activating the chosen tab
- when possible, the extension also highlights the selected tab index to preserve a stable transition in the target window

### Query-to-Open Flow

If the query does not correspond to an existing tab:
- TabKnight can open a URL directly
- or open a search query in a new tab

### Save Tabs as Bookmark-backed Sessions

From the popup:
- save the current selection of tabs into a bookmark folder
- organize tabs by domain for fast bulk selection
- keep favicon context where available

### Close and Restore Saved Sessions

From the popup:
- close saved tabs in bulk
- restore a saved bookmark-backed tab set
- use the popup as a compact operational surface for tab housekeeping

## How The Extension Works

## 1. Background Service Worker

File: `/Users/aitor/dev/tabknight/src/background/index.ts`

The background script is the runtime coordinator.

It is responsible for:
- listening for the extension command declared in the manifest
- deciding whether to open the in-page navigator or the restricted-page fallback
- querying Chrome for tabs and window context
- switching to selected tabs across windows
- opening URL/search queries in new tabs
- capturing the current visible tab for restricted-page fallback backdrop rendering
- reinjecting the content script when needed on supported pages
- passing fallback state through `chrome.storage.local`

This is a Manifest V3 service worker, not a persistent background page.

## 2. In-page Navigator Overlay

File: `/Users/aitor/dev/tabknight/src/content/index.ts`

On pages where content scripts are allowed, TabKnight mounts a shadow-DOM overlay that behaves like a modal command palette.

This layer provides:
- a centered dark translucent panel
- blurred glass backdrop over the current page
- search-focused header row
- compact, high-contrast results
- keyboard-first movement and selection
- local rendering isolated from host-page CSS through a shadow root

Why the shadow root matters:
- it prevents site CSS from breaking the navigator layout
- it keeps scrollbar and focus styling consistent
- it makes the overlay more reliable across arbitrary websites

## 3. Restricted-page Fallback

Files:
- `/Users/aitor/dev/tabknight/src/background/index.ts`
- `/Users/aitor/dev/tabknight/src/popup/App.tsx`
- `/Users/aitor/dev/tabknight/src/popup/views/TabNavigatorView.tsx`

Chrome blocks content scripts on internal pages such as `chrome://extensions/`.
That means TabKnight cannot inject the same in-page overlay into those pages.

When that happens, TabKnight:
- opens a temporary extension tab in the same browser window
- places it next to the origin tab
- captures the origin tab visually and uses that image as a blurred backdrop
- overlays a halftone + vignette treatment so the fallback does not feel like a flat blank page
- renders the same navigator interaction model in the temporary tab
- closes that temporary tab after selection
- returns focus to the origin tab on `Escape`

This is the closest extension-safe approximation of a true in-page modal on Chrome-native surfaces.

## 4. Popup Session Manager

File: `/Users/aitor/dev/tabknight/src/popup/App.tsx`

The popup remains useful as the operational control surface for saving and restoring tabs.

It provides:
- save flow
- close flow
- restore flow
- navigator access when opened directly from the extension action

UI constraints:
- width: `400px`
- height: `500px`

## Keyboard Shortcuts

### Supported

- `Cmd+K` (macOS): open tab navigator
- `Cmd+Ctrl+T` (macOS): open in-page overlay on supported pages
- `Enter`: activate selected tab or open query
- `Arrow Up` / `Arrow Down`: move selection
- `Escape`: dismiss navigator

### Important Chrome Constraint

`Cmd+T` cannot be reliably overridden by an extension.

Chrome reserves that shortcut for opening a new tab at the browser level, and browser-level shortcuts are handled before page or extension UI code can consistently intercept them.

## Browser Constraints And Tradeoffs

### Why the navigator cannot render directly inside `chrome://...` pages

Chrome-native pages are privileged browser surfaces.
Extensions cannot:
- inject content scripts into them
- mount DOM inside them
- restyle their internal browser UI
- replace Chrome's built-in tab search UI

That is why TabKnight uses the temporary same-window fallback tab for those pages instead of a direct overlay.

### Why Chrome's own tab search can appear there

Chrome's native tab search (`Cmd+Shift+A`) is built into the browser itself, not delivered through extension APIs.
It runs with internal browser privileges that extensions do not have.

## Ranking And Result Behavior

Tab results are ranked using a simple practical heuristic:
- exact title match scores highest
- title prefix match scores strongly
- title substring match scores next
- URL substring match also contributes
- active tabs and pinned tabs get small boosts
- when scores tie, current-window tabs are preferred
- remaining ties are resolved by window and tab index

This keeps results fast and predictable without introducing fuzzy-matching complexity.

## Chrome APIs Used

TabKnight uses Chrome APIs directly with async/await patterns.

### Commands and runtime

- `chrome.commands.onCommand`
- `chrome.runtime.sendMessage`
- `chrome.runtime.onMessage`

### Tabs

- `chrome.tabs.query`
- `chrome.tabs.get`
- `chrome.tabs.getCurrent`
- `chrome.tabs.update`
- `chrome.tabs.highlight`
- `chrome.tabs.create`
- `chrome.tabs.remove`
- `chrome.tabs.captureVisibleTab`

### Windows

- `chrome.windows.getCurrent`
- `chrome.windows.update`

### Injection and state

- `chrome.scripting.executeScript`
- `chrome.storage.local`

### Bookmarks and action

- `chrome.bookmarks`
- `chrome.action` badge/title APIs

## Permissions

Declared in `/Users/aitor/dev/tabknight/public/manifest.json`:
- `tabs`
- `bookmarks`
- `activeTab`
- `windows`
- `scripting`
- `storage`
- `host_permissions: <all_urls>`

Each permission maps to a real feature:
- `tabs`: enumerate, activate, create, remove, and inspect tabs
- `bookmarks`: save and restore tab sets as bookmark folders
- `activeTab`: support active-page context when needed
- `windows`: focus destination windows during cross-window switching
- `scripting`: inject content scripts on supported pages
- `storage`: hand off state between the background worker and temporary fallback UI
- `<all_urls>`: allow the content script navigator to run on supported web pages

## Tech Stack

- TypeScript
- React 18
- Tailwind CSS
- shadcn/ui
- Bun
- Chrome Extension Manifest V3

## Project Structure

- `/Users/aitor/dev/tabknight/src/background/index.ts`: background service worker and browser coordination
- `/Users/aitor/dev/tabknight/src/content/index.ts`: shadow-DOM Arc-style in-page overlay
- `/Users/aitor/dev/tabknight/src/popup/App.tsx`: popup shell and restricted-page fallback shell
- `/Users/aitor/dev/tabknight/src/popup/views/TabNavigatorView.tsx`: shared React navigator used by popup and restricted fallback
- `/Users/aitor/dev/tabknight/src/popup/views/SaveTabsView.tsx`: save-tabs flow
- `/Users/aitor/dev/tabknight/src/popup/views/CloseTabsView.tsx`: close-tabs flow
- `/Users/aitor/dev/tabknight/src/popup/views/RestoreView.tsx`: restore flow
- `/Users/aitor/dev/tabknight/chrome_web_store/chrome_web_store.md`: store listing and launch copy
- `/Users/aitor/dev/tabknight/changelog.mdx`: release history and project timeline

## Development

### Prerequisites

- [Bun](https://bun.sh/)
- Google Chrome

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

## Load The Extension In Chrome

1. Open `chrome://extensions/`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select `/Users/aitor/dev/tabknight/dist`
5. After any code change, rebuild and click **Reload** on the extension card

## Manual Verification Checklist

### Navigator on normal pages

- open any `https://` page
- press `Cmd+K`
- confirm the in-page Arc-style overlay appears
- type part of a title or URL
- verify the full list of matching results remains available
- move with `Arrow Up` / `Arrow Down`
- verify the active row stays visible and does not stick to the bottom edge
- press `Enter` on an existing tab and confirm Chrome switches to it

### Restricted-page fallback

- open `chrome://extensions/`
- press `Cmd+K`
- confirm a temporary adjacent extension tab opens in the same window
- verify the fallback background uses a blurred contextual screenshot, halftone texture, and vignette treatment
- press `Escape` and confirm focus returns to the origin tab

### Search behavior

- enter a search query that does not match an existing tab
- press `Enter`
- confirm a new tab is opened with the URL or search query

### Session management

- open the extension popup
- save a tab set into a bookmark folder
- close tabs using the close flow
- restore them from the restore flow

## Release And Versioning

- Current version: `0.15.4`
- SemVer is used while the project remains in major version `0`
- `package.json` and `public/manifest.json` must stay synchronized
- patch bumps cover non-breaking fixes, refinements, and internal changes
- minor bumps cover new user-facing features, new permissions, or new UX flows

## Documentation And Store Assets

Release-supporting docs are stored in:
- `/Users/aitor/dev/tabknight/chrome_web_store/chrome_web_store.md`
- `/Users/aitor/dev/tabknight/chrome_web_store/images/`
- `/Users/aitor/dev/tabknight/changelog.mdx`

## License

[MIT](/Users/aitor/dev/tabknight/LICENSE)
