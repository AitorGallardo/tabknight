#!/usr/bin/env bun
/**
 * End-to-end smoke test for the TabKnight Chrome extension.
 *
 * Launches a real Chrome with the built extension, drives it over the Chrome
 * DevTools Protocol (plain WebSocket + fetch, no npm deps), and asserts that:
 *
 *   1. The preview overlay (Cmd+K) injects and renders on a live page.
 *   2. Universal intent search renders all available typed sources.
 *   3. The options page loads and mounts React.
 *   4. The overlay closes cleanly.
 *
 * Chrome >= 137 (stable) ignores --load-extension, so the extension is loaded
 * via the CDP `Extensions.loadUnpacked` command, which requires launching with
 * --enable-unsafe-extension-debugging. We still pass --load-extension as a
 * fallback for older Chromes.
 *
 * Usage: bun run smoke
 */

import { existsSync, rmSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const REPO_ROOT = new URL("..", import.meta.url).pathname;
const DIST_DIR = join(REPO_ROOT, "dist");
const TEST_URL = "https://example.com/";

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
  const server = Bun.listen({
    hostname: "127.0.0.1",
    port: 0,
    socket: { data() {} },
  });
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
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  throw new Error(
    `No Chrome/Chromium binary found. Set CHROME_PATH or install Chrome. Checked:\n${candidates
      .map((c) => `  - ${c}`)
      .join("\n")}`
  );
}

// The service worker filename from the built manifest — used to recognize
// *our* service worker target among Chrome's own component-extension workers.
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

/** Minimal CDP connection: id-matched request/response over a WebSocket. */
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

/** Runtime.evaluate with awaitPromise, returning the JS value (or throwing on JS exceptions). */
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

/* --------------------------------- main ----------------------------------- */

type TestResult = { name: string; ok: boolean; error?: string };

async function main(): Promise<number> {
  const startedAt = Date.now();

  if (!existsSync(DIST_DIR)) {
    console.log("dist/ not found, building extension first (bun run build)...");
    const build = Bun.spawn(["bun", "run", "build"], {
      cwd: REPO_ROOT,
      stdout: "inherit",
      stderr: "inherit",
    });
    const code = await build.exited;
    if (code !== 0) {
      console.error("Build failed. Fix the build before running smoke tests.");
      return 1;
    }
  }

  const swFile = await getBuiltServiceWorkerFile();
  const userDataDir = await mkdtemp(join(tmpdir(), "tabknight-smoke-"));
  const port = await findFreePort();
  const chromeBinary = findChromeBinary();

  const baseFlags = [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    // Fallback for pre-137 Chromes; ignored by current stable.
    `--load-extension=${DIST_DIR}`,
    // Required for CDP Extensions.loadUnpacked (the supported path on 137+).
    "--enable-unsafe-extension-debugging",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-features=ChromeWhatsNewUI",
  ];

  let proc: ReturnType<typeof Bun.spawn> | undefined;
  let browser: CDP | undefined;
  let mode = "";
  const results: TestResult[] = [];

  function launch(headless: boolean): ReturnType<typeof Bun.spawn> {
    const flags = headless ? [...baseFlags, "--headless=new", TEST_URL] : [...baseFlags, TEST_URL];
    return Bun.spawn([chromeBinary, ...flags], {
      stdout: "ignore",
      stderr: "ignore",
    });
  }

  function findOurSw(list: JsonListEntry[]): JsonListEntry | undefined {
    return list.find(
      (t) =>
        t.type === "service_worker" &&
        t.url.startsWith("chrome-extension://") &&
        t.url.endsWith(`/${swFile}`)
    );
  }

  // Wait for DevTools + the example.com page target, load the extension via
  // CDP if --load-extension was ignored, and wait for our service worker.
  async function setUp(): Promise<{ extensionId: string; swWsUrl: string }> {
    await waitFor(
      async () => {
        const list = await jsonList(port);
        return list.find((t) => t.type === "page" && t.url.startsWith("https://example.com"));
      },
      { timeoutMs: 8000, intervalMs: 300, label: "example.com page target in /json/list" }
    );

    browser?.close();
    browser = new CDP(await browserWsUrl(port));

    // Give --load-extension a brief chance (older Chromes), then load via CDP.
    let sw = findOurSw(await jsonList(port));
    if (!sw) {
      await sleep(750);
      sw = findOurSw(await jsonList(port));
    }
    if (!sw) {
      await browser.send("Extensions.loadUnpacked", { path: DIST_DIR });
      sw = await waitFor(async () => findOurSw(await jsonList(port)), {
        timeoutMs: 8000,
        intervalMs: 300,
        label: "extension service worker target after Extensions.loadUnpacked",
      });
    }
    if (!sw.webSocketDebuggerUrl) throw new Error("SW target has no webSocketDebuggerUrl");

    return {
      extensionId: new URL(sw.url).hostname,
      swWsUrl: sw.webSocketDebuggerUrl,
    };
  }

  try {
    // Try headless=new first (CI-friendly); fall back to headful once if the
    // extension/page targets never come up.
    mode = "--headless=new";
    proc = launch(true);

    let targets: Awaited<ReturnType<typeof setUp>>;
    try {
      targets = await setUp();
    } catch (headlessErr) {
      console.log(
        `headless=new setup failed (${(headlessErr as Error).message}); retrying headful...`
      );
      try {
        proc.kill();
      } catch {
        // ignore
      }
      await proc.exited.catch(() => {});
      await sleep(300);
      mode = "headful";
      proc = launch(false);
      targets = await setUp();
    }

    const { extensionId, swWsUrl } = targets;

    const sw = new CDP(swWsUrl);
    await sw.send("Runtime.enable");

    // The page likely loaded before the extension did, so its content script
    // was never injected. Reload via the extension (not via a CDP page session
    // — reloads can swap the renderer and strand an already-attached session),
    // then probe with a side-effect-free message (MEDIA_STATUS) until the
    // content script answers.
    await evaluate(
      sw,
      `(async () => {
        const [tab] = await chrome.tabs.query({ url: "${TEST_URL}" });
        await chrome.tabs.reload(tab.id);
        return "reloaded";
      })()`
    );
    await waitFor(
      async () => {
        const state = await evaluate(
          sw,
          `(async () => {
            try {
              const [tab] = await chrome.tabs.query({ url: "${TEST_URL}" });
              if (!tab) return "no-tab";
              await chrome.tabs.sendMessage(tab.id, { type: "MEDIA_STATUS" });
              return "ready";
            } catch (err) {
              return "not-ready: " + err;
            }
          })()`
        );
        return state === "ready";
      },
      { timeoutMs: 10000, intervalMs: 400, label: "content script to answer MEDIA_STATUS" }
    );

    // Attach to the page only now, after the reload has settled, so the
    // session is bound to the live renderer.
    const pageTarget = await waitFor(
      async () => {
        const list = await jsonList(port);
        return list.find((t) => t.type === "page" && t.url.startsWith("https://example.com"));
      },
      { timeoutMs: 5000, intervalMs: 250, label: "example.com page target after reload" }
    );
    if (!pageTarget.webSocketDebuggerUrl) {
      throw new Error("page target has no webSocketDebuggerUrl after reload");
    }
    const page = new CDP(pageTarget.webSocketDebuggerUrl);
    await page.send("Runtime.enable");

    const toggleExpr = `(async () => {
      const [tab] = await chrome.tabs.query({ url: "${TEST_URL}" });
      const res = await chrome.tabs.sendMessage(tab.id, { type: "PREVIEW_OVERLAY_TOGGLE" });
      return JSON.stringify(res);
    })()`;

    /* ------------------------- TEST 1: overlay injects ------------------------ */
    try {
      const toggleRes = await evaluate(sw, toggleExpr);
      const parsed = JSON.parse(toggleRes);
      if (!parsed?.ok) throw new Error(`toggle response was not {ok:true}: ${toggleRes}`);

      await sleep(500);

      const overlayCheckExpr = `(() => {
        const host = document.getElementById("tabknight-preview-host");
        const iframe = host && host.shadowRoot ? host.shadowRoot.querySelector("iframe") : null;
        return JSON.stringify({
          hasHost: !!host,
          hasIframe: !!iframe,
          iframeSrc: iframe ? iframe.src : null,
        });
      })()`;

      let overlayState: { hasHost: boolean; hasIframe: boolean; iframeSrc: string | null } | null =
        null;
      for (let attempt = 0; attempt < 3; attempt++) {
        overlayState = JSON.parse(await evaluate(page, overlayCheckExpr));
        if (overlayState?.hasHost && overlayState?.hasIframe) break;
        await sleep(500);
      }

      if (!overlayState?.hasHost) throw new Error("overlay host element not found");
      if (!overlayState.hasIframe) throw new Error("overlay iframe not found in shadow root");
      if (!overlayState.iframeSrc?.startsWith("chrome-extension://")) {
        throw new Error(
          `iframe src did not start with chrome-extension://: ${overlayState.iframeSrc}`
        );
      }

      results.push({ name: "overlay injects and renders on page", ok: true });
    } catch (err) {
      results.push({
        name: "overlay injects and renders on page",
        ok: false,
        error: (err as Error).message,
      });
    }

    /* -------------------- TEST 2: universal intent results -------------------- */
    try {
      await evaluate(
        sw,
        `(async () => {
          await chrome.bookmarks.create({ title: "Example bookmark", url: "https://bookmarks.example.net/" });
          await chrome.history.addUrl({ url: "https://history.example.org/" });
          return true;
        })()`
      );
      const intentUrl = `chrome-extension://${extensionId}/popup/index.html?overlay=1`;
      const target = await jsonNew(port, intentUrl);
      if (!target.webSocketDebuggerUrl) throw new Error("no webSocketDebuggerUrl for intent target");
      const intentCdp = new CDP(target.webSocketDebuggerUrl);
      await intentCdp.send("Runtime.enable");
      await waitFor(
        async () =>
          evaluate(
            intentCdp,
            `document.querySelector('input[aria-label="Search tabs, bookmarks, history, or the web"]') ? true : false`
          ),
        { timeoutMs: 5000, intervalMs: 200, label: "universal search input" }
      );
      await evaluate(
        intentCdp,
        `(() => {
          const input = document.querySelector('input[aria-label="Search tabs, bookmarks, history, or the web"]');
          const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
          setter.call(input, "example");
          input.dispatchEvent(new Event("input", { bubbles: true }));
          return true;
        })()`
      );
      const labels = await waitFor(
        async () => {
          const value = (await evaluate(
            intentCdp,
            `Array.from(document.querySelectorAll('[role="option"]')).map((row) => row.textContent || "")`
          )) as string[];
          const expected = ["Open tab", "Bookmark", "History", "Direct URL", "Web search"];
          return expected.every((label) => value.some((row) => row.includes(label))) ? value : false;
        },
        { timeoutMs: 5000, intervalMs: 200, label: "all typed universal intent sources" }
      );
      if (labels.length < 5) throw new Error(`expected at least 5 intent rows, got ${labels.length}`);
      results.push({ name: "universal intent sources render", ok: true });
      intentCdp.close();
      await browser?.send("Target.closeTarget", { targetId: target.id });
    } catch (err) {
      results.push({ name: "universal intent sources render", ok: false, error: (err as Error).message });
    }

    /* -------------------------- TEST 3: options page -------------------------- */
    try {
      const optionsUrl = `chrome-extension://${extensionId}/popup/options.html`;
      const target = await jsonNew(port, optionsUrl);
      if (!target.webSocketDebuggerUrl) {
        throw new Error("no webSocketDebuggerUrl for options target");
      }
      const optionsCdp = new CDP(target.webSocketDebuggerUrl);
      await optionsCdp.send("Runtime.enable");
      await sleep(1000);
      const mounted = await evaluate(
        optionsCdp,
        `document.getElementById("root")?.children.length > 0`
      );
      if (!mounted) throw new Error("options page #root has no children");
      results.push({ name: "options page loads and mounts", ok: true });
      optionsCdp.close();
      await browser?.send("Target.closeTarget", { targetId: target.id });
    } catch (err) {
      results.push({
        name: "options page loads and mounts",
        ok: false,
        error: (err as Error).message,
      });
    }

    /* ------------------------- TEST 4: overlay closes ------------------------- */
    try {
      const toggleRes = await evaluate(sw, toggleExpr);
      const parsed = JSON.parse(toggleRes);
      if (!parsed?.ok) throw new Error(`toggle response was not {ok:true}: ${toggleRes}`);

      // The close animates (~200ms); poll until the host is gone.
      await waitFor(
        async () => {
          const stillThere = await evaluate(
            page,
            `!!document.getElementById("tabknight-preview-host")`
          );
          return stillThere === false;
        },
        { timeoutMs: 1500, intervalMs: 150, label: "overlay host to be removed" }
      );

      results.push({ name: "overlay closes", ok: true });
    } catch (err) {
      results.push({ name: "overlay closes", ok: false, error: (err as Error).message });
    }

    sw.close();
    page.close();
  } catch (err) {
    console.error(`Smoke test setup failed: ${(err as Error).message}`);
  } finally {
    browser?.close();
    if (proc) {
      try {
        proc.kill();
      } catch {
        // ignore
      }
      await proc.exited.catch(() => {});
    }
    try {
      rmSync(userDataDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }

  const runtimeMs = Date.now() - startedAt;
  console.log("");
  for (const r of results) {
    console.log(`${r.ok ? "✓" : "✗"} ${r.name}${r.ok ? "" : ` — ${r.error}`}`);
  }
  console.log("");
  console.log(`mode: ${mode}, runtime: ${(runtimeMs / 1000).toFixed(1)}s`);

  const allPassed = results.length === 4 && results.every((r) => r.ok);
  return allPassed ? 0 : 1;
}

const exitCode = await main();
process.exit(exitCode);
