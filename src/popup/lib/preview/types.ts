/**
 * Shared types for the tab-preview feature.
 *
 * A "content card" is the lightweight, text-first snapshot of a tab that the
 * content script harvests from the live DOM (title, description, og:image,
 * a short text excerpt, ...). It is the Phase 1 preview payload.
 *
 * A "thumbnail" is the pixel snapshot of a tab (Phase 2). Its store is created
 * now so we never need an IndexedDB migration later.
 */

/** Text-first snapshot of a page, harvested by the content script. */
export interface ContentCard {
  /** Stable key derived from the normalized URL (see hashUrl). */
  urlHash: string;
  url: string;
  title: string;
  /** og:description or <meta name="description">. */
  description?: string;
  /** Absolute og:image / twitter:image URL, if any. */
  ogImage?: string;
  /** og:site_name, e.g. "GitHub". */
  siteName?: string;
  /** <meta name="theme-color"> — used to tint the preview card. */
  themeColor?: string;
  /** First chunk of readable body text, whitespace-collapsed. */
  excerpt?: string;
  favIconUrl?: string;
  /** Vertical scroll offset when captured (used to restore position later). */
  scrollY?: number;
  /** Epoch ms when this card was captured. */
  capturedAt: number;
}

/** Pixel snapshot of a tab (Phase 2 — store reserved now). */
export interface TabThumbnail {
  urlHash: string;
  /** Downscaled WebP image, encoded from a JPEG capture. */
  blob: Blob;
  /** Optional: absent on thumbnails written before this field existed. */
  width?: number;
  height?: number;
  capturedAt: number;
}

/** Message sent from the content script to the background to persist a card. */
export interface PreviewCardCaptureMessage {
  type: "PREVIEW_CARD_CAPTURE";
  card: ContentCard;
}

/* ------------------------------ media control ----------------------------- */
// Play/pause needs DOM access, so it routes: overlay iframe -> background ->
// target tab's content script -> media elements.

export type MediaAction = "toggle-play";

/** Sent from the background to a tab's content script to act on its media. */
export interface MediaControlMessage {
  type: "MEDIA_CONTROL";
  action: MediaAction;
}

/** Sent from the overlay iframe to the background to control another tab's media. */
export interface MediaControlRequestMessage {
  type: "MEDIA_CONTROL_REQUEST";
  tabId: number;
  action: MediaAction;
}

/** Result of a media control attempt, returned up through the same chain. */
export interface MediaControlResult {
  ok: boolean;
  /** Resulting playback state. */
  playing?: boolean;
  /** Media elements found in the tab. */
  mediaCount?: number;
  /** "no-media" | "autoplay-blocked" | message. */
  error?: string;
}

/** Broadcast by the background when a tab's audible/muted state changes. */
export interface AudibleStateChangedMessage {
  type: "AUDIBLE_STATE_CHANGED";
  tabId: number;
  audible?: boolean;
  muted?: boolean;
}
