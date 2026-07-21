/**
 * IndexedDB store for tab previews.
 *
 * Why IndexedDB and not chrome.storage.local?
 *  - storage.local is ~10MB and JSON-serialized; image blobs (Phase 2) would
 *    blow the quota fast. IndexedDB stores Blobs natively and has a far larger
 *    quota (especially with the "unlimitedStorage" permission).
 *
 * Who can touch this?
 *  - Extension pages (background service worker, the popup/standalone page)
 *    share the extension origin and therefore share this database.
 *  - Content scripts run in the *page's* origin, so they CANNOT write here.
 *    They message the background, which calls putCard() on their behalf.
 *
 * Two object stores, both keyed by urlHash:
 *  - "cards"      -> ContentCard   (Phase 1, text-first snapshot)
 *  - "thumbnails" -> TabThumbnail  (Phase 2, pixel snapshot — reserved now)
 */
import type { ContentCard, TabThumbnail } from "./types";

const DB_NAME = "tabknight-preview";
const DB_VERSION = 1;
const CARDS_STORE = "cards";
const THUMBS_STORE = "thumbnails";

/** Default LRU cap on stored cards. Oldest (by capturedAt) are evicted first. */
export const DEFAULT_MAX_CARDS = 300;

/** Thumbnails are heavier (image blobs), so we keep fewer of them. */
export const DEFAULT_MAX_THUMBS = 150;

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(CARDS_STORE)) {
        const cards = db.createObjectStore(CARDS_STORE, { keyPath: "urlHash" });
        cards.createIndex("capturedAt", "capturedAt");
      }
      if (!db.objectStoreNames.contains(THUMBS_STORE)) {
        const thumbs = db.createObjectStore(THUMBS_STORE, { keyPath: "urlHash" });
        thumbs.createIndex("capturedAt", "capturedAt");
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

  return dbPromise;
}

function tx<T>(
  storeName: string,
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const transaction = db.transaction(storeName, mode);
        const request = run(transaction.objectStore(storeName));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      })
  );
}

/* ---------------------------------- cards --------------------------------- */

export async function putCard(card: ContentCard): Promise<void> {
  await tx(CARDS_STORE, "readwrite", (store) => store.put(card));
}

export async function getCard(urlHash: string): Promise<ContentCard | undefined> {
  return tx<ContentCard | undefined>(CARDS_STORE, "readonly", (store) => store.get(urlHash));
}

export async function getAllCards(): Promise<ContentCard[]> {
  return tx<ContentCard[]>(CARDS_STORE, "readonly", (store) => store.getAll());
}

/** Read many cards at once, returned as a urlHash -> card map. */
export async function getCardMap(urlHashes: string[]): Promise<Map<string, ContentCard>> {
  const cards = await getAllCards();
  const wanted = new Set(urlHashes);
  const map = new Map<string, ContentCard>();
  for (const card of cards) {
    if (wanted.has(card.urlHash)) map.set(card.urlHash, card);
  }
  return map;
}

export async function deleteCard(urlHash: string): Promise<void> {
  await tx(CARDS_STORE, "readwrite", (store) => store.delete(urlHash));
}

/**
 * Evict oldest entries of a store beyond `maxEntries` (LRU by capturedAt).
 * Cheap to call after every write — it no-ops until the cap is exceeded.
 */
async function pruneStore(storeName: string, maxEntries: number): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(storeName, "readwrite");
    const store = transaction.objectStore(storeName);
    const countRequest = store.count();

    countRequest.onsuccess = () => {
      const overflow = countRequest.result - maxEntries;
      if (overflow <= 0) {
        resolve();
        return;
      }

      // Walk the capturedAt index oldest-first, deleting until we're under cap.
      let remaining = overflow;
      const cursorRequest = store.index("capturedAt").openCursor();
      cursorRequest.onsuccess = () => {
        const cursor = cursorRequest.result;
        if (!cursor || remaining <= 0) {
          resolve();
          return;
        }
        cursor.delete();
        remaining -= 1;
        cursor.continue();
      };
      cursorRequest.onerror = () => reject(cursorRequest.error);
    };

    countRequest.onerror = () => reject(countRequest.error);
  });
}

export function pruneCards(maxEntries: number = DEFAULT_MAX_CARDS): Promise<void> {
  return pruneStore(CARDS_STORE, maxEntries);
}

export async function clearAllCards(): Promise<void> {
  await tx(CARDS_STORE, "readwrite", (store) => store.clear());
}

/** Remove previously harvested prose while retaining non-text preview metadata. */
export async function redactAllCardText(): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(CARDS_STORE, "readwrite");
    const store = transaction.objectStore(CARDS_STORE);
    const cursorRequest = store.openCursor();
    cursorRequest.onsuccess = () => {
      const cursor = cursorRequest.result;
      if (!cursor) return;
      const card = cursor.value as ContentCard;
      if (card.description !== undefined || card.excerpt !== undefined) {
        const { description: _description, excerpt: _excerpt, ...redacted } = card;
        cursor.update(redacted);
      }
      cursor.continue();
    };
    cursorRequest.onerror = () => reject(cursorRequest.error);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
}

export function countCards(): Promise<number> {
  return tx<number>(CARDS_STORE, "readonly", (store) => store.count());
}

/* ------------------------ thumbnails (Phase 2 stubs) ----------------------- */

export async function putThumbnail(thumb: TabThumbnail): Promise<void> {
  await tx(THUMBS_STORE, "readwrite", (store) => store.put(thumb));
}

export async function getThumbnail(urlHash: string): Promise<TabThumbnail | undefined> {
  return tx<TabThumbnail | undefined>(THUMBS_STORE, "readonly", (store) => store.get(urlHash));
}

export function pruneThumbnails(maxEntries: number = DEFAULT_MAX_THUMBS): Promise<void> {
  return pruneStore(THUMBS_STORE, maxEntries);
}

export async function clearAllThumbnails(): Promise<void> {
  await tx(THUMBS_STORE, "readwrite", (store) => store.clear());
}

export function countThumbnails(): Promise<number> {
  return tx<number>(THUMBS_STORE, "readonly", (store) => store.count());
}
