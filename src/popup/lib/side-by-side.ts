export interface WorkArea {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface WindowBounds {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface SideBySideBounds {
  current: WindowBounds;
  selected: WindowBounds;
}

const WINDOW_GAP_PX = 8;
// Chrome enforces a roughly 500px platform window minimum even when the
// requested bounds are smaller. Reject earlier so the two halves never
// silently overlap on compact displays.
const MIN_WINDOW_WIDTH_PX = 500;

/** Split one display's usable area into two dense, equal Chrome windows. */
export function getSideBySideBounds(workArea: WorkArea): SideBySideBounds {
  const left = Math.round(workArea.left);
  const top = Math.round(workArea.top);
  const width = Math.round(workArea.width);
  const height = Math.round(workArea.height);
  if (width < MIN_WINDOW_WIDTH_PX * 2 + WINDOW_GAP_PX || height <= 0) {
    throw new Error("This display is too narrow for two Chrome windows");
  }

  const currentWidth = Math.floor((width - WINDOW_GAP_PX) / 2);
  const selectedWidth = width - WINDOW_GAP_PX - currentWidth;
  return {
    current: { left, top, width: currentWidth, height },
    selected: {
      left: left + currentWidth + WINDOW_GAP_PX,
      top,
      width: selectedWidth,
      height,
    },
  };
}

/**
 * Keep the invocation tab on the left and adopt the highlighted tab into a
 * newly-created Chrome window on the right. This is deliberately a tiled
 * two-window layout, not Chrome's native Split View.
 */
export async function openTabSideBySide(
  originTabId: number,
  selectedTabId: number,
  workArea: WorkArea
): Promise<void> {
  if (originTabId === selectedTabId) {
    throw new Error("Choose a different tab to place beside the current tab");
  }

  const [originTab, selectedTab] = await Promise.all([
    chrome.tabs.get(originTabId),
    chrome.tabs.get(selectedTabId),
  ]);
  if (originTab.windowId === undefined || selectedTab.id === undefined) {
    throw new Error("One of the selected tabs is no longer available");
  }

  const bounds = getSideBySideBounds(workArea);
  const originWindow = await chrome.windows.get(originTab.windowId);
  const originalBounds =
    originWindow.left !== undefined &&
    originWindow.top !== undefined &&
    originWindow.width !== undefined &&
    originWindow.height !== undefined
      ? {
          left: originWindow.left,
          top: originWindow.top,
          width: originWindow.width,
          height: originWindow.height,
        }
      : null;

  let selectedWindow: chrome.windows.Window | undefined;
  try {
    if (originWindow.state !== "normal") {
      await chrome.windows.update(originTab.windowId, { state: "normal" });
    }
    await chrome.windows.update(originTab.windowId, bounds.current);
    selectedWindow = await chrome.windows.create({
      tabId: selectedTab.id,
      type: "normal",
      focused: false,
      ...bounds.selected,
    });
    if (selectedWindow.id === undefined) {
      throw new Error("Chrome couldn't create the second window");
    }
    // macOS may accept the creation bounds but initially place an adopted tab
    // at Chrome's default window size. A post-creation update is authoritative.
    if (selectedWindow.state !== "normal") {
      await chrome.windows.update(selectedWindow.id, { state: "normal" });
    }
    await chrome.windows.update(selectedWindow.id, bounds.selected);
  } catch (error) {
    // If Chrome rejects the adoption (for example across profile modes), do
    // not leave the user's current window stranded at half width.
    if (selectedWindow?.id !== undefined) {
      await chrome.tabs
        .move(selectedTab.id, { windowId: originTab.windowId, index: -1 })
        .catch(() => {});
    }
    if (originalBounds) {
      await chrome.windows.update(originTab.windowId, originalBounds).catch(() => {});
    }
    if (originWindow.state && originWindow.state !== "normal") {
      await chrome.windows.update(originTab.windowId, { state: originWindow.state }).catch(() => {});
    }
    throw error;
  }

  await chrome.tabs.update(originTabId, { active: true });
  await chrome.windows.update(selectedWindow.id!, { focused: true });
}
