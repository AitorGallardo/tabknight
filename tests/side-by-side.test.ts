import { describe, expect, test } from "bun:test";
import { getSideBySideBounds } from "../src/popup/lib/side-by-side";

describe("side-by-side bounds", () => {
  test("tiles two equal windows across the available display", () => {
    expect(getSideBySideBounds({ left: 0, top: 25, width: 1440, height: 875 })).toEqual({
      current: { left: 0, top: 25, width: 716, height: 875 },
      selected: { left: 724, top: 25, width: 716, height: 875 },
    });
  });

  test("preserves negative display coordinates and every available pixel", () => {
    const result = getSideBySideBounds({ left: -1920, top: 0, width: 1920, height: 1080 });
    expect(result.current.left).toBe(-1920);
    expect(result.selected.left + result.selected.width).toBe(0);
  });

  test("rejects displays too narrow for usable Chrome windows", () => {
    expect(() => getSideBySideBounds({ left: 0, top: 0, width: 1007, height: 800 })).toThrow();
  });
});
