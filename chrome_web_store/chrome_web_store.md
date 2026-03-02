# TabKnight Chrome Web Store Listing Kit

This document is the working source for Chrome Web Store copy, screenshot planning, and merchandising assets.

## Positioning

TabKnight is a keyboard-first Chrome tab navigator for users who keep many tabs open and need faster switching than Chrome's default surfaces provide.

Core angle:
- Arc-inspired quick switcher feel
- same-window navigation
- cross-window tab activation
- bookmark-backed session save/restore
- practical fallback for Chrome-native pages

## Value Proposition

TabKnight gives heavy tab users a faster, cleaner command surface for moving through open tabs and restoring saved tab sets.

It is built for people who:
- keep dozens of tabs open
- work across multiple Chrome windows
- want a command-palette workflow instead of hunting through tab strips
- need bookmark-backed session recovery without a heavy session manager

## Short Description

Arc-style, keyboard-first Chrome tab navigator with fast tab switching, cross-window activation, and bookmark-backed session restore.

## Long Description

TabKnight brings an Arc-inspired quick switcher to Chrome with a keyboard-first tab navigator built for speed.

Use `Cmd+K` to open a focused tab search surface, filter open tabs by title or URL, and jump directly to the tab you need, even across Chrome windows. Results include normal tabs and Chrome-native tabs like `chrome://extensions/`, so the navigator reflects your real browsing context instead of a limited subset.

On normal web pages, TabKnight opens as a translucent in-page command dialog with strong keyboard handling and full-scroll results. On restricted Chrome-native pages where extensions cannot inject UI directly, TabKnight falls back to a temporary same-window navigator tab with a contextual blurred backdrop so the experience remains coherent.

Beyond navigation, TabKnight also lets you save open tabs as bookmark-backed sessions, close them in bulk, and restore them later from the extension popup.

Key capabilities:
- Arc-style tab search and switching
- keyboard-first navigation with arrow keys and Enter
- cross-window tab activation
- full open-tab result list, including Chrome-native tabs
- URL/search query opening from the navigator
- save, close, and restore tab sessions using bookmark folders

## Suggested Store Categories / Keywords

Primary themes:
- Productivity
- Workflow
- Tabs
- Session management

Suggested keywords:
- tab manager
- tab search
- command palette
- quick switcher
- session restore
- bookmark sessions
- productivity chrome extension

## Screenshot Plan

Store screenshots should prove the workflow in sequence.

### Screenshot 1: Hero

Goal:
- communicate the Arc-style navigator immediately

Capture:
- in-page overlay open on a visually rich page
- query entered
- 5-8 strong results visible
- active row highlighted

Suggested filename:
- `01-hero-arc-overlay.png`

### Screenshot 2: Cross-window Switching

Goal:
- show that TabKnight can jump to tabs across windows

Capture:
- result list with tabs from multiple windows
- current active result clearly marked

Suggested filename:
- `02-cross-window-switching.png`

### Screenshot 3: Chrome-native Page Fallback

Goal:
- explain restricted-page support without overexplaining browser internals

Capture:
- temporary fallback navigator tab opened from `chrome://extensions/`
- blurred contextual background visible

Suggested filename:
- `03-chrome-native-fallback.png`

### Screenshot 4: Save Tabs Flow

Goal:
- show bookmark-backed session saving

Capture:
- popup save flow with grouped tabs and selection UI

Suggested filename:
- `04-save-tabs-flow.png`

### Screenshot 5: Restore Flow

Goal:
- show session recovery utility

Capture:
- popup restore flow with a saved bookmark folder selected

Suggested filename:
- `05-restore-tabs-flow.png`

## Promo Graphic Notes

The visual language should match the product:
- dark background
- translucent panel treatment
- clean keyboard-first UI focus
- no cluttered browser chrome if possible
- emphasize the command surface, not the entire browser

Recommended callouts:
- “Switch tabs instantly”
- “Arc-style quick switcher for Chrome”
- “Search across all open tabs”

## Permissions Disclosure (User-facing)

Use plain-language permission notes if needed:
- `tabs`: needed to list and switch between your open tabs
- `bookmarks`: needed to save and restore tab groups as bookmark folders
- `windows`: needed to focus the correct Chrome window when switching tabs
- `storage`: needed to preserve temporary navigator state during restricted-page fallback
- `scripting`: needed to open the in-page navigator on supported pages

## Store Submission Checklist

- verify screenshots are current and match the shipped UI
- confirm version in store notes matches `/Users/aitor/dev/tabknight/public/manifest.json`
- confirm short description fits store character limits
- confirm long description does not promise unsupported behavior such as overriding `Cmd+T`
- test `Cmd+K` on both a normal page and `chrome://extensions/`
- test save / close / restore flows before submission

## Asset Directory

Place prepared store assets in:
- `/Users/aitor/dev/tabknight/chrome_web_store/images/`
