# TabKnight

Keyboard-first Chrome extension for tab management.

## Features

- **Save tabs as bookmarks** - Save individual tabs or all open tabs to a bookmark folder
- **Domain grouping** - Tabs are automatically grouped by domain for easy browsing
- **Session restore** - Restore previously saved tab sessions with one click
- **Keyboard shortcuts** - Navigate and manage tabs entirely from the keyboard
- **Search & filter** - Quickly find tabs by title or URL

## Coming Soon

- **Command palette** (cmdk) - Quick actions via a command palette interface

## Development

### Prerequisites

- [Bun](https://bun.sh/) runtime

### Setup

```bash
bun install
```

### Dev build (with watch)

```bash
bun run dev
```

### Production build

```bash
bun run build
```

### Load in Chrome

1. Go to `chrome://extensions/`
2. Enable "Developer mode"
3. Click "Load unpacked"
4. Select the `dist/` directory

## Tech Stack

- TypeScript (strict mode)
- React 18
- Tailwind CSS
- shadcn/ui (Mira style)
- Bun (bundler & runtime)
- Chrome Extension Manifest V3

## License

[MIT](LICENSE)
