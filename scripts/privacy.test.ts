import { describe, expect, test } from "bun:test";
import {
  PREVIEW_TEXT_REDACTION_VERSION_KEY,
  ensurePreviewTextPrivacy,
  isSensitivePreviewUrl,
  shouldSuppressPreviewText,
} from "../src/popup/lib/preview/privacy";

describe("preview text privacy", () => {
  test("fails closed for non-web and malformed URLs", () => {
    expect(isSensitivePreviewUrl("chrome://settings")).toBe(true);
    expect(isSensitivePreviewUrl("not a url")).toBe(true);
  });

  test("recognizes sensitive host and path tokens without inspecting content", () => {
    expect(isSensitivePreviewUrl("https://mail.example.com/thread/1")).toBe(true);
    expect(isSensitivePreviewUrl("https://example.com/account/profile")).toBe(true);
    expect(isSensitivePreviewUrl("https://example.com/news/accountability")).toBe(false);
    expect(isSensitivePreviewUrl("https://developer.mozilla.org/docs/Web/API")).toBe(false);
  });

  test("applies the explicit preference before URL classification", () => {
    expect(shouldSuppressPreviewText("https://example.com", "always-hide")).toBe(true);
    expect(shouldSuppressPreviewText("https://mail.example.com", "always-show")).toBe(false);
    expect(shouldSuppressPreviewText("https://mail.example.com", "sensitive")).toBe(true);
    expect(shouldSuppressPreviewText("https://example.com", "sensitive")).toBe(false);
  });

  test("redacts legacy prose once when the privacy-safe default is first observed", async () => {
    const stored: Record<string, unknown> = {};
    const originalChrome = globalThis.chrome;
    let redactions = 0;
    globalThis.chrome = {
      storage: {
        local: {
          get: async (key: string) => ({ [key]: stored[key] }),
          set: async (values: Record<string, unknown>) => Object.assign(stored, values),
        },
      },
    } as typeof chrome;

    try {
      await ensurePreviewTextPrivacy(async () => { redactions += 1; });
      await ensurePreviewTextPrivacy(async () => { redactions += 1; });
      expect(redactions).toBe(1);
      expect(stored[PREVIEW_TEXT_REDACTION_VERSION_KEY]).toBe(1);
    } finally {
      globalThis.chrome = originalChrome;
    }
  });
});
