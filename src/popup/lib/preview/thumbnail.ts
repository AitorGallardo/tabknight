/**
 * Pixel-thumbnail capture (Phase 2) — background-only.
 *
 * Chrome can only screenshot the *visible* tab, so we capture the active tab
 * while it's on screen, downscale it to a small WebP, and store it keyed by
 * URL hash. The preview view later shows it as the "real last-seen" tier.
 *
 * Uses OffscreenCanvas + createImageBitmap, both available in the service
 * worker. Everything is best-effort: any failure just skips the capture.
 */
import { hashUrl } from "./hash";
import { putThumbnail, pruneThumbnails } from "./db";

// Capture as JPEG (source quality only needs to survive one re-encode below;
// PNG just wastes memory/time for no visible gain). 1600px keeps the stored
// image retina-sharp for the ~700px hero pane at 2x DPR without bloating storage.
const CAPTURE_FORMAT = "jpeg" as const;
const CAPTURE_QUALITY = 90;
const THUMB_MAX_WIDTH = 1600;
const THUMB_QUALITY = 0.85;

/** Only http(s) pages can be captured; chrome://, the Web Store, etc. cannot. */
export function isCapturableUrl(url: string | undefined): url is string {
  if (!url) return false;
  if (!/^https?:\/\//i.test(url)) return false;
  if (url.startsWith("https://chrome.google.com/webstore")) return false;
  return true;
}

async function dataUrlToBitmap(dataUrl: string): Promise<ImageBitmap> {
  const response = await fetch(dataUrl);
  const blob = await response.blob();
  return createImageBitmap(blob);
}

/**
 * Capture the active/visible tab of its window and persist a downscaled WebP.
 * The caller is responsible for throttling — this always attempts a capture.
 */
export async function captureActiveTabThumbnail(tab: chrome.tabs.Tab): Promise<void> {
  if (tab.windowId === undefined || !isCapturableUrl(tab.url)) return;

  let dataUrl: string;
  try {
    dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, {
      format: CAPTURE_FORMAT,
      quality: CAPTURE_QUALITY,
    });
  } catch {
    // Tab not in foreground, restricted, or rate-limited.
    return;
  }
  if (!dataUrl) return;

  try {
    const bitmap = await dataUrlToBitmap(dataUrl);
    const scale = Math.min(1, THUMB_MAX_WIDTH / bitmap.width);
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      bitmap.close();
      return;
    }
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();

    const blob = await canvas.convertToBlob({ type: "image/webp", quality: THUMB_QUALITY });
    await putThumbnail({ urlHash: hashUrl(tab.url), blob, width, height, capturedAt: Date.now() });
    await pruneThumbnails();
  } catch {
    // Decode/encode/storage failure — skip.
  }
}
