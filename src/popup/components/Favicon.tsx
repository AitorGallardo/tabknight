import { useEffect, useState } from "react";
import { cn } from "../lib/cn";

interface FaviconProps {
  pageUrl: string;
  favIconUrl?: string;
  size?: number;
  className?: string;
}

function isChromeUrl(url: string): boolean {
  return url.startsWith("chrome://");
}

function initialTier(favIconUrl?: string): 1 | 2 {
  return favIconUrl && !isChromeUrl(favIconUrl) ? 1 : 2;
}

// Chrome's local favicon cache — no network request, extension-origin only.
// Requires the "favicon" permission (public/manifest.json).
function faviconCacheUrl(pageUrl: string, size: number): string | undefined {
  if (typeof chrome === "undefined" || !chrome.runtime?.getURL) return undefined;
  const params = new URLSearchParams({ pageUrl, size: String(Math.min(64, size * 2)) });
  return chrome.runtime.getURL(`_favicon/?${params.toString()}`);
}

function hostInitial(pageUrl: string): string {
  try {
    const host = new URL(pageUrl).hostname.replace(/^www\./, "");
    return (host.charAt(0) || "?").toUpperCase();
  } catch {
    return "?";
  }
}

/** Favicon with a 3-tier local-only fallback: tab favIconUrl -> Chrome's favicon cache -> letter tile. */
export function Favicon({ pageUrl, favIconUrl, size = 20, className }: FaviconProps) {
  const [tier, setTier] = useState<1 | 2 | 3>(() => initialTier(favIconUrl));

  useEffect(() => {
    setTier(initialTier(favIconUrl));
  }, [pageUrl, favIconUrl]);

  useEffect(() => {
    if (tier === 2 && !faviconCacheUrl(pageUrl, size)) setTier(3);
  }, [tier, pageUrl, size]);

  const style = { width: size, height: size };

  if (tier === 3) {
    return (
      <span
        className={cn(
          "grid place-items-center rounded-[inherit] bg-white/[0.10] font-semibold text-white/70",
          className
        )}
        style={{ ...style, fontSize: size * 0.55 }}
      >
        {hostInitial(pageUrl)}
      </span>
    );
  }

  const src = tier === 1 ? favIconUrl : faviconCacheUrl(pageUrl, size);

  return (
    <span className={cn("block overflow-hidden rounded-[inherit]", className)} style={style}>
      <img
        src={src}
        alt=""
        className="h-full w-full object-cover"
        onError={() => setTier((t) => (t === 1 ? 2 : 3))}
      />
    </span>
  );
}
