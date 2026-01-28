import { SYSTEM_URL_PATTERNS } from "./constants";

/**
 * Extract domain from URL
 */
export function extractDomain(url: string): string {
  try {
    const urlObj = new URL(url);
    return urlObj.hostname;
  } catch {
    return "unknown";
  }
}

/**
 * Format date as YYYY-MM-DD
 */
export function formatDate(date: Date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Check if URL is a system tab that should be filtered
 */
export function isSystemUrl(url: string): boolean {
  return SYSTEM_URL_PATTERNS.some((pattern) => pattern.test(url));
}

/**
 * Generate folder name with suffix for duplicates
 * e.g., "2026-01-26" -> "2026-01-26 (2)"
 */
export function generateFolderNameWithSuffix(
  baseName: string,
  existingNames: string[]
): string {
  if (!existingNames.includes(baseName)) {
    return baseName;
  }

  let suffix = 2;
  let newName = `${baseName} (${suffix})`;

  while (existingNames.includes(newName)) {
    suffix++;
    newName = `${baseName} (${suffix})`;
  }

  return newName;
}

/**
 * Find duplicate URLs in a list of tabs
 * Returns a Set of URLs that appear more than once
 */
export function findDuplicateUrls(urls: string[]): Set<string> {
  const seen = new Set<string>();
  const duplicates = new Set<string>();

  for (const url of urls) {
    if (seen.has(url)) {
      duplicates.add(url);
    }
    seen.add(url);
  }

  return duplicates;
}

/**
 * Group items by a key function
 */
export function groupBy<T, K extends string>(
  items: T[],
  keyFn: (item: T) => K
): Record<K, T[]> {
  return items.reduce(
    (groups, item) => {
      const key = keyFn(item);
      if (!groups[key]) {
        groups[key] = [];
      }
      groups[key].push(item);
      return groups;
    },
    {} as Record<K, T[]>
  );
}

/**
 * Copy text to clipboard
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/**
 * Truncate text with ellipsis
 */
export function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 1) + "...";
}
