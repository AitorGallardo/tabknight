import { describe, expect, test } from "bun:test";
import {
  DEFAULT_ACCENT_PREFERENCE,
  RAYCAST_RED,
  ZINC_BADGE,
  badgeColorForAccent,
  isAccentPreference,
} from "../src/popup/lib/appearance";

describe("appearance preferences", () => {
  test("defaults to the sober zinc family", () => {
    expect(DEFAULT_ACCENT_PREFERENCE).toBe("zinc");
    expect(badgeColorForAccent("zinc")).toBe(ZINC_BADGE);
  });

  test("uses the official Raycast red only when selected", () => {
    expect(isAccentPreference("raycast")).toBe(true);
    expect(isAccentPreference("blue")).toBe(false);
    expect(badgeColorForAccent("raycast")).toBe(RAYCAST_RED);
    expect(RAYCAST_RED).toBe("#FF6363");
  });
});
