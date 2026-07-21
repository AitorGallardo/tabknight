#!/usr/bin/env bun
import { executeBrowserCommand } from "../src/popup/lib/browser-command-executor";
import { findBrowserCommands } from "../src/popup/lib/browser-commands";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const regular = { id: 7, title: "Example", pinned: false, muted: false };
const pinnedMuted = { ...regular, pinned: true, muted: true };

assert(findBrowserCommands("", { targetTab: regular }).length === 0, "Empty search must stay tab-only");
assert(findBrowserCommands("close", { targetTab: regular })[0]?.id === "close-tab", "Close must be discoverable");
for (const [query, id] of [
  ["close tab", "close-tab"],
  ["duplicate tab", "duplicate-tab"],
  ["pin tab", "pin-tab"],
  ["mute tab", "mute-tab"],
  ["reload tab", "reload-tab"],
  ["new tab", "new-tab"],
] as const) {
  assert(findBrowserCommands(query, { targetTab: regular })[0]?.id === id, `${query} must find ${id}`);
}
assert(findBrowserCommands("pin", { targetTab: regular }).some(({ id }) => id === "pin-tab"), "Pin must be available");
assert(!findBrowserCommands("pin", { targetTab: pinnedMuted }).some(({ id }) => id === "pin-tab"), "Pin must hide when pinned");
assert(findBrowserCommands("unpin", { targetTab: pinnedMuted })[0]?.id === "unpin-tab", "Unpin must replace pin");
assert(findBrowserCommands("mute", { targetTab: pinnedMuted })[0]?.id === "unmute-tab", "Unmute must replace mute");
assert(findBrowserCommands("new tab", { targetTab: null })[0]?.id === "new-tab", "New tab must work without context");
assert(findBrowserCommands("reload", { targetTab: null }).length === 0, "Target commands must hide without context");

const calls: string[] = [];
const api = {
  remove: async (id: number) => void calls.push(`remove:${id}`),
  duplicate: async (id: number) => void calls.push(`duplicate:${id}`),
  update: async (id: number, props: { pinned?: boolean; muted?: boolean }) => void calls.push(`update:${id}:${JSON.stringify(props)}`),
  reload: async (id: number) => void calls.push(`reload:${id}`),
  create: async ({ url }: { url: string; active: boolean }) => void calls.push(`create:${url}`),
};

await executeBrowserCommand("duplicate-tab", regular, api);
await executeBrowserCommand("pin-tab", regular, api);
await executeBrowserCommand("mute-tab", regular, api);
await executeBrowserCommand("reload-tab", regular, api);
await executeBrowserCommand("new-tab", null, api);
await executeBrowserCommand("unpin-tab", pinnedMuted, api);
await executeBrowserCommand("unmute-tab", pinnedMuted, api);
await executeBrowserCommand("close-tab", regular, api);
assert(calls.join("|") === 'duplicate:7|update:7:{"pinned":true}|update:7:{"muted":true}|reload:7|create:chrome://newtab/|update:7:{"pinned":false}|update:7:{"muted":false}|remove:7', "Execution must route exactly once");

let rejected = false;
try {
  await executeBrowserCommand("close-tab", null, api);
} catch {
  rejected = true;
}
assert(rejected, "Missing targets must fail safely");

console.log("✓ browser command matching and execution routing");
