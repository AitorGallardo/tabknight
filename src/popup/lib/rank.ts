export interface RankableTab {
  title: string;
  url: string;
  active: boolean;
  pinned: boolean;
  lastAccessed: number;
}

export function scoreTab(tab: RankableTab, query: string): number {
  const q = query.toLowerCase();
  if (!q) {
    return (tab.active ? 300 : 0) + (tab.pinned ? 30 : 0) + tab.lastAccessed / 1_000_000;
  }
  const title = tab.title.toLowerCase();
  const url = tab.url.toLowerCase();
  let score = 0;
  if (title === q) score += 520;
  if (title.startsWith(q)) score += 280;
  if (title.includes(q)) score += 190;
  if (url.includes(q)) score += 130;
  if (tab.active) score += 20;
  if (tab.pinned) score += 12;
  return score;
}
