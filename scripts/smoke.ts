#!/usr/bin/env bun
/**
 * End-to-end smoke test for the TabKnight Chrome extension.
 *
 * Launches a real Chrome with the built extension, drives it over the Chrome
 * DevTools Protocol (plain WebSocket + fetch, no npm deps), and asserts that:
 *
 *   1. The preview overlay injects exactly once and focuses its frame.
 *   2. Responsive light/dark, wide/narrow, and accessibility contracts hold.
 *   3. Palette starts at the newest tab and Alt/Option+W closes that selection.
 *   4. Cmd+Option+\\ closes the palette and guides Chrome's native Split View
 *      without creating or moving any window.
 *   5. Host-page spoofed lifecycle messages are ignored.
 *   6. Popup and standalone sizing stay within their viewports.
 *   7. Universal intent search renders all available typed sources.
 *   8. The privacy options page loads with rich page text enabled by default.
 *   9. The overlay closes cleanly.
 *   10. A restricted-page fallback explains itself, focuses search, and Escape
 *      closes it while restoring the origin tab.
 *
 * Chrome >= 137 (stable) ignores --load-extension, so the extension is loaded
 * via the CDP `Extensions.loadUnpacked` command, which requires launching with
 * --enable-unsafe-extension-debugging. We still pass --load-extension as a
 * fallback for older Chromes.
 *
 * Usage: bun run smoke
 */

import { existsSync, rmSync } from "node:fs";
import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const REPO_ROOT = new URL("..", import.meta.url).pathname;
const DIST_DIR = join(REPO_ROOT, "dist");

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
  const testServer = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: () =>
      new Response("<!doctype html><title>TabKnight smoke page</title><main>Local test page</main>", {
        headers: { "content-type": "text/html; charset=utf-8" },
      }),
  });
  const testUrl = `http://127.0.0.1:${testServer.port}/`;

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
    const flags = headless ? [...baseFlags, "--headless=new", testUrl] : [...baseFlags, testUrl];
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

  // Wait for DevTools + the loopback page target, load the extension via
  // CDP if --load-extension was ignored, and wait for our service worker.
  async function setUp(): Promise<{ extensionId: string; swWsUrl: string }> {
    await waitFor(
      async () => {
        const list = await jsonList(port);
        return list.find((t) => t.type === "page" && t.url === testUrl);
      },
      { timeoutMs: 8000, intervalMs: 300, label: "loopback page target in /json/list" }
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
        const [tab] = await chrome.tabs.query({ url: "${testUrl}" });
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
              const [tab] = await chrome.tabs.query({ url: "${testUrl}" });
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
        return list.find((t) => t.type === "page" && t.url === testUrl);
      },
      { timeoutMs: 5000, intervalMs: 250, label: "loopback page target after reload" }
    );
    if (!pageTarget.webSocketDebuggerUrl) {
      throw new Error("page target has no webSocketDebuggerUrl after reload");
    }
    const page = new CDP(pageTarget.webSocketDebuggerUrl);
    await page.send("Runtime.enable");
    await page.send("Page.enable");

    const toggleExpr = `(async () => {
      const [tab] = await chrome.tabs.query({ url: "${testUrl}" });
      const res = await chrome.tabs.sendMessage(tab.id, {
        type: "PREVIEW_OVERLAY_TOGGLE",
        invocationId: "smoke-" + crypto.randomUUID(),
        startedAt: Date.now(),
      });
      return JSON.stringify(res);
    })()`;

    // Seed one inactive result so compact-row and selection checks are
    // deterministic even in the clean throwaway Chrome profile.
    const seededTabId = await evaluate(
      sw,
      `(async () => {
        const existing = await chrome.tabs.query({ url: "https://example.org/" });
        const tab = existing[0] ?? await chrome.tabs.create({ url: "https://example.org/", active: false });
        return tab.id;
      })()`
    );
    await waitFor(
      async () =>
        evaluate(
          sw,
          `(async () => {
            const tab = await chrome.tabs.get(${seededTabId});
            return tab.status === "complete" && tab.url === "https://example.org/";
          })()`
        ),
      { timeoutMs: 10000, intervalMs: 200, label: "seeded result tab to finish loading" }
    );

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
          hostCount: document.querySelectorAll("#tabknight-preview-host").length,
          hasIframe: !!iframe,
          iframeSrc: iframe ? iframe.src : null,
          frameFocused: host?.shadowRoot?.activeElement === iframe,
        });
      })()`;

      let overlayState: {
        hasHost: boolean;
        hostCount: number;
        hasIframe: boolean;
        iframeSrc: string | null;
        frameFocused: boolean;
      } | null = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        overlayState = JSON.parse(await evaluate(page, overlayCheckExpr));
        if (overlayState?.hasHost && overlayState?.hasIframe) break;
        await sleep(500);
      }

      if (!overlayState?.hasHost) throw new Error("overlay host element not found");
      if (overlayState.hostCount !== 1) throw new Error(`expected one host, got ${overlayState.hostCount}`);
      if (!overlayState.hasIframe) throw new Error("overlay iframe not found in shadow root");
      if (!overlayState.iframeSrc?.startsWith("chrome-extension://")) {
        throw new Error(
          `iframe src did not start with chrome-extension://: ${overlayState.iframeSrc}`
        );
      }
      if (!overlayState.frameFocused) throw new Error("overlay iframe did not receive focus");

      results.push({ name: "overlay injects once and receives focus", ok: true });
    } catch (err) {
      results.push({
        name: "overlay injects once and receives focus",
        ok: false,
        error: (err as Error).message,
      });
    }

    /* ------------------ TEST 2: responsive theme/a11y matrix ----------------- */
    try {
      const visualTarget = await jsonNew(port, `chrome-extension://${extensionId}/popup/index.html?standalone=1`);
      if (!visualTarget.webSocketDebuggerUrl) throw new Error("visual target has no debugger URL");
      const visual = new CDP(visualTarget.webSocketDebuggerUrl);
      await visual.send("Runtime.enable");
      await visual.send("Page.enable");

      const qaDir = process.env.TABKNIGHT_QA_DIR;
      if (qaDir) await mkdir(qaDir, { recursive: true });
      const scenarios = [
        { name: "light-wide", width: 1040, height: 640, theme: "light" },
        { name: "dark-narrow", width: 640, height: 480, theme: "dark" },
      ];

      for (const scenario of scenarios) {
        await visual.send("Emulation.setDeviceMetricsOverride", {
          width: scenario.width,
          height: scenario.height,
          deviceScaleFactor: 1,
          mobile: false,
        });
        await visual.send("Emulation.setEmulatedMedia", {
          features: [{ name: "prefers-color-scheme", value: scenario.theme }],
        });
        const state = await waitFor(
          async () => {
            const observed = JSON.parse(
              await evaluate(
                visual,
                `(() => {
              const combo = document.querySelector('[role="combobox"]');
              const selected = document.querySelector('[role="option"][aria-selected="true"]');
              const audioControl = Array.from(document.querySelectorAll('button')).find((el) => el.textContent?.includes('Audio'));
              audioControl?.focus();
              const nativeEnter = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
              const controlsKeepNativeKeys = audioControl?.dispatchEvent(nativeEnter) ?? false;
              combo?.focus();
              return JSON.stringify({
                hasCombo: !!combo,
                controls: combo?.getAttribute('aria-controls'),
                activeDescendant: combo?.getAttribute('aria-activedescendant'),
                sourceLabels: Array.from(document.querySelectorAll('span')).some((el) => el.textContent?.trim() === 'Tab'),
                audioControl: !!audioControl,
                controlsKeepNativeKeys,
                commandHint: document.querySelector('input')?.getAttribute('placeholder')?.includes('Type > for commands') ?? false,
                selectedBackground: selected ? getComputedStyle(selected).backgroundColor : null,
                noHorizontalOverflow: document.documentElement.scrollWidth <= innerWidth,
                viewport: [innerWidth, innerHeight],
              });
            })()`
              )
            );
            return observed.hasCombo && observed.activeDescendant && observed.sourceLabels && observed.commandHint
              ? observed
              : null;
          },
          { timeoutMs: 5000, intervalMs: 100, label: `${scenario.name} populated overlay` }
        );
        if (!state.hasCombo || state.controls !== "tk-results" || !state.activeDescendant) {
          throw new Error(`${scenario.name}: combobox contract incomplete: ${JSON.stringify(state)}`);
        }
        if (
          !state.sourceLabels ||
          !state.audioControl ||
          !state.controlsKeepNativeKeys ||
          !state.commandHint ||
          !state.noHorizontalOverflow ||
          state.viewport[0] !== scenario.width ||
          state.viewport[1] !== scenario.height
        ) {
          throw new Error(`${scenario.name}: visual contract incomplete: ${JSON.stringify(state)}`);
        }
        if (qaDir) {
          const shot = await visual.send("Page.captureScreenshot", { format: "png", fromSurface: true });
          await Bun.write(join(qaDir, `${scenario.name}.png`), Buffer.from(shot.data, "base64"));
        }
      }
      await visual.send("Emulation.clearDeviceMetricsOverride");
      visual.close();
      await browser?.send("Target.closeTarget", { targetId: visualTarget.id });
      results.push({ name: "light/wide and dark/narrow visual contracts", ok: true });
    } catch (err) {
      results.push({
        name: "light/wide and dark/narrow visual contracts",
        ok: false,
        error: (err as Error).message,
      });
    }

    /* ------------- TEST 3: fresh top selection + shortcut target ------------ */
    try {
      const shortcutTargetId = await evaluate(
        sw,
        `(async () => {
          const tab = await chrome.tabs.create({ url: "https://example.net/", active: true });
          await chrome.storage.session.set({ previewSession: { mode: "audio", selectedTabId: ${seededTabId} } });
          return tab.id;
        })()`
      );
      await waitFor(
        async () =>
          evaluate(
            sw,
            `(async () => {
              const tab = await chrome.tabs.get(${shortcutTargetId});
              return tab.status === "complete";
            })()`
          ),
        { timeoutMs: 10000, intervalMs: 200, label: "shortcut target to finish loading" }
      );

      const shortcutTarget = await jsonNew(port, `chrome-extension://${extensionId}/popup/index.html?standalone=1`);
      if (!shortcutTarget.webSocketDebuggerUrl) throw new Error("shortcut target has no debugger URL");
      const shortcutCdp = new CDP(shortcutTarget.webSocketDebuggerUrl);
      await shortcutCdp.send("Runtime.enable");
      const initialState = await waitFor(
        async () => {
          const state = JSON.parse(
            await evaluate(
              shortcutCdp,
              `(() => {
                const input = document.querySelector('[role="combobox"]');
                const selected = document.querySelector('[role="option"][aria-selected="true"]');
                const list = document.getElementById('tk-results');
                input?.focus();
                return JSON.stringify({
                  selectedId: selected?.id ?? null,
                  scrollTop: list?.scrollTop ?? null,
                  focused: document.activeElement === input,
                });
              })()`
            )
          );
          return state.selectedId ? state : null;
        },
        { timeoutMs: 5000, intervalMs: 100, label: "fresh palette selection" }
      );
      if (initialState.selectedId !== `tk-result-tab-${shortcutTargetId}`) {
        throw new Error(`expected newest tab ${shortcutTargetId}, got ${initialState.selectedId}`);
      }
      if (initialState.scrollTop !== 0 || !initialState.focused) {
        throw new Error(`palette did not start at top and focused: ${JSON.stringify(initialState)}`);
      }

      await shortcutCdp.send("Input.dispatchKeyEvent", {
        type: "keyDown",
        key: "w",
        code: "KeyW",
        modifiers: 1,
      });
      await shortcutCdp.send("Input.dispatchKeyEvent", {
        type: "keyUp",
        key: "w",
        code: "KeyW",
        modifiers: 1,
      });
      await waitFor(
        async () =>
          evaluate(
            sw,
            `(async () => {
              try { await chrome.tabs.get(${shortcutTargetId}); return false; }
              catch { return true; }
            })()`
          ),
        { timeoutMs: 3000, intervalMs: 100, label: "Alt+W to close highlighted tab" }
      );
      shortcutCdp.close();
      results.push({ name: "fresh palette selects newest tab and Alt+W closes it", ok: true });
    } catch (err) {
      results.push({
        name: "fresh palette selects newest tab and Alt+W closes it",
        ok: false,
        error: (err as Error).message,
      });
    }

    /* ------------- TEST 4: native Split View handoff, no windows ------------ */
    try {
      const splitGuideSetup = JSON.parse(
        await evaluate(
          sw,
          `(async () => {
            const [origin] = await chrome.tabs.query({ url: "${testUrl}" });
            await chrome.tabs.update(origin.id, { active: true });
            const selected = await chrome.tabs.create({
              windowId: origin.windowId,
              url: "${testUrl}?native-split-selected=1",
              active: false,
            });
            const contextId = "preview-native-split-smoke";
            const paletteUrl = chrome.runtime.getURL("popup/index.html?standalone=1&context=" + contextId);
            await chrome.storage.local.set({
              [contextId]: {
                returnToTabId: origin.id,
                returnToWindowId: origin.windowId,
                createdAt: Date.now(),
              },
            });
            await chrome.tabs.create({ windowId: origin.windowId, url: paletteUrl, active: true });
            const windows = await chrome.windows.getAll();
            return JSON.stringify({
              originId: origin.id,
              selectedId: selected.id,
              paletteUrl,
              windowIds: windows.map((window) => window.id).sort(),
            });
          })()`
        )
      );
      const splitGuideTarget = await waitFor(
        async () => {
          const list = await jsonList(port);
          return list.find((target) => target.type === "page" && target.url === splitGuideSetup.paletteUrl);
        },
        { timeoutMs: 5000, intervalMs: 100, label: "native Split View guide palette" }
      );
      if (!splitGuideTarget.webSocketDebuggerUrl) throw new Error("split guide target has no debugger URL");
      const splitGuideCdp = new CDP(splitGuideTarget.webSocketDebuggerUrl);
      await splitGuideCdp.send("Runtime.enable");
      const selectedState = await waitFor(
        async () => {
          const state = JSON.parse(
            await evaluate(
              splitGuideCdp,
              `(() => {
                const input = document.querySelector('[role="combobox"]');
                const selected = document.querySelector('[role="option"][aria-selected="true"]');
                input?.focus();
                return JSON.stringify({ selectedId: selected?.id ?? null, focused: document.activeElement === input });
              })()`
            )
          );
          return state.selectedId ? state : null;
        },
        { timeoutMs: 5000, intervalMs: 100, label: "native Split View selected row" }
      );
      if (selectedState.selectedId !== `tk-result-tab-${splitGuideSetup.selectedId}` || !selectedState.focused) {
        throw new Error(`wrong Split View guide target: ${JSON.stringify(selectedState)}`);
      }

      await splitGuideCdp.send("Input.dispatchKeyEvent", {
        type: "keyDown",
        key: "/",
        code: "Backslash",
        modifiers: 5,
      });
      await splitGuideCdp.send("Input.dispatchKeyEvent", {
        type: "keyUp",
        key: "/",
        code: "Backslash",
        modifiers: 5,
      });

      await waitFor(
        async () => {
          const list = await jsonList(port);
          return !list.some((target) => target.id === splitGuideTarget.id);
        },
        { timeoutMs: 3000, intervalMs: 100, label: "Split View guide palette to close" }
      );
      const hintText = await waitFor(
        async () => {
          const text = await evaluate(
            page,
            `document.getElementById("tabknight-split-view-hint")?.shadowRoot?.textContent ?? ""`
          );
          return text.includes("⌘⌥N") ? text : null;
        },
        { timeoutMs: 3000, intervalMs: 100, label: "native Split View instruction" }
      );
      const unchanged = JSON.parse(
        await evaluate(
          sw,
          `(async () => {
            const [origin, selected, windows] = await Promise.all([
              chrome.tabs.get(${splitGuideSetup.originId}),
              chrome.tabs.get(${splitGuideSetup.selectedId}),
              chrome.windows.getAll(),
            ]);
            return JSON.stringify({
              sameWindow: origin.windowId === selected.windowId,
              windowIds: windows.map((window) => window.id).sort(),
            });
          })()`
        )
      );
      if (!hintText.includes("Chrome Split View") || !unchanged.sameWindow) {
        throw new Error(`native Split View handoff incomplete: ${JSON.stringify({ hintText, unchanged })}`);
      }
      if (JSON.stringify(unchanged.windowIds) !== JSON.stringify(splitGuideSetup.windowIds)) {
        throw new Error(`Split View guide changed browser windows: ${JSON.stringify(unchanged)}`);
      }
      splitGuideCdp.close();
      results.push({ name: "Cmd+Option+\\ guides native Split View without changing windows", ok: true });
    } catch (err) {
      results.push({
        name: "Cmd+Option+\\ guides native Split View without changing windows",
        ok: false,
        error: (err as Error).message,
      });
    }

    /* -------------------- TEST 5: forged lifecycle ignored -------------------- */
    try {
      await evaluate(
        page,
        `window.postMessage({ source: "tabknight-preview", type: "close", invocationId: "forged" }, "*")`
      );
      await sleep(250);
      const stillOpen = await evaluate(page, `!!document.getElementById("tabknight-preview-host")`);
      if (!stillOpen) throw new Error("host page spoofed an overlay close message");
      results.push({ name: "forged host-page lifecycle message is ignored", ok: true });
    } catch (err) {
      results.push({
        name: "forged host-page lifecycle message is ignored",
        ok: false,
        error: (err as Error).message,
      });
    }

    /* ------------------- TEST 3: popup + standalone sizing -------------------- */
    try {
      const popupTarget = await jsonNew(port, `chrome-extension://${extensionId}/popup/index.html`);
      if (!popupTarget.webSocketDebuggerUrl) throw new Error("popup target has no debugger URL");
      const popup = new CDP(popupTarget.webSocketDebuggerUrl);
      await popup.send("Runtime.enable");
      await sleep(500);
      const popupSize = JSON.parse(
        await evaluate(
          popup,
          `(() => { const el = document.getElementById('root')?.firstElementChild; const r = el?.getBoundingClientRect(); return JSON.stringify([r?.width, r?.height]); })()`
        )
      );
      if (popupSize[0] !== 400 || popupSize[1] !== 500) throw new Error(`popup measured ${popupSize}`);
      popup.close();
      await browser?.send("Target.closeTarget", { targetId: popupTarget.id });

      const standaloneTarget = await jsonNew(port, `chrome-extension://${extensionId}/popup/index.html?standalone=1`);
      if (!standaloneTarget.webSocketDebuggerUrl) throw new Error("standalone target has no debugger URL");
      const standalone = new CDP(standaloneTarget.webSocketDebuggerUrl);
      await standalone.send("Runtime.enable");
      await standalone.send("Emulation.setDeviceMetricsOverride", { width: 640, height: 480, deviceScaleFactor: 1, mobile: false });
      await sleep(500);
      const standaloneState = JSON.parse(
        await evaluate(
          standalone,
          `(() => { const panel = document.querySelector('.tk-preview'); const r = panel?.getBoundingClientRect(); return JSON.stringify({ panel: !!panel, width: r?.width, height: r?.height, noOverflow: document.documentElement.scrollWidth <= innerWidth && document.documentElement.scrollHeight <= innerHeight }); })()`
        )
      );
      if (!standaloneState.panel || !standaloneState.noOverflow || standaloneState.width > 640 || standaloneState.height > 480) {
        throw new Error(`standalone sizing failed: ${JSON.stringify(standaloneState)}`);
      }
      standalone.close();
      await browser?.send("Target.closeTarget", { targetId: standaloneTarget.id });
      results.push({ name: "400x500 popup and 640x480 standalone sizing", ok: true });
    } catch (err) {
      results.push({ name: "400x500 popup and 640x480 standalone sizing", ok: false, error: (err as Error).message });
    }

    /* -------------------- TEST 2: universal intent results -------------------- */
    try {
      await evaluate(page, `document.title = "Example source"`);
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
        `document.getElementById("root")?.children.length > 0
          && !!document.querySelector('input[name="preview-text"][value="always-show"]:checked')
          && !!document.querySelector('input[name="accent"][value="zinc"]:checked')
          && document.documentElement.dataset.accent === "zinc"`
      );
      if (!mounted) throw new Error("options page did not mount with rich previews and zinc accent defaults");
      results.push({ name: "options page loads with zinc accent default", ok: true });
      optionsCdp.close();
      await browser?.send("Target.closeTarget", { targetId: target.id });
    } catch (err) {
      results.push({
        name: "options page loads with zinc accent default",
        ok: false,
        error: (err as Error).message,
      });
    }

    /* ------------------------- TEST 7: overlay closes ------------------------- */
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

    /* -------------------- TEST 5: fallback restores origin -------------------- */
    try {
      const fallbackSetup = JSON.parse(
        await evaluate(
          sw,
          `(async () => {
            const [origin] = await chrome.tabs.query({ url: "${testUrl}" });
            const contextId = "preview-smoke-" + crypto.randomUUID();
            await chrome.storage.local.set({
              [contextId]: {
                returnToTabId: origin.id,
                returnToWindowId: origin.windowId,
                createdAt: Date.now(),
                cause: "restricted-url",
                elapsedMs: 12,
              },
            });
            await chrome.storage.session.set({ previewSession: { mode: "tabs", selectedTabId: origin.id } });
            const fallback = await chrome.tabs.create({
              active: true,
              windowId: origin.windowId,
              index: origin.index + 1,
              url: chrome.runtime.getURL("popup/index.html?standalone=1&context=" + contextId),
            });
            return JSON.stringify({ contextId, originId: origin.id });
          })()`
        )
      ) as { contextId: string; originId: number };

      const fallbackTarget = await waitFor(
        async () =>
          (await jsonList(port)).find(
            (target) => target.type === "page" && target.url.includes(fallbackSetup.contextId)
          ),
        { timeoutMs: 5000, intervalMs: 200, label: "standalone fallback target" }
      );
      if (!fallbackTarget.webSocketDebuggerUrl) throw new Error("fallback target has no debugger URL");
      const fallbackPage = new CDP(fallbackTarget.webSocketDebuggerUrl);
      await fallbackPage.send("Runtime.enable");
      await waitFor(
        async () =>
          evaluate(
            fallbackPage,
            `document.body.innerText.includes("Chrome protects this page") && document.activeElement?.tagName === "INPUT"`
          ),
        { timeoutMs: 5000, intervalMs: 200, label: "fallback explanation and focused search" }
      );

      await fallbackPage.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape" });
      await fallbackPage.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape" });

      await waitFor(
        async () => !(await jsonList(port)).some((target) => target.id === fallbackTarget.id),
        { timeoutMs: 5000, intervalMs: 200, label: "fallback tab to close on Escape" }
      );
      const restored = JSON.parse(
        await evaluate(
          sw,
          `(async () => {
            const origin = await chrome.tabs.get(${fallbackSetup.originId});
            const stored = await chrome.storage.local.get("${fallbackSetup.contextId}");
            return JSON.stringify({ active: origin.active, contextRemoved: !stored["${fallbackSetup.contextId}"] });
          })()`
        )
      ) as { active: boolean; contextRemoved: boolean };
      if (!restored.active) throw new Error("origin tab was not restored");
      if (!restored.contextRemoved) throw new Error("standalone context was not torn down");
      fallbackPage.close();
      results.push({ name: "fallback explains, focuses, and Escape restores origin", ok: true });
    } catch (err) {
      results.push({
        name: "fallback explains, focuses, and Escape restores origin",
        ok: false,
        error: (err as Error).message,
      });
    }

    sw.close();
    page.close();
  } catch (err) {
    console.error(`Smoke test setup failed: ${(err as Error).message}`);
  } finally {
    testServer.stop(true);
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

  const allPassed = results.length === 10 && results.every((r) => r.ok);
  return allPassed ? 0 : 1;
}

const exitCode = await main();
process.exit(exitCode);
