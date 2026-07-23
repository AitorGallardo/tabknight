<div align="center">

<img src="public/icons/tabknight_icon.png" alt="TabKnight" width="128" height="128" />

# TabKnight

**Keyboard-first tab navigation for Chrome — search, preview, and switch tabs without ever leaving the page.**

[![Chrome Manifest V3](https://img.shields.io/badge/Chrome-Manifest_V3-4285F4?style=for-the-badge&logo=googlechrome&logoColor=white)](https://developer.chrome.com/docs/extensions/mv3/intro/)
[![Bun](https://img.shields.io/badge/Bun-000000?style=for-the-badge&logo=bun&logoColor=white)](https://bun.sh/)
[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![React 18](https://img.shields.io/badge/React_18-20232A?style=for-the-badge&logo=react&logoColor=61DAFB)](https://react.dev/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-06B6D4?style=for-the-badge&logo=tailwindcss&logoColor=white)](https://tailwindcss.com/)
[![License: MIT](https://img.shields.io/badge/License-MIT-22c55e?style=for-the-badge)](./LICENSE)
[![Version](https://img.shields.io/badge/version-0.30.1-6366f1?style=for-the-badge)](./CHANGELOG.md)

</div>

---

TabKnight turns Chrome's tab strip into a fast, keyboard-driven command surface. Hit one shortcut and a glassmorphic palette appears **over your current page** — fuzzy-search every tab in every window, see a real preview of where you're going, and jump there with `Enter`. When you're done, save a working set of tabs as a bookmark-backed session and restore it later.

It's local-first (everything lives in your browser; TabKnight makes no network requests of its own — preview images like a page's `og:image` are loaded by the browser directly from the site that published them), and it degrades gracefully even on Chrome's own internal pages.

<div align="center">

<img src="docs/screenshots/overlay.jpg" alt="TabKnight's ⌘K overlay: a fuzzy-searchable tab list beside a live preview pane, floating over the current page" width="900" />

<sub>The <code>⌘K</code> overlay floats over your current page — fuzzy-search every tab, preview where you're headed, and jump there with <kbd>Enter</kbd>.</sub>

</div>

## ⌨️ Keyboard shortcuts

TabKnight is keyboard-first by design — you rarely need the mouse.

**Global**

| Shortcut | Action |
| --- | --- |
| `⌘ K` (macOS) · `Ctrl Shift K` (Win/Linux) | Open the tab-preview overlay on the current page |

> Rebind it anytime at `chrome://extensions/shortcuts`.

**Inside the overlay / navigator**

| Shortcut | Action |
| --- | --- |
| `↑` · `↓` | Move the selection |
| `Enter` | Switch to the selected tab (or open the typed query) |
| `Tab` | Move focus through Search, Audio, Close, and row controls |
| `Esc` | Staged close — clears the query, then steps back from Audio mode, then closes |
| `>` | Show all browser commands; keep typing to filter them |
| `⌥ W` · `Alt W` | Close the highlighted tab |
| `⌥ D` · `Alt D` | Duplicate the highlighted tab |
| `⌥ P` · `Alt P` | Pin/unpin the highlighted tab |
| `⌥ M` · `Alt M` | Mute/unmute the highlighted tab |
| `⌥ R` · `Alt R` | Reload the highlighted tab |
| `⌥ N` · `Alt N` | Open a new tab |
| _type…_ | Filter instantly — the search stays focused even if focus drifts |
| `Backspace` | Edit the query without clicking back into the input |

**Audio mode** (choose the always-visible Audio control beside Search)

| Shortcut | Action |
| --- | --- |
| `Space` | Play/pause the selected tab's media (when the query is empty) |
| `←` · `→` | Mute/unmute the selected tab |
| `Enter` | Switch to the selected tab |
| `Tab` · `Esc` | Back to Tabs mode |

**Popup — save flow**

| Shortcut | Action |
| --- | --- |
| `Enter` | Save the selected tabs |
| `⌘ A` · `Ctrl A` | Select all |
| `Esc` | Close the popup |

## ✨ Features

### 🎯 Tab-preview overlay — the flagship

Press `⌘ K` and a command palette blends in over the current page; you never get bounced to a new tab.

<div align="center">

<img src="docs/screenshots/demo.gif" alt="Animated demo: opening the overlay, arrowing through tabs as previews update live, and switching tabs" width="900" />

<sub>Arrow through tabs and the preview updates live — switch with <kbd>Enter</kbd>, dismiss with <kbd>Esc</kbd>.</sub>

</div>

- **Universal intent search** across open tabs in **every window**, bookmarks,
  and recent local history, plus explicit direct-URL and web-search actions.
  Empty search stays tab-only and instant; bookmark/history lookups begin only
  after you type and are never retained by TabKnight. A query leaves the device
  only when you explicitly activate the web-search result.
- **Featured rail.** When you haven't typed anything, "Recent" and "Most visited" (top 5 each, by this session's visit count) surface above the full list with a subtle blue tint — the tabs you're most likely to want, one glance away.
- **Tiered, truthful previews.** Each result renders the best tier available *right now* and upgrades in place — no spinners, no empty panes, and nothing pretends to be higher fidelity than it is:
  - **Tier 0** — favicon + title (instant, always).
  - **Tier 0.5** — a typographic card (title, description, favicon over a theme-color gradient) when there's no usable image yet — designed, not broken.
  - **Tier 1** — rich card from page metadata (`og:image`, site name, description); logo-shaped or tiny `og:image`s are demoted back to the typographic card instead of showing an unrelated banner.
  - **Tier 2** — a real pixel thumbnail of the page, captured in the background at up to 1600px, locked to a 16/10 hero and never upscaled — small captures render crisp at natural size over a blurred copy of themselves. A **freshness chip** ("just now / 2m ago / 1h ago") shows exactly how current it is.
- **Row status glyphs** — audible, muted, pinned, sleeping, and other-window badges at a glance, so a list of 50+ tabs still reads at a glance.
- **Recency-grouped list** when you're not searching, so your most-relevant tabs are one glance away.
- **Auto-scroll** keeps the active row comfortably in view as you arrow through results.

### 🎧 Audio playground

Choose **Audio** beside Search to switch into **Audio mode** — a live list of every background tab that's playing or muted audio, complete with a CSS-only equalizer. Mute/unmute any tab instantly, or play/pause its media without switching to it. With Search focused, `Space` toggles playback and `←`/`→` mute; `Enter` jumps to the tab. Normal Tab/Shift+Tab navigation reaches every control.

<table>
  <tr>
    <td width="50%" valign="top">
      <img src="docs/screenshots/preview-docs.jpg" alt="TabKnight previewing a documentation tab with a live page thumbnail" />
      <br /><sub>A live page thumbnail for the highlighted tab — title, URL, and a snippet right beside it.</sub>
    </td>
    <td width="50%" valign="top">
      <img src="docs/screenshots/preview-card.jpg" alt="TabKnight previewing a profile tab as a rich metadata card" />
      <br /><sub>Rich metadata card when there's no thumbnail yet — it upgrades in place, never blank.</sub>
    </td>
  </tr>
</table>

### 🪟 Cross-window search & switch

Results span all of your Chrome windows. Selecting a tab focuses its destination window first, then activates it — a clean, stable jump even across displays.

### 🔎 Query-to-open

No match for what you typed? `Enter` opens it directly — as a URL if it looks like one, otherwise as a search in a fresh tab.

### 🔖 Bookmark-backed sessions

From the popup, treat a pile of tabs as a session:

- **Save** the current tabs into a bookmark folder — grouped by domain, bulk-selectable, with smart date-named folders.
- **Close** them in bulk right after saving (with a "copy all URLs" escape hatch).
- **Restore** any saved folder to reopen the whole set in one click.

### 🛡️ Works everywhere — even on `chrome://` pages

Chrome blocks extensions from injecting UI into its own internal pages (`chrome://extensions/`, `chrome://settings/`, …). On those — and on strict-CSP sites — TabKnight falls back to a temporary tab opened **in the same window**, using a blurred screenshot of your origin page as the backdrop (with halftone + vignette) so it still feels in-context. It self-cleans and returns focus to your page on `Esc`.

### 🔐 Privacy-first, with real controls

A first-run hint shows you the actual bound shortcut the first time you install (or offers to set one) and dismisses itself once you use it. The **options page** (right-click the toolbar icon → Options) shows live counts and the approximate size of your stored preview data, in plain language, with a one-click **Clear preview data** purge. See [`PRIVACY.md`](PRIVACY.md) for exactly what's collected and how it's capped.

Descriptions and visible-page excerpts are on by default for a richer local preview. Options can hide them on sensitive-looking URLs or everywhere. Restrictive modes also redact previously stored descriptions and excerpts; titles, URLs, preview images, and screenshots are controlled separately.

## 🧠 Under the hood

The capabilities that make it feel instant and reliable:

- **In-page without the mess.** The overlay is a content-script **shadow-DOM host** that paints a blurred backdrop, with an **extension-origin `<iframe>`** hosting the React panel. The shadow root isolates it from arbitrary site CSS; the iframe origin gives the panel direct IndexedDB access. If the iframe can't load (strict CSP), it falls back to a compact standalone tab that explains why and returns to the origin on Escape.
- **Privacy-safe invocation diagnostics.** The last 24 invocation outcomes are available in extension local storage under `invocationDiagnostics` for troubleshooting. Each event contains only overlay/fallback mode, a coarse cause, elapsed milliseconds, loading status, and discarded state—never a URL, title, query, or page content.
- **Snapshot pipeline — page → background → IndexedDB.** Content scripts can't reach the extension DB directly, so the content script *harvests* lightweight content cards (title, `og:*`, theme color, a short text excerpt) and messages them to the background service worker, which persists them to **IndexedDB** keyed by a normalized-URL hash.
- **Real thumbnails, politely captured.** The active tab is screenshotted via `chrome.tabs.captureVisibleTab`, downscaled to **WebP** at up to 1600px, and stored as a blob with its dimensions and capture time. Captures are **throttled per-tab and serialized globally** to respect Chrome's rate limits, and the store is **LRU-evicted** so it never grows unbounded.
- **Favicon fallback chain.** Each row tries the tab's own `favIconUrl`, then Chrome's local favicon cache (via the `favicon` permission — no network request), then a letter tile — all local, no network.
- **Per-session visit tracking.** The background worker counts tab activations for the current browser session (mirrored to `chrome.storage.session`) to power the "Most visited" featured section.
- **Local-first & private.** Everything lives in IndexedDB under `unlimitedStorage`. No servers, no accounts, no telemetry.
- **Predictable ranking.** Results use a fast, transparent heuristic — exact-title beats prefix beats substring, URL matches contribute, active/pinned tabs get a small boost, and ties resolve toward the current window.
- **Clean React core.** State via React Context + hooks; every Chrome API call is wrapped async/await in a single `chrome-api.ts` layer.

## 🔐 Permissions

Declared in [`public/manifest.json`](public/manifest.json) — each maps to a real feature:

| Permission | Why it's needed |
| --- | --- |
| `tabs` | Enumerate, activate, create, and close tabs; read titles/URLs/favicons |
| `bookmarks` | Save and restore tab sets as bookmark folders |
| `history` | Search matching titles and URLs in Chrome's local recent-history index; results stay in memory only while the command surface is open |
| `activeTab` | Keeps the overlay and thumbnail capture working on the current tab if you restrict site access to "when you click the extension" |
| `scripting` | (Re)inject the content script on supported pages; read a page's media-session info (track title/artwork) for the audio panel |
| `storage` | Hand off context between the background worker and the fallback UI; session-scoped visit counts |
| `unlimitedStorage` | Room for the IndexedDB snapshot + thumbnail store |
| `favicon` | Read favicons from Chrome's local cache (no network request) for the fallback favicon tier |
| `host_permissions: <all_urls>` | Run the overlay and capture previews on the sites you visit |

See [`PRIVACY.md`](PRIVACY.md) for the full data-handling story — what's collected, where it lives, retention limits, and how to purge it.

## 🧰 Tech stack

- **Bun** — bundler & runtime
- **TypeScript** (strict mode)
- **React 18**
- **Tailwind CSS** + **shadcn/ui** (Mira style)
- **Chrome Extension — Manifest V3** (service worker + content script)

## 🚀 Getting started

**Prerequisites:** [Bun](https://bun.sh/) and Google Chrome.

```bash
# install dependencies
bun install

# production build  →  ./dist
bun run build

# watch mode (rebuilds on change)
bun run dev

# type-check
bun run typecheck
```

### Load the unpacked extension

1. Open `chrome://extensions/`
2. Enable **Developer mode** (top-right)
3. Click **Load unpacked**
4. Select the generated **`dist/`** folder
5. After any code change, rebuild and click **Reload** on the extension card

## 🗺️ Project structure

```
tabknight/
├─ public/
│  ├─ manifest.json            # MV3 manifest — permissions, command, icons
│  └─ icons/                   # tabknight_icon.png (source) + icon16/32/48/128
├─ src/
│  ├─ background/index.ts      # service worker: command routing, capture, badge, visit counts, fallback
│  ├─ content/index.ts         # shadow-DOM overlay host + content harvester + CSP fallback
│  └─ popup/
│     ├─ App.tsx               # view router (overlay / standalone / popup / options)
│     ├─ views/                # TabPreview · TabNavigator · SaveTabs · CloseTabs · Restore · Options
│     ├─ components/           # tab list, favicon, domain groups, folder picker, shadcn/ui
│     ├─ hooks/                # useTabs, useBookmarks, useTabSelection, useListNavigation, useKeyboardShortcuts
│     └─ lib/
│        ├─ chrome-api.ts      # async wrappers around Chrome APIs
│        ├─ rank.ts            # shared scoreTab ranking heuristic
│        └─ preview/           # harvester · db (IndexedDB) · thumbnail · hash
├─ config/build.ts            # Bun build orchestration
├─ docs/screenshots/         # README imagery (overlay, previews, demo gif)
├─ PRIVACY.md                 # what's collected, where it lives, how to purge it
└─ CHANGELOG.md               # release history
```

## 🔢 Versioning

Semantic versioning while in `0.x`. Every shipped fix or feature bumps the version in **both** `package.json` and `public/manifest.json` (kept in sync), in the same commit as the change. See [`CHANGELOG.md`](CHANGELOG.md).

## 📄 License

[MIT](./LICENSE) © 2025 Aitor Gallardo
