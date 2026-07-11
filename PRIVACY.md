# Privacy

TabKnight is a local tool. It does not send data anywhere.

## What it collects

To power tab previews (the Cmd+K overlay), TabKnight:

- Reads each page's title, meta description, `og:image`, `og:site_name`, and
  theme color, plus a short excerpt of visible text.
- Captures a screenshot of the tab you're currently viewing (via Chrome's
  `captureVisibleTab`), downscaled to a small WebP image.

## Where it lives

Everything is stored **locally in your browser**, in an IndexedDB database
scoped to the extension (`tabknight-preview`). Nothing is uploaded, synced,
or transmitted anywhere:

- No network requests.
- No analytics or telemetry.
- No third-party services.

## Retention

Storage is capped and self-pruning (LRU by last-captured time):

- Up to 300 page snapshots ("cards").
- Up to 150 screenshots ("thumbnails").

Older entries are evicted automatically as new ones are captured.

## Deleting your data

Open TabKnight's options page (right-click the toolbar icon → Options) and
use **Clear preview data** to wipe both stores immediately. Uninstalling the
extension also removes all of its local storage.
