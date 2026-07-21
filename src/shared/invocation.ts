export type InvocationMode = "overlay" | "fallback";

export type FallbackCause =
  | "restricted-url"
  | "discarded-tab"
  | "loading-tab"
  | "no-receiver"
  | "injection-failed"
  | "overlay-timeout"
  | "overlay-error"
  | "unknown";

export interface InvocationDiagnostic {
  at: number;
  elapsedMs: number;
  mode: InvocationMode;
  cause?: FallbackCause;
  tabStatus: "loading" | "complete" | "unknown";
  discarded: boolean;
}

export function isInjectablePage(url?: string): boolean {
  if (!url) return false;
  try {
    const protocol = new URL(url).protocol;
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

export function initialFallbackCause(tab: {
  url?: string;
  pendingUrl?: string;
  status?: string;
  discarded?: boolean;
}): FallbackCause | undefined {
  if (tab.discarded) return "discarded-tab";
  if (!isInjectablePage(tab.pendingUrl ?? tab.url)) return "restricted-url";
  return undefined;
}

export function sanitizeTabStatus(status?: string): InvocationDiagnostic["tabStatus"] {
  return status === "loading" || status === "complete" ? status : "unknown";
}

export function isCurrentFallbackRequest(
  invocation: { id: string; documentToken?: string; fallbackOpened: boolean } | undefined,
  request: { invocationId?: unknown; documentToken?: unknown }
): boolean {
  return (
    !!invocation &&
    invocation.id === request.invocationId &&
    typeof request.documentToken === "string" &&
    (!invocation.documentToken || invocation.documentToken === request.documentToken) &&
    !invocation.fallbackOpened
  );
}

export function fallbackExplanation(cause?: string): string {
  if (cause === "restricted-url") return "Chrome protects this page from extension overlays.";
  if (cause === "discarded-tab") return "This tab was sleeping, so TabKnight opened safely beside it.";
  if (cause === "loading-tab") return "The page was still loading and could not host the overlay yet.";
  return "The page could not host TabKnight’s in-page overlay.";
}

export function appendDiagnostic(
  existing: unknown,
  next: InvocationDiagnostic,
  limit = 24
): InvocationDiagnostic[] {
  const safe = Array.isArray(existing)
    ? existing.filter((item): item is InvocationDiagnostic => {
        if (!item || typeof item !== "object") return false;
        const value = item as Partial<InvocationDiagnostic>;
        return (
          typeof value.at === "number" &&
          typeof value.elapsedMs === "number" &&
          (value.mode === "overlay" || value.mode === "fallback")
        );
      })
    : [];
  return [...safe, next].slice(-limit);
}
