import { extractContentCard } from "../popup/lib/preview/harvester";
import type { PreviewCardCaptureMessage } from "../popup/lib/preview/types";

/* -------------------------- content-card harvester ------------------------ */
// Build a lightweight preview snapshot of this page and hand it to the
// background, which persists it to IndexedDB. Best-effort and silent on error.

let harvestTimer: number | undefined;

function harvestCard(): void {
  try {
    const card = extractContentCard();
    if (!card.url || card.url.startsWith("about:")) return;
    const message: PreviewCardCaptureMessage = { type: "PREVIEW_CARD_CAPTURE", card };
    void chrome.runtime.sendMessage(message).catch(() => {
      // Background may be asleep or the context invalidated; ignore.
    });
  } catch {
    // Never let harvesting interfere with the page.
  }
}

function scheduleHarvest(delay = 800): void {
  window.clearTimeout(harvestTimer);
  harvestTimer = window.setTimeout(harvestCard, delay);
}

// Capture once the page has settled, and again whenever the user leaves the
// tab — that frame is the freshest "where I left off" snapshot.
scheduleHarvest(1200);

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") harvestCard();
});

// When the user settles after scrolling, refresh the text card (scroll position)
// and ask the background to re-snapshot the now-current view. The background
// throttles captures, so frequent scrolls won't spam it.
let scrollTimer: number | undefined;
window.addEventListener(
  "scroll",
  () => {
    window.clearTimeout(scrollTimer);
    scrollTimer = window.setTimeout(() => {
      harvestCard();
      void chrome.runtime.sendMessage({ type: "PREVIEW_REQUEST_CAPTURE" }).catch(() => {});
    }, 1500);
  },
  { passive: true }
);

/* ------------------------- preview overlay (Cmd+K) ------------------------ */
// A blended, in-page dialog: the page supplies the blurred backdrop, and a
// floating panel hosts the extension's React preview view inside an <iframe>.
// The iframe runs in the extension origin, so it can read the snapshot DB and
// activate tabs directly. If a strict-CSP page blocks the frame, we time out
// and ask the background to fall back to the standalone tab.

const PREVIEW_HOST_ID = "tabknight-preview-host";
let previewHost: HTMLDivElement | null = null;
let previewFallbackTimer: number | undefined;

function closePreviewOverlay(): void {
  window.clearTimeout(previewFallbackTimer);
  previewHost?.remove();
  previewHost = null;
}

function openPreviewOverlay(): void {
  if (previewHost) {
    closePreviewOverlay();
    return;
  }

  const host = document.createElement("div");
  host.id = PREVIEW_HOST_ID;
  const shadow = host.attachShadow({ mode: "open" });
  document.documentElement.appendChild(host);
  previewHost = host;

  const src = chrome.runtime.getURL("popup/index.html?view=preview&overlay=1");

  shadow.innerHTML = `
    <style>
      :host { all: initial; }
      .tkp-backdrop {
        position: fixed; inset: 0; z-index: 2147483647;
        display: flex; align-items: center; justify-content: center;
        background: rgba(6, 7, 10, 0.34);
        backdrop-filter: blur(7px) saturate(105%);
        -webkit-backdrop-filter: blur(7px) saturate(105%);
      }
      .tkp-panel {
        width: min(1040px, 92vw); height: min(640px, 86vh);
        border-radius: 18px; overflow: hidden;
        box-shadow: 0 30px 80px rgba(0, 0, 0, 0.5);
        background: transparent;
      }
      .tkp-frame { width: 100%; height: 100%; border: 0; background: transparent; }
    </style>
    <div class="tkp-backdrop" data-role="backdrop">
      <div class="tkp-panel">
        <iframe class="tkp-frame" src="${src}" referrerpolicy="no-referrer"></iframe>
      </div>
    </div>
  `;

  const backdrop = shadow.querySelector<HTMLElement>("[data-role='backdrop']");
  backdrop?.addEventListener("mousedown", (event) => {
    if (event.target === backdrop) closePreviewOverlay();
  });

  const frame = shadow.querySelector<HTMLIFrameElement>(".tkp-frame");
  frame?.addEventListener("load", () => frame.contentWindow?.focus());

  // If the iframe never signals "ready" (e.g. CSP blocked it), degrade to a tab.
  previewFallbackTimer = window.setTimeout(() => {
    closePreviewOverlay();
    void chrome.runtime.sendMessage({ type: "PREVIEW_FALLBACK_STANDALONE" }).catch(() => {});
  }, 1800);
}

// Messages from the React app inside the iframe (cross-frame postMessage).
window.addEventListener("message", (event) => {
  const data = event.data as { source?: string; type?: string } | undefined;
  if (data?.source !== "tabknight-preview") return;
  if (data.type === "ready") window.clearTimeout(previewFallbackTimer);
  if (data.type === "close") closePreviewOverlay();
});

// Esc closes even when focus sits on the page backdrop rather than the iframe.
document.addEventListener(
  "keydown",
  (event) => {
    if (previewHost && event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closePreviewOverlay();
    }
  },
  true
);

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "PREVIEW_OVERLAY_TOGGLE") {
    openPreviewOverlay();
    sendResponse({ ok: true });
    return true;
  }

  return false;
});
