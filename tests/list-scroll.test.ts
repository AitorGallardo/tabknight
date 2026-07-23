import { describe, expect, test } from "bun:test";
import { visibleItemScrollTop } from "../src/popup/lib/list-scroll";

describe("keyboard list scrolling", () => {
  test("scrolls all the way to zero when the selected row reaches the top", () => {
    expect(
      visibleItemScrollTop({
        scrollTop: 138,
        scrollHeight: 900,
        clientHeight: 300,
        listTop: 140,
        listBottom: 440,
        itemTop: 8,
        itemBottom: 44,
        insetTop: 8,
        insetBottom: 8,
      })
    ).toBe(0);
  });

  test("moves only enough to reveal a row at either edge", () => {
    const base = {
      scrollTop: 200,
      scrollHeight: 900,
      clientHeight: 300,
      listTop: 140,
      listBottom: 440,
      insetTop: 8,
      insetBottom: 8,
    };

    expect(visibleItemScrollTop({ ...base, itemTop: 130, itemBottom: 166 })).toBe(182);
    expect(visibleItemScrollTop({ ...base, itemTop: 420, itemBottom: 456 })).toBe(224);
  });

  test("does not move when the selected row is already visible", () => {
    expect(
      visibleItemScrollTop({
        scrollTop: 200,
        scrollHeight: 900,
        clientHeight: 300,
        listTop: 140,
        listBottom: 440,
        itemTop: 220,
        itemBottom: 256,
        insetTop: 8,
        insetBottom: 8,
      })
    ).toBe(200);
  });
});
