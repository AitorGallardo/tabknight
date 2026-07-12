import { extractContentCard } from "../popup/lib/preview/harvester";
import type {
  MediaControlMessage,
  MediaControlResult,
  MediaStatusResult,
  PreviewCardCaptureMessage,
} from "../popup/lib/preview/types";

// Idempotency guard: chrome.scripting.executeScript can run this file more
// than once on the same page (e.g. onStartup's injectContentScriptIntoOpenTabs
// racing the declarative content-script injection). Bun emits flat, var-based
// top-level code, so a second run would silently re-register every listener
// and timer below — duplicate keydown handlers, duplicate overlay hosts,
// Cmd+K flashing open-then-closed. Guard the whole module body behind a flag
// stashed on `window` so only the first injection takes effect.
type TabknightWindow = Window & { __tabknightLoaded?: boolean };

(function main() {
  const win = window as TabknightWindow;
  if (win.__tabknightLoaded) return;
  win.__tabknightLoaded = true;

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

  // Ask the background to screenshot this tab — but only when the page is at the
  // top, so the stored thumbnail always shows the top of the page. The background
  // captures the visible tab and throttles, so this is safe to call freely.
  function requestTopCapture(): void {
    if (window.scrollY > 1) return;
    void chrome.runtime.sendMessage({ type: "PREVIEW_REQUEST_CAPTURE" }).catch(() => {});
  }

  // Initial: harvest the text card, then snapshot once the page has painted.
  scheduleHarvest(1200);
  window.setTimeout(requestTopCapture, 1500);

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      harvestCard();
    } else {
      // Returned to this tab — refresh the top-of-page snapshot.
      window.setTimeout(requestTopCapture, 400);
    }
  });

  // When the user settles after scrolling, refresh the text card; only re-snapshot
  // if they've returned to the top.
  let scrollTimer: number | undefined;
  window.addEventListener(
    "scroll",
    () => {
      window.clearTimeout(scrollTimer);
      scrollTimer = window.setTimeout(() => {
        harvestCard();
        requestTopCapture();
      }, 1200);
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
  const PREVIEW_MOTION_MS = 140;
  const PREVIEW_SKELETON_FADE_MS = 150;
  const PREVIEW_MOTION_BACKSTOP_MS = 200;
  const PREVIEW_FALLBACK_BACKSTOP_MS = 4000;

  let previewHost: HTMLDivElement | null = null;
  let previewFallbackTimer: number | undefined;
  let previewReady = false;
  let previewClosing = false;
  // Set as soon as the user (or a "close" postMessage) dismisses the overlay,
  // so a frame.onerror firing during the close animation can't mistake the
  // dismissal for a load failure and pop an unwanted standalone tab.
  let previewDismissed = false;

  function prefersReducedMotion(): boolean {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  function closePreviewOverlay(): void {
    previewDismissed = true;
    if (!previewHost || previewClosing) return;
    const host = previewHost;
    const backdrop = host.shadowRoot?.querySelector<HTMLElement>("[data-role='backdrop']");
    window.clearTimeout(previewFallbackTimer);

    const finish = () => {
      host.remove();
      if (previewHost === host) previewHost = null;
      previewClosing = false;
    };

    if (!backdrop || prefersReducedMotion()) {
      finish();
      return;
    }

    previewClosing = true;
    backdrop.classList.remove("tkp-visible");

    let settled = false;
    const settle = () => {
      if (settled) return;
      settled = true;
      backdrop.removeEventListener("transitionend", onTransitionEnd);
      finish();
    };
    const onTransitionEnd = (event: TransitionEvent) => {
      if (event.target === backdrop && event.propertyName === "opacity") settle();
    };
    backdrop.addEventListener("transitionend", onTransitionEnd);
    window.setTimeout(settle, PREVIEW_MOTION_BACKSTOP_MS);
  }

  function triggerPreviewFallback(): void {
    if (previewReady || previewDismissed) return;
    window.clearTimeout(previewFallbackTimer);
    closePreviewOverlay();
    void chrome.runtime.sendMessage({ type: "PREVIEW_FALLBACK_STANDALONE" }).catch(() => {});
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
    previewReady = false;
    previewDismissed = false;

    const src = chrome.runtime.getURL("popup/index.html?overlay=1");

    shadow.innerHTML = `
    <style>
      :host { all: initial; }
      .tkp-backdrop {
        position: fixed; inset: 0; z-index: 2147483647;
        display: flex; align-items: center; justify-content: center;
        background: rgba(6, 7, 10, 0.34);
        backdrop-filter: blur(7px) saturate(105%);
        -webkit-backdrop-filter: blur(7px) saturate(105%);
        opacity: 0;
        transition: opacity ${PREVIEW_MOTION_MS}ms cubic-bezier(0.2, 0.8, 0.2, 1);
      }
      .tkp-backdrop.tkp-visible { opacity: 1; }
      .tkp-panel {
        position: relative;
        width: min(1040px, 92vw); height: min(640px, 86vh);
        border-radius: 18px; overflow: hidden;
        background: linear-gradient(180deg, rgba(28, 28, 30, 0.86), rgba(20, 20, 22, 0.84));
        border: 1px solid rgba(255, 255, 255, 0.1);
        box-shadow: 0 32px 90px rgba(0, 0, 0, 0.55);
        backdrop-filter: blur(30px);
        -webkit-backdrop-filter: blur(30px);
        transform: scale(0.98);
        transition: transform ${PREVIEW_MOTION_MS}ms cubic-bezier(0.2, 0.8, 0.2, 1);
      }
      .tkp-backdrop.tkp-visible .tkp-panel { transform: scale(1); }
      .tkp-skeleton {
        position: absolute; inset: 0; padding: 28px;
        display: flex; flex-direction: column; gap: 12px;
        pointer-events: none;
        transition: opacity ${PREVIEW_SKELETON_FADE_MS}ms ease;
      }
      .tkp-skeleton.tkp-hidden { opacity: 0; }
      .tkp-skel-row {
        height: 14px; border-radius: 7px;
        background: linear-gradient(90deg, rgba(255, 255, 255, 0.05), rgba(255, 255, 255, 0.13), rgba(255, 255, 255, 0.05));
        background-size: 200% 100%;
        animation: tkp-shimmer 1.6s ease-in-out infinite;
      }
      .tkp-skel-row--a { width: 32%; }
      .tkp-skel-row--b { width: 68%; }
      .tkp-skel-row--c { width: 52%; }
      @keyframes tkp-shimmer {
        0% { background-position: 200% 0; }
        100% { background-position: -200% 0; }
      }
      .tkp-frame { width: 100%; height: 100%; border: 0; background: transparent; position: relative; }
      @media (prefers-reduced-motion: reduce) {
        .tkp-backdrop, .tkp-panel, .tkp-skeleton, .tkp-skel-row { transition: none !important; animation: none !important; }
      }
    </style>
    <div class="tkp-backdrop" data-role="backdrop">
      <div class="tkp-panel">
        <div class="tkp-skeleton" data-role="skeleton">
          <div class="tkp-skel-row tkp-skel-row--a"></div>
          <div class="tkp-skel-row tkp-skel-row--b"></div>
          <div class="tkp-skel-row tkp-skel-row--c"></div>
        </div>
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
    if (frame) frame.onerror = () => triggerPreviewFallback();

    if (backdrop) {
      if (prefersReducedMotion()) {
        backdrop.classList.add("tkp-visible");
      } else {
        requestAnimationFrame(() => requestAnimationFrame(() => backdrop.classList.add("tkp-visible")));
      }
    }

    // If the iframe never signals "ready" (e.g. CSP blocked it, or a real load
    // failure), degrade to a tab. A loaded-but-slow React app keeps waiting.
    previewFallbackTimer = window.setTimeout(triggerPreviewFallback, PREVIEW_FALLBACK_BACKSTOP_MS);
  }

  // Messages from the React app inside the iframe (cross-frame postMessage).
  window.addEventListener("message", (event) => {
    const data = event.data as { source?: string; type?: string } | undefined;
    if (data?.source !== "tabknight-preview") return;
    if (data.type === "ready") {
      previewReady = true;
      window.clearTimeout(previewFallbackTimer);
      previewHost?.shadowRoot
        ?.querySelector<HTMLElement>("[data-role='skeleton']")
        ?.classList.add("tkp-hidden");
    }
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

  /* --------------------------- media control (audio) ------------------------ */
  // Play/pause routes through here: overlay iframe -> background -> this tab's
  // content script -> media elements. Audio inside cross-origin iframes is
  // unreachable from here — querySelectorAll only sees the top document, so
  // those tabs report "no-media".

  function queryMedia(): HTMLMediaElement[] {
    return Array.from(document.querySelectorAll<HTMLMediaElement>("video, audio"));
  }

  // Shared with handleMediaStatus: the playing element if there is one, else the
  // longest-duration finite-length element, else just the first one found.
  function pickPrimaryMedia(media: HTMLMediaElement[]): HTMLMediaElement {
    const playing = media.filter((el) => !el.paused && !el.ended);
    if (playing.length > 0) {
      return playing.reduce((best, el) => (el.duration > best.duration ? el : best));
    }
    const finite = media.filter((el) => Number.isFinite(el.duration));
    return finite.length > 0
      ? finite.reduce((best, el) => (el.duration > best.duration ? el : best))
      : media[0];
  }

  async function handleMediaControl(message: MediaControlMessage): Promise<MediaControlResult> {
    const media = queryMedia();
    if (media.length === 0) {
      return { ok: false, mediaCount: 0, error: "no-media" };
    }

    if (message.action !== "toggle-play") {
      return { ok: false, mediaCount: media.length, error: "unsupported-action" };
    }

    const playing = media.filter((el) => !el.paused && !el.ended);
    if (playing.length > 0) {
      playing.forEach((el) => el.pause());
      return { ok: true, playing: false, mediaCount: media.length };
    }

    const candidate = pickPrimaryMedia(media);

    try {
      await candidate.play();
      return { ok: true, playing: true, mediaCount: media.length };
    } catch {
      return { ok: false, playing: false, mediaCount: media.length, error: "autoplay-blocked" };
    }
  }

  function handleMediaStatus(): MediaStatusResult {
    const media = queryMedia();
    if (media.length === 0) {
      return { ok: false, mediaCount: 0, error: "no-media" };
    }

    const el = pickPrimaryMedia(media);
    return {
      ok: true,
      playing: !el.paused && !el.ended,
      currentTime: el.currentTime,
      duration: Number.isFinite(el.duration) ? el.duration : undefined,
      mediaCount: media.length,
    };
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "PREVIEW_OVERLAY_TOGGLE") {
      openPreviewOverlay();
      sendResponse({ ok: true });
      return true;
    }

    if (message?.type === "MEDIA_CONTROL") {
      void handleMediaControl(message as MediaControlMessage).then(sendResponse);
      return true;
    }

    if (message?.type === "MEDIA_STATUS") {
      sendResponse(handleMediaStatus());
      return false;
    }

    return false;
  });
})();
