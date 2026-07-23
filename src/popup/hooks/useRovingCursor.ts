import { useCallback, useEffect, useRef, useState } from "react";
import type { Dispatch, RefObject, SetStateAction } from "react";
import type { ScrollInsets } from "./useListNavigation";
import { visibleItemScrollTop } from "../lib/list-scroll";

const DEFAULT_SCROLL_INSETS: ScrollInsets = { top: 8, bottom: 8 };

/** Elements whose native Space/click behavior must not be hijacked by the
 *  roving cursor's Space-to-toggle handler. */
const SPACE_EXEMPT_SELECTOR = "button, a, select, input, textarea, [contenteditable], [role='button']";

export interface RovingCursorItem {
  id: string | number;
}

export interface UseRovingCursorOptions {
  /** The flattened, visible-only item list. Identity (`id`) — not just
   *  length — is tracked so the cursor stays on the same item across
   *  re-shuffles (e.g. collapsing a domain group) instead of drifting to
   *  whatever now sits at the old numeric index. */
  items: readonly RovingCursorItem[];
  onToggle: (index: number) => void;
  /** Cursor resets to 0 whenever this value changes (e.g. search query). */
  resetKey?: unknown;
  scrollInsets?: ScrollInsets;
}

export interface UseRovingCursorResult {
  cursorIndex: number;
  setCursorIndex: Dispatch<SetStateAction<number>>;
  listRef: RefObject<HTMLDivElement>;
  registerItem: (index: number) => (el: HTMLElement | null) => void;
}

/**
 * Roving ArrowUp/ArrowDown cursor + Space-to-toggle over a flat, visible-only
 * item list. Sibling to useListNavigation (which owns search-as-you-type and
 * Enter/Escape for the overlay) — this one only ever handles Arrow/Space, so
 * it can live alongside useKeyboardShortcuts without either stepping on the
 * other's keys.
 */
export function useRovingCursor({
  items,
  onToggle,
  resetKey,
  scrollInsets = DEFAULT_SCROLL_INSETS,
}: UseRovingCursorOptions): UseRovingCursorResult {
  const itemCount = items.length;
  const itemKeys = items.map((item) => item.id);

  const [cursorIndex, setCursorIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Array<HTMLElement | null>>([]);

  const registerItem = useCallback(
    (index: number) => (el: HTMLElement | null) => {
      itemRefs.current[index] = el;
    },
    []
  );

  // Re-anchor the cursor by identity (not raw index) whenever the visible
  // item list changes shape — e.g. collapsing a domain group shifts every
  // index after it, so a stale index would land the cursor on an unrelated
  // tab. `cursorKeyRef` tracks which item the cursor currently points at;
  // runs after every render (no dep array) so it also keeps that ref synced
  // when Arrow keys move the cursor within an unchanged list.
  const prevKeysRef = useRef<Array<string | number>>(itemKeys);
  const prevResetKeyRef = useRef(resetKey);
  const cursorKeyRef = useRef<string | number | null>(itemKeys[0] ?? null);

  useEffect(() => {
    const resetKeyChanged = prevResetKeyRef.current !== resetKey;
    const keysChanged =
      prevKeysRef.current.length !== itemKeys.length ||
      prevKeysRef.current.some((key, i) => key !== itemKeys[i]);

    prevResetKeyRef.current = resetKey;
    prevKeysRef.current = itemKeys;

    let nextIndex = cursorIndex;
    if (resetKeyChanged) {
      nextIndex = 0;
    } else if (keysChanged) {
      const key = cursorKeyRef.current;
      const foundIndex = key === null ? -1 : itemKeys.indexOf(key);
      nextIndex = foundIndex >= 0 ? foundIndex : Math.max(0, Math.min(cursorIndex, itemCount - 1));
    }

    cursorKeyRef.current = itemKeys[nextIndex] ?? null;
    if (nextIndex !== cursorIndex) setCursorIndex(nextIndex);
  });

  useEffect(() => {
    const list = listRef.current;
    const item = itemRefs.current[cursorIndex];
    if (!list || !item) return;
    const listRect = list.getBoundingClientRect();
    const itemRect = item.getBoundingClientRect();
    list.scrollTop = visibleItemScrollTop({
      scrollTop: list.scrollTop,
      scrollHeight: list.scrollHeight,
      clientHeight: list.clientHeight,
      listTop: listRect.top,
      listBottom: listRect.bottom,
      itemTop: itemRect.top,
      itemBottom: itemRect.bottom,
      insetTop: scrollInsets.top,
      insetBottom: scrollInsets.bottom,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cursorIndex, itemCount]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (itemCount === 0) return;

      if (event.key === "ArrowDown") {
        event.preventDefault();
        setCursorIndex((prev) => Math.min(prev + 1, itemCount - 1));
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        setCursorIndex((prev) => Math.max(prev - 1, 0));
      } else if (event.key === " ") {
        const target = event.target as HTMLElement | null;
        if (target?.closest?.(SPACE_EXEMPT_SELECTOR)) return;
        event.preventDefault();
        onToggle(cursorIndex);
      }
    };

    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [cursorIndex, itemCount, onToggle]);

  return { cursorIndex, setCursorIndex, listRef, registerItem };
}
