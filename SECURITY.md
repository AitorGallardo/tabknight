# Security Policy

## Supported versions

Only the latest release is supported. Older versions receive no fixes —
update to the current version before reporting.

## Reporting a vulnerability

Please report vulnerabilities **privately** via GitHub's private vulnerability
reporting: go to the repository's **Security** tab and click **Report a
vulnerability** (this opens a draft security advisory visible only to the
maintainer). Do not open a public issue for security problems.

Include what you can: affected version, steps to reproduce, and impact.

## Response time

TabKnight is maintained by a single person, so responses are best effort.
Expect an acknowledgment within a week or so; fixes for confirmed issues are
prioritized over feature work.

## Scope

TabKnight stores everything locally in the browser (IndexedDB and
`chrome.storage`) and makes **no network requests of its own** — there are no
servers, accounts, or telemetry; preview images (a page's `og:image` or media
artwork) are loaded by the browser directly from the site that published them. The main areas of interest are the content script /
overlay injection, message passing between page, content script, and
background worker, and handling of captured page data. See
[PRIVACY.md](PRIVACY.md) for the full data-handling story.
