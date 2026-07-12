# Chrome Web Store — submission pack

Copy-paste material for the CWS developer dashboard, in dashboard order.
Everything below is verified against the code as of v0.27.0.

---

## 1. Product summary (max 132 chars)

> Keyboard-first tab switcher: press one shortcut to search, preview, and jump between tabs in every window. All data stays local.

**128 characters.** Plain text, no emoji.

## 2. Detailed description

```
TabKnight turns Chrome's tabs into a fast, keyboard-driven command palette that appears right over the page you're on.

Press Cmd+K (macOS) or Ctrl+Shift+K (Windows/Linux) and an overlay blends in over your current page — you never get bounced to a new tab. Type to fuzzy-search every open tab in every Chrome window, arrow through the results while a live preview shows where you're going, and press Enter to jump there.

FEATURES

- In-page overlay: opens on top of the current page; on restricted pages (like chrome:// pages) it falls back to a temporary tab in the same window.
- Search and switch across all windows: results span every Chrome window; selecting a tab focuses its window, then activates it.
- Live previews: each result shows the best preview available — favicon and title instantly, a rich metadata card, or a real thumbnail of the page with a freshness indicator. Never a spinner, never a blank pane.
- Audio controls: press Tab to see every tab playing or muting audio. Play/pause and mute/unmute any tab without switching to it.
- Save and restore sessions: from the toolbar popup, save a set of tabs into a bookmark folder (grouped by domain), close them in bulk, and restore the whole set later in one click.
- Query-to-open: no matching tab? Enter opens what you typed as a URL or a search.
- Keyboard-first: arrows, Enter, Tab, and Esc do everything; the search input stays focused.

PRIVACY

Everything stays on your device. Tab titles, URLs, page snippets, and thumbnails are stored locally in your browser (IndexedDB) with hard caps and automatic pruning. No servers, no accounts, no analytics, no data ever leaves your machine. The options page shows exactly what's stored and clears it in one click. Full policy: https://github.com/AitorGallardo/tabknight/blob/main/PRIVACY.md

OPEN SOURCE

MIT-licensed. Source code, changelog, and issue tracker: https://github.com/AitorGallardo/tabknight
```

## 3. Category & language

- **Category:** Productivity > Workflow & Planning
- **Language:** English

## 4. Single-purpose statement

> TabKnight's single purpose is keyboard-driven tab navigation: searching, previewing, and switching between the user's open tabs, and saving/restoring sets of tabs as bookmark folders.

## 5. Permission justifications

**`tabs`**
> Reads the titles and URLs of the user's open tabs to build the searchable tab list, and activates, opens, mutes, or closes tabs when the user acts on a result. Tab data is processed and stored only on the user's device.

**`bookmarks`**
> Powers the save/restore sessions feature: the user's selected tabs are saved into a bookmark folder they choose, and previously saved folders can be reopened as tabs. No bookmark data leaves the device.

**`activeTab`**
> Chrome lets users restrict an extension's site access to "when you click the extension". For users who choose that stricter setting, `activeTab` grants temporary access to the current tab at the moment they invoke TabKnight's keyboard shortcut, so the overlay and the thumbnail capture of that tab keep working. It adds no install warning beyond the host permission and grants nothing the user didn't just request.

**`scripting`**
> Re-injects the extension's own bundled content script into already-open tabs after install/update and on demand (the script that renders the overlay and enables per-tab audio controls), and runs a small bundled snippet to read a tab's media-session metadata (track title/artwork) for the audio view. No remote code is ever executed.

**`storage`**
> Stores small local flags (e.g. whether the first-run shortcut hint was dismissed), hands off context to the fallback view on restricted pages, and keeps session-scoped tab-visit counts (cleared when the browser closes) for the "Most visited" section. Local only.

**`unlimitedStorage`**
> The preview cache stores small WebP thumbnails and text snapshots of the user's open tabs in IndexedDB. It is hard-capped (300 snapshots / 150 thumbnails, oldest evicted first), but thumbnail blobs need headroom beyond default quotas under storage pressure. All data stays on the device.

**`favicon`**
> Reads site favicons from Chrome's local favicon cache to display next to each result when a tab doesn't expose its own icon — a local read with no network request.

**Host permission `<all_urls>` (and the `<all_urls>` content script)**
> The extension's core interaction is a keyboard shortcut (Cmd+K / Ctrl+Shift+K) that must instantly render the overlay on whatever page the user is currently viewing — without a prior click on the extension icon, which is why a permission granted only on toolbar-icon click is not sufficient. The content script also harvests lightweight preview data (title, description, theme color, a short text excerpt) from the user's open tabs in the background so previews are ready before the overlay is opened, and capturing the visible tab's thumbnail requires host access to the page being captured. All harvested data is stored only on the user's device; the extension makes no network requests.

## 6. Remote code

- **Are you using remote code?** **No.** Manifest V3; all JavaScript is bundled in the package. No remote scripts, no eval, no CDN imports.

## 7. Data usage (Privacy practices tab)

**Check these two categories:**

- **Web history** — the extension reads titles/URLs of open tabs and keeps session-scoped visit counts; stored only on the user's device.
- **Website content** — the extension stores page text excerpts, metadata, and screenshots of the user's own tabs; stored only on the user's device.

**Leave all other categories unchecked:** personally identifiable information, health information, financial and payment information, authentication information, personal communications, location, **user activity**.

> Why "User activity" is unchecked: keystrokes and clicks are handled transiently for overlay navigation and never recorded, and per-session tab-visit counts are already disclosed under Web history.

**Certify all three Limited Use disclosures:**

- [x] I do not sell or transfer user data to third parties, outside of the approved use cases
- [x] I do not use or transfer user data for purposes that are unrelated to my item's single purpose
- [x] I do not use or transfer user data to determine creditworthiness or for lending purposes

## 8. Privacy policy URL

```
https://github.com/AitorGallardo/tabknight/blob/main/PRIVACY.md
```

## 9. Homepage & support URLs

- **Homepage URL:** `https://github.com/AitorGallardo/tabknight`
- **Support URL:** `https://github.com/AitorGallardo/tabknight/issues`

## 10. Distribution

Submit with **"Publish automatically after review" unchecked** (review the listing once approved, then publish manually). Visibility: **Public** — or **Unlisted** first for a soft launch, flipping to Public later without re-review of the package.
