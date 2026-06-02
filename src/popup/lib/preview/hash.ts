/**
 * Stable, short key for a tab's content, derived from its URL.
 *
 * We normalize before hashing so that the same page shares one snapshot across
 * duplicate tabs and survives reloads/reordering:
 *  - drop the hash fragment (#section) — same document
 *  - lowercase the host
 *  - keep the query string (it usually changes the content)
 *
 * The hash itself is FNV-1a (synchronous, no async crypto needed).
 */
export function normalizeUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    url.hash = "";
    url.host = url.host.toLowerCase();
    return url.href;
  } catch {
    return rawUrl;
  }
}

export function hashUrl(rawUrl: string): string {
  const input = normalizeUrl(rawUrl);
  let hash = 0x811c9dc5; // FNV offset basis
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    // 32-bit FNV prime multiply via shifts to stay in int range
    hash = Math.imul(hash, 0x01000193);
  }
  // Unsigned hex string
  return (hash >>> 0).toString(16).padStart(8, "0");
}
