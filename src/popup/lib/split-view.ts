export const SPLIT_VIEW_ID_NONE = -1;

export type SplitAwareTab = chrome.tabs.Tab & { splitViewId?: number };

export interface SplitViewApi {
  get: (tabId: number) => Promise<chrome.tabs.Tab>;
  query: (queryInfo: chrome.tabs.QueryInfo) => Promise<chrome.tabs.Tab[]>;
  move: (tabId: number, moveProperties: chrome.tabs.MoveProperties) => Promise<chrome.tabs.Tab | chrome.tabs.Tab[]>;
  create: (createProperties: chrome.tabs.CreateProperties) => Promise<chrome.tabs.Tab>;
  update: (tabId: number, updateProperties: chrome.tabs.UpdateProperties) => Promise<chrome.tabs.Tab>;
  remove: (tabId: number) => Promise<void>;
}

export interface SeparateSplitResult {
  splitViewId: number;
  separatedTabIds: number[];
}

/** Chrome uses -1 for a regular tab and a non-negative ID for native pairs. */
export function splitViewIdOf(tab: chrome.tabs.Tab): number | null {
  const splitViewId = (tab as SplitAwareTab).splitViewId;
  return typeof splitViewId === "number" && splitViewId !== SPLIT_VIEW_ID_NONE ? splitViewId : null;
}

/** Map each split member to the title of the tab paired with it. */
export function splitPartnerTitles(tabs: chrome.tabs.Tab[]): Map<number, string> {
  const bySplit = new Map<number, chrome.tabs.Tab[]>();
  for (const tab of tabs) {
    const splitViewId = splitViewIdOf(tab);
    if (splitViewId === null || tab.id === undefined) continue;
    const members = bySplit.get(splitViewId) ?? [];
    members.push(tab);
    bySplit.set(splitViewId, members);
  }

  const result = new Map<number, string>();
  for (const members of bySplit.values()) {
    for (const member of members) {
      if (member.id === undefined) continue;
      const partner = members.find((candidate) => candidate.id !== member.id);
      if (partner) result.set(member.id, partner.title || partner.url || "another tab");
    }
  }
  return result;
}

/**
 * Separate a native Chrome Split View without closing either page.
 *
 * Chromium removes a split when one member is moved outside its pair. We make
 * that move, then immediately put the tab back at its original tab-strip
 * index. If the window contains only the pair (or only opposite pin-state
 * tabs), a short-lived blank tab supplies a safe outside position.
 */
export async function separateNativeSplit(
  tabId: number,
  api: SplitViewApi = chrome.tabs
): Promise<SeparateSplitResult> {
  const selected = await api.get(tabId);
  const splitViewId = splitViewIdOf(selected);
  if (splitViewId === null || selected.windowId === undefined || selected.id === undefined) {
    throw new Error("The selected tab is not in Chrome Split View");
  }

  const initialTabs = await api.query({ windowId: selected.windowId });
  const pair = initialTabs.filter((tab) => splitViewIdOf(tab) === splitViewId && tab.id !== undefined);
  if (pair.length < 2) throw new Error("Chrome's Split View pair is no longer available");

  const originalIndex = selected.index;
  let temporaryTabId: number | null = null;
  let movedAway = false;

  try {
    let tabs = initialTabs;
    let outside = tabs.find(
      (tab) => splitViewIdOf(tab) === null && tab.pinned === selected.pinned && tab.id !== undefined
    );

    if (!outside) {
      const temporary = await api.create({
        windowId: selected.windowId,
        index: tabs.length,
        url: "about:blank",
        active: false,
      });
      if (temporary.id === undefined) throw new Error("Chrome could not prepare the Split View separation");
      temporaryTabId = temporary.id;
      if (selected.pinned) await api.update(temporary.id, { pinned: true });
      tabs = await api.query({ windowId: selected.windowId });
      outside = tabs.find((tab) => tab.id === temporary.id);
    }

    if (!outside) throw new Error("Chrome could not find a safe tab-strip position");

    await api.move(tabId, { windowId: selected.windowId, index: outside.index });
    movedAway = true;

    const separated = await api.get(tabId);
    if (splitViewIdOf(separated) !== null) {
      throw new Error("Chrome kept the selected tabs in Split View");
    }

    await api.move(tabId, { windowId: selected.windowId, index: originalIndex });
    movedAway = false;

    return {
      splitViewId,
      separatedTabIds: pair.map((tab) => tab.id!).sort((a, b) => a - b),
    };
  } finally {
    if (movedAway) {
      await api.move(tabId, { windowId: selected.windowId, index: originalIndex }).catch(() => {});
    }
    if (temporaryTabId !== null) await api.remove(temporaryTabId).catch(() => {});
  }
}
