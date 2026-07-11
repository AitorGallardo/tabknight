#!/usr/bin/env bun
/**
 * Package the built extension for the Chrome Web Store.
 *
 * Runs a fresh production build, then zips the CONTENTS of dist/ (manifest.json
 * at the zip root, as the store requires) into release/tabknight-v<version>.zip.
 *
 * Usage: bun run package
 */

import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";

const rootDir = new URL("..", import.meta.url).pathname;
const distDir = join(rootDir, "dist");
const releaseDir = join(rootDir, "release");

async function run(cmd: string[], cwd: string): Promise<void> {
  const proc = Bun.spawn(cmd, { cwd, stdout: "inherit", stderr: "inherit" });
  const code = await proc.exited;
  if (code !== 0) {
    console.error(`Command failed (${code}): ${cmd.join(" ")}`);
    process.exit(1);
  }
}

// Fresh production build
await run(["bun", "run", "build"], rootDir);

// Read the shipped version from the built manifest
const manifest = JSON.parse(await Bun.file(join(distDir, "manifest.json")).text());
const version: string | undefined = manifest?.version;
if (!version) {
  console.error("dist/manifest.json has no version");
  process.exit(1);
}

await mkdir(releaseDir, { recursive: true });
const zipPath = join(releaseDir, `tabknight-v${version}.zip`);
await rm(zipPath, { force: true });

// Zip the contents of dist/ (cwd = dist) so manifest.json sits at the zip root.
await run(["zip", "-r", zipPath, ".", "-x", ".DS_Store", "-x", "*/.DS_Store"], distDir);

const size = Bun.file(zipPath).size;
console.log("");
console.log(`Packaged: ${zipPath} (${(size / 1024).toFixed(0)} KB)`);
console.log("");
await run(["unzip", "-l", zipPath], rootDir);
