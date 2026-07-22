import { scoreTab } from "./rank";

export interface IntentTab {
  id: number;
  windowId: number;
  title: string;
  url: string;
  favIconUrl?: string;
  pinned: boolean;
  active: boolean;
  index: number;
  lastAccessed: number;
  audible?: boolean;
  muted?: boolean;
  discarded?: boolean;
  splitViewId?: number | null;
  splitPartnerTitle?: string;
}

export interface IntentBookmark {
  id: string;
  title: string;
  url: string;
  dateAdded?: number;
}

export interface IntentHistoryEntry {
  id: string;
  title: string;
  url: string;
  lastVisitTime?: number;
  visitCount?: number;
}

export type IntentResult =
  | { type: "tab"; key: string; sourceLabel: "Open tab"; actionLabel: "Switch to tab"; score: number; tab: IntentTab }
  | { type: "bookmark"; key: string; sourceLabel: "Bookmark"; actionLabel: "Open bookmark"; score: number; title: string; url: string }
  | { type: "history"; key: string; sourceLabel: "History"; actionLabel: "Open from history"; score: number; title: string; url: string }
  | { type: "direct"; key: string; sourceLabel: "Direct URL"; actionLabel: "Go to site"; score: number; title: string; url: string }
  | { type: "search"; key: string; sourceLabel: "Web search"; actionLabel: "Search the web"; score: number; title: string; url: string };

const SOURCE_WEIGHT: Record<IntentResult["type"], number> = {
  tab: 5_000,
  bookmark: 4_000,
  history: 3_000,
  direct: 2_000,
  search: 1_000,
};

function textScore(title: string, url: string, query: string): number {
  const q = normalizeQuery(query);
  if (!q) return 0;
  const normalizedTitle = title.toLowerCase();
  const normalizedUrl = url.toLowerCase();
  let score = 0;
  if (normalizedTitle === q) score += 520;
  else if (normalizedTitle.startsWith(q)) score += 280;
  else if (normalizedTitle.includes(q)) score += 190;
  if (normalizedUrl.includes(q)) score += 130;
  return score;
}

export function normalizeQuery(query: string): string {
  return query.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
}

function canonicalHttpUrl(value: string): string | null {
  const href = navigableHttpUrl(value);
  if (!href) return null;
  try {
    const url = new URL(href);
    url.hash = "";
    return url.href;
  } catch {
    return null;
  }
}

function navigableHttpUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

/** Convert a query to a navigable URL when it expresses a host or URL intent. */
export function directUrlForQuery(query: string): string | null {
  const value = query.normalize("NFKC").trim();
  if (!value || /\s/.test(value)) return null;
  if (/^https?:\/\//i.test(value)) {
    try {
      return new URL(value).href;
    } catch {
      return null;
    }
  }
  const localHostInput = /^(localhost|\d{1,3}(?:\.\d{1,3}){3})(:\d+)?(?:\/|$)/i.test(value);
  if (/^[a-z][a-z\d+.-]*:/i.test(value) && !localHostInput) return null;
  if (!value.includes(".") && !localHostInput) return null;
  const host = value;
  try {
    const url = new URL(`https://${host}`);
    const isLocalhost = url.hostname === "localhost";
    const isIpv4 = /^\d{1,3}(?:\.\d{1,3}){3}$/.test(url.hostname);
    return url.hostname.includes(".") || isLocalhost || isIpv4 ? url.href : null;
  } catch {
    return null;
  }
}

export function webSearchUrl(query: string): string {
  return `https://www.google.com/search?q=${encodeURIComponent(query.trim())}`;
}

export interface RankIntentInput {
  query: string;
  tabs: IntentTab[];
  bookmarks?: IntentBookmark[];
  history?: IntentHistoryEntry[];
  currentWindowId?: number | null;
}

/**
 * Pure, deterministic universal ranking. Source weights keep open tabs first,
 * while relevance determines ordering inside each source. Final key sorting
 * makes the same input produce the same output even when Chrome returns ties.
 */
export function rankIntentResults({
  query,
  tabs,
  bookmarks = [],
  history = [],
  currentWindowId = null,
}: RankIntentInput): IntentResult[] {
  const q = normalizeQuery(query);
  if (!q) return [];
  const destinationQuery = query.normalize("NFKC").trim().replace(/\s+/g, " ");

  const results: IntentResult[] = [];
  for (const tab of tabs) {
    const relevance = scoreTab(tab, q);
    if (relevance > 0) {
      results.push({
        type: "tab",
        key: `tab:${tab.id}`,
        sourceLabel: "Open tab",
        actionLabel: "Switch to tab",
        score: SOURCE_WEIGHT.tab + relevance + (tab.windowId === currentWindowId ? 8 : 0),
        tab,
      });
    }
  }

  const bookmarkUrls = new Set<string>();
  for (const bookmark of bookmarks) {
    const url = navigableHttpUrl(bookmark.url);
    const canonicalUrl = url ? canonicalHttpUrl(url) : null;
    if (!url || !canonicalUrl || bookmarkUrls.has(canonicalUrl)) continue;
    const relevance = textScore(bookmark.title, bookmark.url, q);
    if (relevance > 0) {
      bookmarkUrls.add(canonicalUrl);
      results.push({
        type: "bookmark",
        key: `bookmark:${bookmark.id}`,
        sourceLabel: "Bookmark",
        actionLabel: "Open bookmark",
        score: SOURCE_WEIGHT.bookmark + relevance,
        title: bookmark.title || bookmark.url,
        url,
      });
    }
  }

  const historyUrls = new Set<string>();
  for (const entry of history) {
    const url = navigableHttpUrl(entry.url);
    const canonicalUrl = url ? canonicalHttpUrl(url) : null;
    if (!url || !canonicalUrl || bookmarkUrls.has(canonicalUrl) || historyUrls.has(canonicalUrl)) continue;
    const relevance = textScore(entry.title, entry.url, q);
    if (relevance > 0) {
      historyUrls.add(canonicalUrl);
      const visitBoost = Math.min(20, Math.max(0, entry.visitCount ?? 0));
      results.push({
        type: "history",
        key: `history:${canonicalUrl}`,
        sourceLabel: "History",
        actionLabel: "Open from history",
        score: SOURCE_WEIGHT.history + relevance + visitBoost,
        title: entry.title || entry.url,
        url,
      });
    }
  }

  const strongestDestination = [...results].sort(
    (a, b) => b.score - a.score || a.key.localeCompare(b.key)
  )[0];
  const strongestUrl = strongestDestination?.type === "tab" ? strongestDestination.tab.url : strongestDestination?.url;
  const inferredDirectUrl = strongestUrl ? canonicalHttpUrl(strongestUrl) : null;
  const inferredOrigin = inferredDirectUrl ? new URL(inferredDirectUrl).origin + "/" : null;
  const directUrl = directUrlForQuery(destinationQuery) ?? inferredOrigin;
  if (directUrl) {
    results.push({
      type: "direct",
      key: `direct:${directUrl}`,
      sourceLabel: "Direct URL",
      actionLabel: "Go to site",
      score: SOURCE_WEIGHT.direct,
      title: `Go to ${new URL(directUrl).host}`,
      url: directUrl,
    });
  }

  const searchUrl = webSearchUrl(destinationQuery);
  results.push({
    type: "search",
    key: `search:${q.toLowerCase()}`,
    sourceLabel: "Web search",
    actionLabel: "Search the web",
    score: SOURCE_WEIGHT.search,
    title: `Search for “${destinationQuery}”`,
    url: searchUrl,
  });

  return results.sort((a, b) => b.score - a.score || a.key.localeCompare(b.key));
}
