# Contributing to TabKnight

Thanks for helping out. Here's everything you need.

## Dev setup

Prerequisites: [Bun](https://bun.sh/) and Google Chrome.

```bash
bun install
bun run dev        # watch mode, rebuilds into ./dist
```

Load the extension: open `chrome://extensions/`, enable **Developer mode**,
click **Load unpacked**, and select the `dist/` folder. After a rebuild, click
**Reload** on the extension card.

## Quality gates

Both must pass before you open a PR:

```bash
bun run typecheck  # TypeScript strict mode, no emit
bun run smoke      # e2e test — launches headless Chrome with the built extension
```

The smoke test finds Chrome automatically on macOS and Linux; set `CHROME_PATH`
if yours lives somewhere unusual.

## Commit style

Conventional Commits:
`type(scope): summary` — types `feat`, `fix`, `chore`, `refactor`, `docs`,
`perf`, `test`, `build`. Summary ≤ 60 chars, imperative mood, lowercase, no
trailing period. Prefer a one-line commit; add a body only when it carries
real signal (the why, a breaking change, a caveat).

## Versioning

Every shipped fix or feature bumps the semver version in **both**
`public/manifest.json` and `package.json` (kept in sync), in the same commit
as the change. Patch for fixes and internal changes, minor for user-facing
features. Update `CHANGELOG.md` alongside.

## PR flow

1. Branch off `main` (`feat/...`, `fix/...`).
2. Open a PR against `main` — small and focused beats big and sprawling.
3. CI runs typecheck, build, and smoke; once green and reviewed, it merges.
