/**
 * Content-card harvester — runs in the *page* context (content script).
 *
 * It reads the live DOM and builds a lightweight, text-first snapshot. It does
 * NOT touch IndexedDB (the page origin can't reach the extension's DB); it just
 * builds the card and the content script messages it to the background.
 *
 * Everything here is best-effort and defensive: a missing tag is just an
 * undefined field, never a throw.
 */
import type { ContentCard } from "./types";
import { hashUrl } from "./hash";

const EXCERPT_MAX_CHARS = 600;

function meta(selectors: string[]): string | undefined {
  for (const selector of selectors) {
    const el = document.querySelector<HTMLMetaElement>(selector);
    const content = el?.content?.trim();
    if (content) return content;
  }
  return undefined;
}

function absoluteUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    return new URL(value, document.location.href).href;
  } catch {
    return undefined;
  }
}

function faviconUrl(): string | undefined {
  const link = document.querySelector<HTMLLinkElement>(
    "link[rel~='icon'], link[rel='shortcut icon'], link[rel='apple-touch-icon']"
  );
  return absoluteUrl(link?.getAttribute("href") ?? undefined);
}

/** Pull a readable text excerpt, preferring the main content region. */
function extractExcerpt(): string | undefined {
  const root =
    document.querySelector("article") ||
    document.querySelector("main") ||
    document.querySelector("[role='main']") ||
    document.body;

  if (!root) return undefined;

  const text = (root as HTMLElement).innerText || "";
  const collapsed = text.replace(/\s+/g, " ").trim();
  if (!collapsed) return undefined;

  return collapsed.length > EXCERPT_MAX_CHARS
    ? `${collapsed.slice(0, EXCERPT_MAX_CHARS).trimEnd()}…`
    : collapsed;
}

/** Build a ContentCard from the current document. */
export function extractContentCard(includePageText = true): ContentCard {
  const url = document.location.href;

  return {
    urlHash: hashUrl(url),
    url,
    title: (document.title || url).trim(),
    description: includePageText
      ? meta([
          "meta[property='og:description']",
          "meta[name='description']",
          "meta[name='twitter:description']",
        ])
      : undefined,
    ogImage: absoluteUrl(
      meta(["meta[property='og:image']", "meta[name='twitter:image']", "meta[name='twitter:image:src']"])
    ),
    siteName: meta(["meta[property='og:site_name']"]),
    themeColor: meta(["meta[name='theme-color']"]),
    excerpt: includePageText ? extractExcerpt() : undefined,
    favIconUrl: faviconUrl(),
    scrollY: Math.round(window.scrollY) || 0,
    capturedAt: Date.now(),
  };
}
