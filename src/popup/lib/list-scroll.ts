export interface VisibleItemScrollGeometry {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
  listTop: number;
  listBottom: number;
  itemTop: number;
  itemBottom: number;
  insetTop: number;
  insetBottom: number;
}

/**
 * Keeps an item inside a scroll container's visible viewport.
 *
 * Bounding-client-rect coordinates are intentional here: list items can sit
 * inside section wrappers, so offsetTop may be relative to the page rather
 * than to the scrolling list.
 */
export function visibleItemScrollTop({
  scrollTop,
  scrollHeight,
  clientHeight,
  listTop,
  listBottom,
  itemTop,
  itemBottom,
  insetTop,
  insetBottom,
}: VisibleItemScrollGeometry): number {
  const visibleTop = listTop + insetTop;
  const visibleBottom = listBottom - insetBottom;
  let nextScrollTop = scrollTop;

  if (itemTop < visibleTop) {
    nextScrollTop += itemTop - visibleTop;
  } else if (itemBottom > visibleBottom) {
    nextScrollTop += itemBottom - visibleBottom;
  }

  return Math.max(0, Math.min(Math.max(0, scrollHeight - clientHeight), nextScrollTop));
}
