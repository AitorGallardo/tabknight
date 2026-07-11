import { useCallback, useEffect, useRef } from "react";
import type { Dispatch, RefObject, SetStateAction } from "react";

export interface ScrollInsets {
  top: number;
  bottom: number;
}

const DEFAULT_SCROLL_INSETS: ScrollInsets = { top: 8, bottom: 8 };

export interface UseListNavigationOptions {
  itemCount: number;
  query: string;
  setQuery: Dispatch<SetStateAction<string>>;
  activeIndex: number;
  setActiveIndex: Dispatch<SetStateAction<number>>;
  focusInputAtEnd: () => void;
  onActivate: (index: number) => void;
  onEscape: () => void;
  /** Runs first, before the built-in handling. Return true to consume the event. */
  preKeyDown?: (event: KeyboardEvent) => boolean;
  scrollInsets?: ScrollInsets;
}

export interface UseListNavigationResult {
  listRef: RefObject<HTMLDivElement>;
  registerItem: (index: number) => (el: HTMLElement | null) => void;
}

/**
 * Shared keyboard/scroll machinery for the tab-list overlays (arrow move,
 * Enter activate, Escape, Backspace + printable-char search-as-you-type,
 * clamp-on-shrink, selection scroll-into-view). Query/activeIndex/input focus
 * stay owned by the caller since some callers' preKeyDown/onEscape close over
 * them before this hook can hand anything back.
 */
export function useListNavigation({
  itemCount,
  query,
  setQuery,
  activeIndex,
  setActiveIndex,
  focusInputAtEnd,
  onActivate,
  onEscape,
  preKeyDown,
  scrollInsets = DEFAULT_SCROLL_INSETS,
}: UseListNavigationOptions): UseListNavigationResult {
  const listRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Array<HTMLElement | null>>([]);

  const registerItem = useCallback(
    (index: number) => (el: HTMLElement | null) => {
      itemRefs.current[index] = el;
    },
    []
  );

  useEffect(() => {
    setActiveIndex(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  useEffect(() => {
    if (activeIndex > itemCount - 1) {
      setActiveIndex(Math.max(0, itemCount - 1));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemCount, activeIndex]);

  useEffect(() => {
    const list = listRef.current;
    const item = itemRefs.current[activeIndex];
    if (!list || !item) return;
    const itemTop = item.offsetTop;
    const itemBottom = itemTop + item.offsetHeight;
    if (itemTop < list.scrollTop + scrollInsets.top) {
      list.scrollTop = Math.max(0, itemTop - scrollInsets.top);
    } else if (itemBottom > list.scrollTop + list.clientHeight - scrollInsets.bottom) {
      list.scrollTop = Math.min(
        list.scrollHeight - list.clientHeight,
        itemBottom - list.clientHeight + scrollInsets.bottom
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeIndex, itemCount]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (preKeyDown?.(event)) return;

      const target = event.target as HTMLElement | null;
      const targetIsInput =
        target?.tagName === "INPUT" || target?.tagName === "TEXTAREA" || target?.isContentEditable;

      if (event.key === "ArrowDown") {
        event.preventDefault();
        setActiveIndex((prev) => Math.min(prev + 1, Math.max(0, itemCount - 1)));
        focusInputAtEnd();
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        setActiveIndex((prev) => Math.max(prev - 1, 0));
        focusInputAtEnd();
      } else if (event.key === "Enter") {
        event.preventDefault();
        onActivate(activeIndex);
      } else if (event.key === "Escape") {
        event.preventDefault();
        onEscape();
      } else if (!targetIsInput && event.key === "Backspace") {
        event.preventDefault();
        setQuery((prev) => prev.slice(0, -1));
        focusInputAtEnd();
      } else if (!targetIsInput && event.key.length === 1 && !event.repeat) {
        event.preventDefault();
        setQuery((prev) => prev + event.key);
        focusInputAtEnd();
      }
    };

    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [activeIndex, itemCount, onActivate, onEscape, preKeyDown, setQuery, setActiveIndex, focusInputAtEnd]);

  return { listRef, registerItem };
}
