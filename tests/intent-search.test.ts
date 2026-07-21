import { describe, expect, test } from "bun:test";
import { directUrlForQuery, rankIntentResults, webSearchUrl } from "../src/popup/lib/intent-search";

const gmailTab = {
  id: 7,
  windowId: 1,
  title: "Gmail - Inbox",
  url: "https://mail.google.com/mail/u/0/",
  pinned: true,
  active: false,
  index: 2,
  lastAccessed: 100,
};

describe("rankIntentResults", () => {
  test("keeps empty queries on the caller's tab-only fast path", () => {
    expect(rankIntentResults({ query: "", tabs: [gmailTab] })).toEqual([]);
  });

  test("returns distinct typed sources in stable priority order", () => {
    const input = {
      query: "gmail",
      tabs: [gmailTab],
      bookmarks: [{ id: "b1", title: "Gmail", url: "https://mail.google.com/" }],
      history: [{ id: "h1", title: "Gmail login", url: "https://accounts.google.com/", visitCount: 4 }],
      currentWindowId: 1,
    };
    const first = rankIntentResults(input);
    const second = rankIntentResults(input);
    expect(first.map((item) => item.type)).toEqual(["tab", "bookmark", "history", "direct", "search"]);
    expect(second.map((item) => item.key)).toEqual(first.map((item) => item.key));
  });

  test("breaks equal-score ties by stable identity", () => {
    const results = rankIntentResults({
      query: "docs",
      tabs: [],
      bookmarks: [
        { id: "z", title: "Docs", url: "https://z.example/docs" },
        { id: "a", title: "Docs", url: "https://a.example/docs" },
      ],
    });
    expect(results.filter((item) => item.type === "bookmark").map((item) => item.key)).toEqual([
      "bookmark:a",
      "bookmark:z",
    ]);
  });

  test("deduplicates destination URLs without hiding the open tab", () => {
    const results = rankIntentResults({
      query: "gmail",
      tabs: [gmailTab],
      bookmarks: [{ id: "b", title: "Gmail", url: "https://mail.google.com/#inbox" }],
      history: [{ id: "h", title: "Gmail", url: "https://mail.google.com/" }],
    });
    expect(results.filter((item) => item.type === "tab")).toHaveLength(1);
    expect(results.filter((item) => item.type === "bookmark")).toHaveLength(1);
    expect(results.filter((item) => item.type === "history")).toHaveLength(0);
  });
});

describe("query destinations", () => {
  test("normalizes hosts and simple site names", () => {
    expect(directUrlForQuery("example.com")).toBe("https://example.com/");
    expect(directUrlForQuery("gmail")).toBeNull();
    expect(directUrlForQuery("localhost:3000/path")).toBe("https://localhost:3000/path");
    expect(directUrlForQuery("two words")).toBeNull();
    expect(directUrlForQuery("javascript:alert(1)")).toBeNull();
  });

  test("encodes web searches", () => {
    expect(webSearchUrl("tabs & spaces")).toBe("https://www.google.com/search?q=tabs%20%26%20spaces");
  });
});
