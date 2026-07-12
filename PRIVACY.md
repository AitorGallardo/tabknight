# Privacy Policy

**Last updated: July 12, 2026**

TabKnight is a local tool. Everything it captures stays in your browser, on
your device. It has no servers, and it never sends your data anywhere.

## What it captures

To power tab previews (the Cmd+K overlay) and tab search, TabKnight handles:

- **Screenshots of your own tabs.** The tab you're currently viewing is
  screenshotted via Chrome's `captureVisibleTab`, downscaled to a small WebP
  image (max 1600px wide). Only the active tab is ever captured — never
  background tabs, and never anything outside the browser.
- **Lightweight content cards** harvested from pages you have open: the page's
  title, meta description, `og:image` URL, `og:site_name`, theme color, and a
  short excerpt of visible text.
- **Tab titles and URLs** of your open tabs, read to build the searchable tab
  list. Per-session tab-visit counts power the "Most visited" section and are
  discarded when you close the browser.
- **Favicons**, read from Chrome's local favicon cache (no network request).

## Where it lives

Everything is stored **locally in your browser**, on your device:

- Content cards and screenshots live in an IndexedDB database scoped to the
  extension (`tabknight-preview`).
- A handful of small flags (e.g. the dismissed first-run hint) and
  session-scoped visit counts live in `chrome.storage.local` /
  `chrome.storage.session`.

## What never happens

- **No transmission.** TabKnight makes no network requests of its own; nothing
  is uploaded, synced, or sent to any server.
- **No servers, no accounts.** There is no TabKnight backend.
- **No analytics or telemetry.** Zero tracking of any kind.
- **No sale or sharing.** Your data is never sold, shared, or disclosed to
  third parties — there is no mechanism by which it could be.

One honest nuance: when the preview pane shows a page's own preview image
(its `og:image` or media artwork), your browser loads that image directly from
the site that published it — the same image the site already serves. No
TabKnight or third-party server is involved.

## Retention and deletion

Storage is capped and self-pruning (LRU, oldest first):

- Up to **300** page snapshots ("cards").
- Up to **150** screenshots ("thumbnails").
- Session visit counts are cleared automatically when the browser closes.

Older entries are evicted automatically as new ones are captured. To delete
everything now, open TabKnight's options page (right-click the toolbar icon →
Options) and use **Clear preview data**. **Uninstalling the extension removes
all of its local storage.**

## Permissions, briefly

Each permission maps to a feature; none is used for data collection beyond
what's described above:

| Permission | Purpose |
| --- | --- |
| `tabs` | Read titles/URLs of open tabs for search; switch, open, and close tabs |
| `bookmarks` | Save and restore tab sets as bookmark folders |
| `activeTab` | Temporary access to the current tab when you invoke the shortcut, for users who restrict site access to on-click |
| `scripting` | (Re)inject the overlay/content script; read a tab's media-session metadata for audio controls |
| `storage`, `unlimitedStorage` | Store previews and small flags on-device |
| `favicon` | Read favicons from Chrome's local cache |
| Host access (`<all_urls>`) | Show the overlay on the page you're on and capture/harvest previews of your open tabs |

## Changes to this policy

If TabKnight's data handling ever changes, this document will be updated (with
a new "Last updated" date) before the change ships, and the change will be
noted in the [CHANGELOG](CHANGELOG.md). The current version always lives at
<https://github.com/AitorGallardo/tabknight/blob/main/PRIVACY.md>.

## Contact

Questions or concerns? Open an issue:
<https://github.com/AitorGallardo/tabknight/issues>
