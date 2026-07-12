# Chrome Web Store submission runbook

Step-by-step instructions for publishing TabKnight. Every text to paste lives in
[`listing.md`](listing.md); every image lives in [`images/`](images/). Steps marked
**[YOU]** need the account owner — nothing else does.

Verified against Chrome Web Store requirements as of July 2026.

## 0. One-time account setup — [YOU]

1. Go to the [Developer Dashboard](https://chrome.google.com/webstore/devconsole)
   signed in with the developer account.
2. Pay the **one-time $5 registration fee** and accept the developer agreement.
   Note: the developer email cannot be changed later.
3. Enable **2-Step Verification** on the Google account
   ([myaccount.google.com/security](https://myaccount.google.com/security)) —
   publishing is blocked without it.
4. Dashboard > Account: set the **publisher display name** (shown publicly under
   the extension title), add the **contact email**, and click **verify** on it
   (click the link Google sends).
5. Account > **Trader declaration**: declare **Non-trader** (free, open-source,
   no monetization — no verification burden, nothing extra published on the
   listing). Skipping this risks EU delisting.

## 1. Build the package

```sh
bun run package
```

Produces `release/tabknight-v<version>.zip` (~160 KB, manifest at zip root).
Sanity-check the printed zip listing: 14 files, no `.DS_Store`, no oversized icons.

## 2. Create the item and upload

1. Dashboard > **+ New item** > upload the zip.
2. The draft opens. Work through the tabs in the order below.

## 3. Store listing tab

Copy from `listing.md`:

- **Description**: the detailed description (§2). The short summary is taken
  automatically from the manifest `description` (already the 128-char line).
- **Category**: Productivity > **Workflow & Planning**. **Language**: English.
- **Store icon**: upload `public/icons/icon128.png`.
- **Screenshots** (1280x800): upload all four from `images/` in this order:
  `screenshot-1-overlay.png`, `screenshot-2-search.png`,
  `screenshot-3-options.png`, `screenshot-4-popup.png`.
- **Small promo tile** (440x280): `images/tile-small-440x280.png` — affects
  ranking; do not skip.
- **Marquee** (1400x560): `images/marquee-1400x560.png` (optional, enables
  featuring eligibility).
- **Homepage URL**: the GitHub repo. **Support URL**: the repo's issues page.

## 4. Privacy tab (all fields block submission)

Copy from `listing.md`:

- **Single-purpose statement** (§4).
- **Permission justifications** (§5) — one box per permission, including
  `activeTab` and the host permission.
- **Remote code**: **No** (§6).
- **Data usage**: check **Web history** and **Website content** only; leave all
  other categories unchecked (§7). Check all three certifications (no sale,
  no unrelated use/transfer, no creditworthiness use).
- **Privacy policy URL**:
  `https://github.com/AitorGallardo/tabknight/blob/main/PRIVACY.md`

## 5. Distribution tab

- **Visibility**: Public (or **Unlisted** for a soft launch — flipping to
  Public later needs no re-review).
- Payments: Free. Distribution: all regions.

## 6. Submit — [YOU]

1. Click **Submit for review**.
2. **Uncheck "Publish automatically after review"** — after approval you get 30
   days to press Publish yourself, which lets you time the launch.
3. Expected review time: this extension has broad host permissions on a new
   account, so plan for **1-4 weeks** (most items clear in ~3 days). If pending
   more than 3 weeks, contact One Stop Support from the dashboard.

## 7. If rejected

The rejection email names the policy area. The likely candidates and their
answers (all already prepared):

- **Permission scope** — point at the per-permission justifications (§5) and
  the local-only architecture in `PRIVACY.md`; the repo being open source
  helps, link it.
- **Privacy disclosure mismatch** — the listing, `PRIVACY.md`, and the code
  tell the same story; re-check any new feature landed since this runbook.
- Appeal from the item page, or fix + resubmit (bump the manifest version —
  the store requires strictly increasing versions on every upload).

## 8. After approval

1. Press **Publish** on the dashboard (within 30 days).
2. Tag the release in git: `git tag v<version> && git push --tags`, create a
   GitHub Release, attach the store zip.
3. Add the Chrome Web Store badge/link to `README.md`.
4. Every future store upload: bump the version in `public/manifest.json` +
   `package.json` (same commit, per the versioning policy), update
   `CHANGELOG.md`, run `bun run package`, upload the new zip — updates go
   through review too, usually faster.
