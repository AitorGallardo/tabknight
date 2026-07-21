import { describe, expect, test } from "bun:test";
import {
  appendDiagnostic,
  fallbackExplanation,
  initialFallbackCause,
  isCurrentFallbackRequest,
  isInjectablePage,
  sanitizeTabStatus,
} from "../src/shared/invocation";

describe("invocation lifecycle policy", () => {
  test("only ordinary HTTP(S) documents are injectable", () => {
    expect(isInjectablePage("https://example.com/path")).toBe(true);
    expect(isInjectablePage("http://localhost:3000")).toBe(true);
    expect(isInjectablePage("chrome://settings")).toBe(false);
    expect(isInjectablePage("chrome-extension://abc/page.html")).toBe(false);
    expect(isInjectablePage(undefined)).toBe(false);
  });

  test("discarded and restricted tabs choose deterministic fallback causes", () => {
    expect(initialFallbackCause({ url: "https://example.com", discarded: true })).toBe(
      "discarded-tab"
    );
    expect(initialFallbackCause({ url: "chrome://settings" })).toBe("restricted-url");
    expect(initialFallbackCause({ pendingUrl: "https://example.com", status: "loading" })).toBeUndefined();
  });

  test("diagnostics retain only bounded, privacy-safe lifecycle fields", () => {
    const diagnostic = {
      at: 10,
      elapsedMs: 25,
      mode: "fallback" as const,
      cause: "restricted-url" as const,
      tabStatus: sanitizeTabStatus("loading"),
      discarded: false,
    };
    const result = appendDiagnostic([{ url: "https://secret.invalid", content: "private" }], diagnostic, 1);
    expect(result).toEqual([diagnostic]);
    expect(JSON.stringify(result)).not.toContain("secret");
  });

  test("diagnostic history is bounded", () => {
    let history: unknown = [];
    for (let at = 0; at < 30; at += 1) {
      history = appendDiagnostic(history, {
        at,
        elapsedMs: at,
        mode: "overlay",
        tabStatus: "complete",
        discarded: false,
      });
    }
    expect(history).toHaveLength(24);
    expect((history as Array<{ at: number }>)[0].at).toBe(6);
  });

  test("stale invocation, document, and duplicate fallback requests are rejected", () => {
    const current = { id: "current", documentToken: "doc-b", fallbackOpened: false };
    expect(
      isCurrentFallbackRequest(current, { invocationId: "current", documentToken: "doc-b" })
    ).toBe(true);
    expect(isCurrentFallbackRequest(current, { invocationId: "old", documentToken: "doc-b" })).toBe(
      false
    );
    expect(
      isCurrentFallbackRequest(current, { invocationId: "current", documentToken: "doc-a" })
    ).toBe(false);
    expect(
      isCurrentFallbackRequest(
        { ...current, fallbackOpened: true },
        { invocationId: "current", documentToken: "doc-b" }
      )
    ).toBe(false);
  });

  test("fallback copy explains restricted, loading, and discarded causes", () => {
    expect(fallbackExplanation("restricted-url")).toContain("protects this page");
    expect(fallbackExplanation("loading-tab")).toContain("still loading");
    expect(fallbackExplanation("discarded-tab")).toContain("sleeping");
  });
});
