#!/usr/bin/env bun
/**
 * Chrome Web Store asset generator for TabKnight.
 *
 * Produces store-ready PNGs in chrome_web_store/images/:
 *   - 4 screenshots at 1280x800 (real captures of the running extension)
 *   - a small promo tile (440x280) and a marquee tile (1400x560)
 *
 * How the real screenshots are captured:
 *   The flagship surface is the Cmd+K in-page overlay — an extension-origin
 *   <iframe> panel drawn over a blurred page backdrop. The panel's tab previews
 *   come from the IndexedDB snapshot store, which the background fills by
 *   harvesting content cards and screenshotting visited tabs (captureVisibleTab
 *   only works on the active tab, so we cycle through real pages to populate it).
 *
 *   Strict-CSP pages block the extension iframe (the extension falls back to a
 *   standalone tab there), so we host the *backdrop* on a local http server
 *   (no CSP, content script still injects) and open real rich sites — Wikipedia,
 *   Chrome for Developers, React, Tailwind — purely as background tabs so their
 *   authentic thumbnails fill the panel.
 *
 * Chrome >= 137 ignores --load-extension; the extension is loaded via the CDP
 * Extensions.loadUnpacked command (requires --enable-unsafe-extension-debugging).
 *
 * No npm deps — Bun built-ins + a tiny CDP client over WebSocket (from smoke.ts).
 *
 * Usage: bun scripts/store-assets.ts
 */

import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const REPO_ROOT = new URL("..", import.meta.url).pathname;
const DIST_DIR = join(REPO_ROOT, "dist");
const OUT_DIR = join(REPO_ROOT, "chrome_web_store", "images");
const ICON_PATH = join(REPO_ROOT, "public", "icons", "icon128.png");

/* --------------------------------- utils --------------------------------- */

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor<T>(
  fn: () => Promise<T | undefined | null | false>,
  { timeoutMs, intervalMs = 250, label }: { timeoutMs: number; intervalMs?: number; label: string }
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let lastErr: unknown;
  while (Date.now() < deadline) {
    try {
      const result = await fn();
      if (result) return result;
    } catch (err) {
      lastErr = err;
    }
    await sleep(intervalMs);
  }
  throw new Error(`Timed out waiting for: ${label}${lastErr ? ` (last error: ${lastErr})` : ""}`);
}

async function findFreePort(): Promise<number> {
  const server = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data() {} } });
  const { port } = server;
  server.stop(true);
  return port;
}

function findChromeBinary(): string {
  const envPath = process.env.CHROME_PATH;
  if (envPath && existsSync(envPath)) return envPath;
  const candidates = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium-browser",
    "/usr/bin/chromium",
  ];
  for (const candidate of candidates) if (existsSync(candidate)) return candidate;
  throw new Error(`No Chrome/Chromium binary found. Set CHROME_PATH. Checked:\n${candidates.join("\n")}`);
}

async function getBuiltServiceWorkerFile(): Promise<string> {
  const manifest = JSON.parse(await Bun.file(join(DIST_DIR, "manifest.json")).text());
  const swFile: string | undefined = manifest?.background?.service_worker;
  if (!swFile) throw new Error("dist/manifest.json has no background.service_worker");
  return swFile;
}

/* ------------------------------- CDP client ------------------------------- */

type JsonListEntry = {
  id: string;
  type: string;
  title?: string;
  url: string;
  webSocketDebuggerUrl?: string;
};

async function jsonList(port: number): Promise<JsonListEntry[]> {
  const res = await fetch(`http://127.0.0.1:${port}/json/list`);
  if (!res.ok) throw new Error(`/json/list returned ${res.status}`);
  return (await res.json()) as JsonListEntry[];
}

async function jsonNew(port: number, url: string): Promise<JsonListEntry> {
  const res = await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(url)}`, {
    method: "PUT",
  });
  if (!res.ok) throw new Error(`/json/new returned ${res.status}`);
  return (await res.json()) as JsonListEntry;
}

async function browserWsUrl(port: number): Promise<string> {
  const res = await fetch(`http://127.0.0.1:${port}/json/version`);
  if (!res.ok) throw new Error(`/json/version returned ${res.status}`);
  const info = (await res.json()) as { webSocketDebuggerUrl?: string };
  if (!info.webSocketDebuggerUrl) throw new Error("/json/version has no webSocketDebuggerUrl");
  return info.webSocketDebuggerUrl;
}

class CDP {
  private ws: WebSocket;
  private nextId = 1;
  private pending = new Map<number, { resolve: (v: any) => void; reject: (e: any) => void }>();
  private ready: Promise<void>;

  constructor(wsUrl: string) {
    this.ws = new WebSocket(wsUrl);
    this.ready = new Promise((resolve, reject) => {
      this.ws.addEventListener("open", () => resolve());
      this.ws.addEventListener("error", () => reject(new Error(`WebSocket error: ${wsUrl}`)));
    });
    this.ws.addEventListener("message", (event) => {
      let msg: any;
      try {
        msg = JSON.parse(event.data as string);
      } catch {
        return;
      }
      if (typeof msg.id === "number" && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id)!;
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message ?? JSON.stringify(msg.error)));
        else resolve(msg.result);
      }
    });
  }

  async send(method: string, params: Record<string, unknown> = {}): Promise<any> {
    await this.ready;
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  close(): void {
    try {
      this.ws.close();
    } catch {
      // ignore
    }
  }
}

async function evaluate(cdp: CDP, expression: string): Promise<any> {
  const result = await cdp.send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) {
    const desc =
      result.exceptionDetails.exception?.description ??
      result.exceptionDetails.text ??
      JSON.stringify(result.exceptionDetails);
    throw new Error(`Runtime.evaluate threw: ${desc}`);
  }
  return result.result?.value;
}

/* ------------------------------ capture helper ---------------------------- */

// Attach to a target, force an exact viewport at 2x for crispness, capture, and
// downscale to the final size with sips so text stays sharp.
async function captureTarget(
  target: JsonListEntry,
  { width, height, outPath, settleMs = 800 }: { width: number; height: number; outPath: string; settleMs?: number }
): Promise<void> {
  if (!target.webSocketDebuggerUrl) throw new Error(`target ${target.url} has no ws url`);
  const cdp = new CDP(target.webSocketDebuggerUrl);
  await cdp.send("Page.enable");
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width,
    height,
    deviceScaleFactor: 2,
    mobile: false,
  });
  await sleep(settleMs);
  const shot = await cdp.send("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: false,
    fromSurface: true,
  });
  await Bun.write(outPath, Buffer.from(shot.data, "base64"));
  cdp.close();
  // Downscale 2x -> exact target size (crisp).
  const sips = Bun.spawn(["sips", "-z", String(height), String(width), outPath], {
    stdout: "ignore",
    stderr: "ignore",
  });
  await sips.exited;
}

/* ------------------------------- HTML assets ------------------------------ */

const ICON_DATA_URI = `data:image/png;base64,${readFileSync(ICON_PATH).toString("base64")}`;

// Shared dark-glassmorphism background used behind the overlay and on the tiles.
function brandBackground(): string {
  return `
    background:#05060a;
    background-image:
      radial-gradient(1100px 720px at 78% -10%, rgba(113,113,122,0.30), transparent 60%),
      radial-gradient(900px 620px at 12% 108%, rgba(161,161,170,0.22), transparent 62%),
      radial-gradient(760px 520px at 92% 96%, rgba(82,82,91,0.24), transparent 60%),
      linear-gradient(180deg,#080a12,#04050a);
  `;
}

// The blurred page behind the Cmd+K overlay. Rich color, no CSP, so the
// extension iframe loads. Content script injects (served over http).
const BACKDROP_HTML = `<!doctype html><html><head><meta charset="utf-8">
<style>
  html,body{margin:0;height:100%;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,"SF Pro Display",system-ui,sans-serif;}
  body{${brandBackground()}}
  .dots{position:fixed;inset:0;opacity:.16;
    background-image:radial-gradient(circle at 1px 1px, rgba(255,255,255,.30) 1px, transparent 0);
    background-size:26px 26px;
    -webkit-mask-image:radial-gradient(circle at 50% 42%, black 8%, transparent 70%);}
  .glow{position:fixed;border-radius:50%;filter:blur(60px);}
  .g1{width:520px;height:520px;left:60%;top:-14%;background:rgba(113,113,122,.32);}
  .g2{width:460px;height:460px;left:-8%;top:58%;background:rgba(161,161,170,.24);}
  h1{position:fixed;left:8%;top:24%;margin:0;font-size:112px;line-height:1;letter-spacing:-.04em;
     font-weight:800;color:rgba(255,255,255,.06);}
  p{position:fixed;left:8.4%;top:46%;margin:0;font-size:26px;letter-spacing:-.01em;color:rgba(255,255,255,.05);}
</style></head><body>
  <div class="glow g1"></div><div class="glow g2"></div>
  <div class="dots"></div>
  <h1>TabKnight</h1><p>keyboard-first tab switching</p>
</body></html>`;

// Promo tiles. `wide` toggles small-tile vs marquee proportions/type scale.
function tileHtml(wide: boolean): string {
  const iconSize = wide ? 132 : 74;
  const title = wide ? 88 : 46;
  const tagline = wide ? 30 : 16.5;
  const pad = wide ? 92 : 40;
  const keycap = wide ? 34 : 20;
  return `<!doctype html><html><head><meta charset="utf-8">
<style>
  *{box-sizing:border-box;}
  html,body{margin:0;height:100%;width:100%;overflow:hidden;
    font-family:-apple-system,BlinkMacSystemFont,"SF Pro Display","Inter",system-ui,sans-serif;}
  body{${brandBackground()}display:flex;align-items:center;}
  .dots{position:fixed;inset:0;opacity:.14;
    background-image:radial-gradient(circle at 1px 1px, rgba(255,255,255,.28) 1px, transparent 0);
    background-size:${wide ? 30 : 20}px ${wide ? 30 : 20}px;
    -webkit-mask-image:radial-gradient(circle at 72% 30%, black 4%, transparent 66%);}
  .glow{position:fixed;border-radius:50%;filter:blur(${wide ? 80 : 46}px);}
  .g1{width:${wide ? 620 : 300}px;height:${wide ? 620 : 300}px;right:-6%;top:-38%;background:rgba(113,113,122,.34);}
  .g2{width:${wide ? 520 : 240}px;height:${wide ? 520 : 240}px;left:-8%;bottom:-46%;background:rgba(82,82,91,.28);}
  .wrap{position:relative;display:flex;align-items:center;gap:${wide ? 44 : 22}px;padding:0 ${pad}px;width:100%;}
  .logo{width:${iconSize}px;height:${iconSize}px;flex:0 0 auto;border-radius:${wide ? 30 : 18}px;
    box-shadow:0 24px 60px rgba(0,0,0,.55), 0 0 0 1px rgba(255,255,255,.08) inset;}
  .txt{min-width:0;}
  .brand{display:flex;align-items:baseline;gap:${wide ? 20 : 11}px;}
  h1{margin:0;font-size:${title}px;line-height:.98;letter-spacing:-.045em;font-weight:800;
    color:#fff;text-shadow:0 2px 24px rgba(0,0,0,.5);}
  h1 b{color:#d4d4d8;font-weight:800;}
  .kbd{display:inline-flex;gap:${wide ? 8 : 5}px;transform:translateY(-${wide ? 10 : 5}px);}
  .kbd span{font-size:${keycap}px;font-weight:700;color:#dbe9ff;
    padding:${wide ? "6px 14px" : "3px 8px"};border-radius:${wide ? 12 : 8}px;
    background:linear-gradient(180deg, rgba(255,255,255,.16), rgba(255,255,255,.05));
    border:1px solid rgba(255,255,255,.20);box-shadow:0 6px 16px rgba(0,0,0,.4);}
  p{margin:${wide ? 22 : 12}px 0 0;font-size:${tagline}px;letter-spacing:-.01em;line-height:1.32;
    color:rgba(226,236,255,.82);font-weight:500;max-width:${wide ? 760 : 250}px;}
</style></head><body>
  <div class="glow g1"></div><div class="glow g2"></div><div class="dots"></div>
  <div class="wrap">
    <img class="logo" src="${ICON_DATA_URI}" alt="">
    <div class="txt">
      <div class="brand">
        <h1>Tab<b>Knight</b></h1>
        <span class="kbd"><span>⌘</span><span>K</span></span>
      </div>
      <p>${wide ? "Keyboard-first tab switching with live previews — jump across every open tab and window, instantly." : "Keyboard-first tab switching with live previews"}</p>
    </div>
  </div>
</body></html>`;
}

// A presentation stage that frames a real popup capture on the brand backdrop.
function popupStageHtml(popupPng: string): string {
  return `<!doctype html><html><head><meta charset="utf-8">
<style>
  html,body{margin:0;height:100%;width:100%;overflow:hidden;
    font-family:-apple-system,BlinkMacSystemFont,"SF Pro Display",system-ui,sans-serif;}
  body{${brandBackground()}display:flex;align-items:center;justify-content:center;gap:64px;}
  .dots{position:fixed;inset:0;opacity:.13;
    background-image:radial-gradient(circle at 1px 1px, rgba(255,255,255,.26) 1px, transparent 0);
    background-size:28px 28px;-webkit-mask-image:radial-gradient(circle at 30% 40%, black 6%, transparent 70%);}
  .glow{position:fixed;border-radius:50%;filter:blur(70px);}
  .g1{width:520px;height:520px;right:2%;top:-30%;background:rgba(113,113,122,.30);}
  .copy{max-width:420px;}
  .copy h2{margin:0;font-size:52px;line-height:1.02;letter-spacing:-.03em;font-weight:800;color:#fff;}
  .copy h2 b{color:#d4d4d8;}
  .copy p{margin:20px 0 0;font-size:21px;line-height:1.45;color:rgba(226,236,255,.78);font-weight:500;}
  .shot{width:400px;height:500px;border-radius:22px;overflow:hidden;
    box-shadow:0 40px 100px rgba(0,0,0,.6), 0 0 0 1px rgba(255,255,255,.10);}
  .shot img{width:400px;height:500px;display:block;}
</style></head><body>
  <div class="glow g1"></div><div class="dots"></div>
  <div class="copy">
    <h2>Your command<br>bar for <b>tabs</b></h2>
    <p>Open the toolbar to search every tab, paste a URL, or save the whole window as a bookmark session.</p>
  </div>
  <div class="shot"><img src="${popupPng}" alt=""></div>
</body></html>`;
}

/* --------------------------------- main ----------------------------------- */

const REAL_PAGES = [
  "https://en.wikipedia.org/wiki/Aurora",
  "https://en.wikipedia.org/wiki/Kyoto",
  "https://en.wikipedia.org/wiki/React_(software)",
  "https://developer.chrome.com/",
  "https://react.dev/",
  "https://tailwindcss.com/",
];

async function main(): Promise<number> {
  if (!existsSync(DIST_DIR)) {
    console.log("dist/ not found, building (bun run build)...");
    const build = Bun.spawn(["bun", "run", "build"], { cwd: REPO_ROOT, stdout: "inherit", stderr: "inherit" });
    if ((await build.exited) !== 0) {
      console.error("Build failed.");
      return 1;
    }
  }
  mkdirSync(OUT_DIR, { recursive: true });

  const swFile = await getBuiltServiceWorkerFile();
  const userDataDir = await mkdtemp(join(tmpdir(), "tabknight-assets-"));
  const port = await findFreePort();
  const chromeBinary = findChromeBinary();

  // Local http server: '/' = overlay backdrop; other routes are static stages.
  const routes: Record<string, string> = {
    "/": BACKDROP_HTML,
    "/stage": "",
    "/tile-small": tileHtml(false),
    "/marquee": tileHtml(true),
  };
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch(req) {
      const u = new URL(req.url);
      const body = routes[u.pathname] ?? routes["/"];
      return new Response(body, { headers: { "content-type": "text/html; charset=utf-8" } });
    },
  });
  const base = `http://127.0.0.1:${server.port}`;
  const BACKDROP_URL = `${base}/`;

  const flags = [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    "--enable-unsafe-extension-debugging",
    "--headless=new",
    "--window-size=1280,800",
    "--hide-scrollbars",
    "--force-device-scale-factor=1",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-features=ChromeWhatsNewUI",
    BACKDROP_URL,
  ];

  const proc = Bun.spawn([chromeBinary, ...flags], { stdout: "ignore", stderr: "ignore" });
  let browser: CDP | undefined;
  const produced: string[] = [];

  const findOurSw = (list: JsonListEntry[]) =>
    list.find(
      (t) => t.type === "service_worker" && t.url.startsWith("chrome-extension://") && t.url.endsWith(`/${swFile}`)
    );

  try {
    // Wait for the backdrop page target, then load the extension via CDP.
    await waitFor(
      async () => (await jsonList(port)).find((t) => t.type === "page" && t.url.startsWith(base)),
      { timeoutMs: 10000, intervalMs: 300, label: "backdrop page target" }
    );
    browser = new CDP(await browserWsUrl(port));

    let sw = findOurSw(await jsonList(port));
    if (!sw) {
      await browser.send("Extensions.loadUnpacked", { path: DIST_DIR });
      sw = await waitFor(async () => findOurSw(await jsonList(port)), {
        timeoutMs: 8000,
        intervalMs: 300,
        label: "extension service worker after loadUnpacked",
      });
    }
    const extensionId = new URL(sw!.url).hostname;
    const swCdp = new CDP(sw!.webSocketDebuggerUrl!);
    await swCdp.send("Runtime.enable");
    console.log(`extension loaded: ${extensionId}`);

    // Open the real rich pages as background tabs so the background harvests
    // their content cards / thumbnails to fill the overlay panel.
    await evaluate(
      swCdp,
      `(async () => {
        const urls = ${JSON.stringify(REAL_PAGES)};
        for (const url of urls) await chrome.tabs.create({ url, active: false });
        return "created";
      })()`
    );
    console.log("opened real pages, harvesting...");
    await sleep(4000); // let them load + run the initial harvest

    // Activate each real tab briefly so captureVisibleTab can thumbnail it.
    // End on Kyoto (great lead image) so it becomes the "previous tab" the
    // overlay selects + previews first.
    await evaluate(
      swCdp,
      `(async () => {
        const order = ${JSON.stringify(REAL_PAGES)};
        const tabs = await chrome.tabs.query({});
        for (const url of order) {
          const t = tabs.find((x) => x.url && x.url.startsWith(url.split("?")[0]));
          if (!t) continue;
          await chrome.tabs.update(t.id, { active: true });
          await new Promise((r) => setTimeout(r, 2600));
        }
        return "cycled";
      })()`
    );
    console.log("thumbnails captured");

    // Reload the backdrop tab so its content script is present (it loaded before
    // the extension), then confirm the content script answers before toggling.
    await evaluate(
      swCdp,
      `(async () => {
        const [tab] = await chrome.tabs.query({ url: "${BACKDROP_URL}" });
        await chrome.tabs.update(tab.id, { active: true });
        await chrome.tabs.reload(tab.id);
        return "reloaded";
      })()`
    );
    await waitFor(
      async () => {
        const state = await evaluate(
          swCdp,
          `(async () => {
            try {
              const [tab] = await chrome.tabs.query({ url: "${BACKDROP_URL}" });
              await chrome.tabs.sendMessage(tab.id, { type: "MEDIA_STATUS" });
              return "ready";
            } catch (e) { return "no: " + e; }
          })()`
        );
        return state === "ready";
      },
      { timeoutMs: 10000, intervalMs: 400, label: "backdrop content script ready" }
    );
    await sleep(800);

    const toggleExpr = `(async () => {
      const [tab] = await chrome.tabs.query({ url: "${BACKDROP_URL}" });
      const res = await chrome.tabs.sendMessage(tab.id, { type: "PREVIEW_OVERLAY_TOGGLE" });
      return JSON.stringify(res);
    })()`;

    /* --------------------- SHOT 1: overlay hero --------------------- */
    await evaluate(swCdp, toggleExpr);
    // Wait for the extension iframe target to exist and mount its search input.
    const iframeTarget = await waitFor(
      async () => {
        const t = (await jsonList(port)).find((x) => x.url.includes("overlay=1"));
        if (!t?.webSocketDebuggerUrl) return null;
        const probe = new CDP(t.webSocketDebuggerUrl);
        try {
          await probe.send("Runtime.enable");
          const ok = await evaluate(probe, `!!document.querySelector('input[aria-label="Search tabs"]')`);
          probe.close();
          return ok ? t : null;
        } catch {
          probe.close();
          return null;
        }
      },
      { timeoutMs: 12000, intervalMs: 500, label: "overlay iframe mounted" }
    );
    await sleep(1800); // let previews upgrade to their best tier

    const heroPage = await waitFor(
      async () => (await jsonList(port)).find((t) => t.type === "page" && t.url.startsWith(base)),
      { timeoutMs: 4000, intervalMs: 250, label: "backdrop page target for capture" }
    );
    const shot1 = join(OUT_DIR, "screenshot-1-overlay.png");
    await captureTarget(heroPage, { width: 1280, height: 800, outPath: shot1, settleMs: 600 });
    produced.push(shot1);
    console.log("captured screenshot-1-overlay");

    /* --------------------- SHOT 2: overlay mid-search --------------------- */
    // Type a query into the (controlled) React input inside the extension iframe.
    const typer = new CDP(iframeTarget.webSocketDebuggerUrl!);
    await typer.send("Runtime.enable");
    await evaluate(
      typer,
      `(() => {
        const input = document.querySelector('input[aria-label="Search tabs"]');
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
        setter.call(input, "wiki");
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.focus();
        return true;
      })()`
    );
    typer.close();
    await sleep(1000);
    const shot2 = join(OUT_DIR, "screenshot-2-search.png");
    await captureTarget(heroPage, { width: 1280, height: 800, outPath: shot2, settleMs: 500 });
    produced.push(shot2);
    console.log("captured screenshot-2-search");

    // Close the overlay.
    await evaluate(swCdp, toggleExpr).catch(() => {});
    await sleep(500);

    /* --------------------- SHOT 3: options page --------------------- */
    const optionsTarget = await jsonNew(port, `chrome-extension://${extensionId}/popup/options.html`);
    const shot3 = join(OUT_DIR, "screenshot-3-options.png");
    await captureTarget(optionsTarget, { width: 1280, height: 800, outPath: shot3, settleMs: 1500 });
    produced.push(shot3);
    await browser.send("Target.closeTarget", { targetId: optionsTarget.id }).catch(() => {});
    console.log("captured screenshot-3-options");

    /* --------------------- SHOT 4: popup framed on stage --------------------- */
    // Close the localhost backdrop tab so it doesn't show up (with a broken
    // favicon) in the popup's real tab list.
    await evaluate(
      swCdp,
      `(async () => {
        const tabs = await chrome.tabs.query({ url: "${BACKDROP_URL}" });
        for (const t of tabs) await chrome.tabs.remove(t.id);
        return "closed";
      })()`
    ).catch(() => {});
    await sleep(400);

    // Capture the real popup at its native 400x500, then frame it on a stage.
    const popupRaw = join(OUT_DIR, ".popup-raw.png");
    const popupTarget = await jsonNew(port, `chrome-extension://${extensionId}/popup/index.html`);
    await captureTarget(popupTarget, { width: 400, height: 500, outPath: popupRaw, settleMs: 1400 });
    await browser.send("Target.closeTarget", { targetId: popupTarget.id }).catch(() => {});
    const popupDataUri = `data:image/png;base64,${readFileSync(popupRaw).toString("base64")}`;
    routes["/stage"] = popupStageHtml(popupDataUri);
    const stageTarget = await jsonNew(port, `${base}/stage`);
    const shot4 = join(OUT_DIR, "screenshot-4-popup.png");
    await captureTarget(stageTarget, { width: 1280, height: 800, outPath: shot4, settleMs: 900 });
    await browser.send("Target.closeTarget", { targetId: stageTarget.id }).catch(() => {});
    rmSync(popupRaw, { force: true });
    produced.push(shot4);
    console.log("captured screenshot-4-popup");

    /* --------------------- TILES --------------------- */
    const smallTarget = await jsonNew(port, `${base}/tile-small`);
    const tileSmall = join(OUT_DIR, "tile-small-440x280.png");
    await captureTarget(smallTarget, { width: 440, height: 280, outPath: tileSmall, settleMs: 700 });
    await browser.send("Target.closeTarget", { targetId: smallTarget.id }).catch(() => {});
    produced.push(tileSmall);
    console.log("captured tile-small-440x280");

    const marqueeTarget = await jsonNew(port, `${base}/marquee`);
    const marquee = join(OUT_DIR, "marquee-1400x560.png");
    await captureTarget(marqueeTarget, { width: 1400, height: 560, outPath: marquee, settleMs: 700 });
    await browser.send("Target.closeTarget", { targetId: marqueeTarget.id }).catch(() => {});
    produced.push(marquee);
    console.log("captured marquee-1400x560");

    swCdp.close();
  } catch (err) {
    console.error(`asset generation failed: ${(err as Error).message}`);
  } finally {
    browser?.close();
    server.stop(true);
    try {
      proc.kill();
    } catch {
      // ignore
    }
    await proc.exited.catch(() => {});
    try {
      rmSync(userDataDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }

  console.log("\nproduced:");
  for (const f of produced) {
    const dims = Bun.spawnSync(["sips", "-g", "pixelWidth", "-g", "pixelHeight", f]);
    const out = dims.stdout.toString().match(/pixel\w+: (\d+)/g)?.map((s) => s.split(": ")[1]) ?? [];
    const size = existsSync(f) ? (readFileSync(f).length / 1024).toFixed(0) : "?";
    console.log(`  ${f.replace(REPO_ROOT, "")}  ${out.join("x")}  ${size}KB`);
  }
  return produced.length >= 5 ? 0 : 1;
}

process.exit(await main());
