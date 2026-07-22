import { describe, expect, test } from "bun:test";
import {
  groupCompleteSplitPairs,
  separateNativeSplit,
  isNavigatorTabCandidate,
  splitPartnerTitles,
  splitViewIdOf,
  type SplitAwareTab,
  type SplitViewApi,
} from "../src/popup/lib/split-view";

function tab(id: number, index: number, options: Partial<SplitAwareTab> = {}): SplitAwareTab {
  return {
    id,
    index,
    windowId: 1,
    title: `Tab ${id}`,
    url: `https://example.com/${id}`,
    active: id === 1,
    highlighted: id === 1,
    pinned: false,
    incognito: false,
    selected: id === 1,
    discarded: false,
    autoDiscardable: true,
    groupId: -1,
    ...options,
  };
}

function fakeApi(initial: SplitAwareTab[]) {
  let tabs = initial.map((item) => ({ ...item }));
  const calls: string[] = [];
  const reindex = () => tabs.forEach((item, index) => (item.index = index));

  const api: SplitViewApi = {
    get: async (tabId) => ({ ...tabs.find((item) => item.id === tabId)! }),
    query: async () => tabs.map((item) => ({ ...item })),
    move: async (tabId, properties) => {
      const moving = tabs.find((item) => item.id === tabId)!;
      const destination = tabs[properties.index];
      calls.push(`move:${tabId}:${properties.index}`);
      if (splitViewIdOf(moving) !== null && splitViewIdOf(destination) !== splitViewIdOf(moving)) {
        const splitViewId = splitViewIdOf(moving);
        tabs = tabs.map((item) =>
          splitViewIdOf(item) === splitViewId ? { ...item, splitViewId: -1 } : item
        );
      }
      const currentIndex = tabs.findIndex((item) => item.id === tabId);
      const [removed] = tabs.splice(currentIndex, 1);
      tabs.splice(Math.min(properties.index, tabs.length), 0, removed);
      reindex();
      return { ...removed };
    },
    create: async (properties) => {
      const created = tab(99, tabs.length, { title: "Temporary", url: properties.url as string });
      tabs.push(created);
      reindex();
      calls.push("create:99");
      return { ...created };
    },
    update: async (tabId, properties) => {
      const existing = tabs.find((item) => item.id === tabId)!;
      Object.assign(existing, properties);
      calls.push(`update:${tabId}:${properties.pinned}`);
      return { ...existing };
    },
    remove: async (tabId) => {
      tabs = tabs.filter((item) => item.id !== tabId);
      reindex();
      calls.push(`remove:${tabId}`);
    },
  };

  return { api, calls, current: () => tabs.map((item) => ({ ...item })) };
}

describe("native Split View metadata", () => {
  test("places both members of every complete split together without changing pair order", () => {
    const tabs = [
      tab(1, 0),
      tab(2, 1, { splitViewId: 8 }),
      tab(3, 2),
      tab(4, 3, { splitViewId: 8 }),
      tab(5, 4, { splitViewId: 9 }),
    ];

    expect(groupCompleteSplitPairs(tabs).map((item) => item.id)).toEqual([1, 2, 4, 3, 5]);
  });

  test("maps both members to the other tab's title", () => {
    const tabs = [tab(1, 0, { splitViewId: 8 }), tab(2, 1, { splitViewId: 8 }), tab(3, 2)];
    expect([...splitPartnerTitles(tabs).entries()]).toEqual([
      [1, "Tab 2"],
      [2, "Tab 1"],
    ]);
  });

  test("hides a regular origin but keeps both members of the current split", () => {
    const regularOrigin = tab(1, 0);
    const splitOrigin = tab(1, 0, { splitViewId: 8 });
    const splitPartner = tab(2, 1, { splitViewId: 8 });

    expect(isNavigatorTabCandidate(regularOrigin, "chrome-extension://self/", 1, null)).toBe(false);
    expect(isNavigatorTabCandidate(splitOrigin, "chrome-extension://self/", 1, 8)).toBe(true);
    expect(isNavigatorTabCandidate(splitPartner, "chrome-extension://self/", 1, 8)).toBe(true);
  });
});

describe("separateNativeSplit", () => {
  test("keeps both pages and restores their tab-strip order", async () => {
    const model = fakeApi([
      tab(1, 0, { splitViewId: 8 }),
      tab(2, 1, { splitViewId: 8 }),
      tab(3, 2),
    ]);

    const result = await separateNativeSplit(2, model.api);

    expect(result).toEqual({ splitViewId: 8, separatedTabIds: [1, 2] });
    expect(model.current().map((item) => item.id)).toEqual([1, 2, 3]);
    expect(model.current().map(splitViewIdOf)).toEqual([null, null, null]);
    expect(model.calls).toEqual(["move:2:2", "move:2:1"]);
  });

  test("uses and removes a same-pin-state helper tab when the pair is alone", async () => {
    const model = fakeApi([
      tab(1, 0, { splitViewId: 9, pinned: true }),
      tab(2, 1, { splitViewId: 9, pinned: true }),
    ]);

    await separateNativeSplit(1, model.api);

    expect(model.current().map((item) => item.id)).toEqual([1, 2]);
    expect(model.current().map(splitViewIdOf)).toEqual([null, null]);
    expect(model.calls).toEqual([
      "create:99",
      "update:99:true",
      "move:1:2",
      "move:1:0",
      "remove:99",
    ]);
  });

  test("does not disturb a different native split when choosing an outside position", async () => {
    const model = fakeApi([
      tab(1, 0, { splitViewId: 9 }),
      tab(2, 1, { splitViewId: 9 }),
      tab(3, 2, { splitViewId: 10 }),
      tab(4, 3, { splitViewId: 10 }),
    ]);

    await separateNativeSplit(1, model.api);

    expect(model.current().filter((item) => splitViewIdOf(item) === 10).map((item) => item.id)).toEqual([3, 4]);
    expect(model.calls[0]).toBe("create:99");
  });
});
