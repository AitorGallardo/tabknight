import { watch } from "fs";
import { cp, rm, mkdir } from "fs/promises";
import { join } from "path";

const isWatch = process.argv.includes("--watch");
const rootDir = join(import.meta.dir, "..");
const srcDir = join(rootDir, "src");
const publicDir = join(rootDir, "public");
const distDir = join(rootDir, "dist");

async function build() {
  console.log("Building...");

  // Clean dist
  await rm(distDir, { recursive: true, force: true });
  await mkdir(distDir, { recursive: true });

  // Copy public files
  await cp(publicDir, distDir, { recursive: true });

  // Build popup
  const popupResult = await Bun.build({
    entrypoints: [join(srcDir, "popup/index.tsx")],
    outdir: join(distDir, "popup"),
    target: "browser",
    format: "esm",
    splitting: false,
    minify: !isWatch,
    sourcemap: isWatch ? "inline" : "none",
  });

  if (!popupResult.success) {
    console.error("Popup build failed:", popupResult.logs);
    process.exit(1);
  }

  // Build background service worker
  const bgResult = await Bun.build({
    entrypoints: [join(srcDir, "background/index.ts")],
    outdir: distDir,
    target: "browser",
    format: "esm",
    splitting: false,
    minify: !isWatch,
    sourcemap: isWatch ? "inline" : "none",
  });

  if (!bgResult.success) {
    console.error("Background build failed:", bgResult.logs);
    process.exit(1);
  }

  // Build content script
  const contentResult = await Bun.build({
    entrypoints: [join(srcDir, "content/index.ts")],
    outdir: join(distDir, "content"),
    target: "browser",
    format: "esm",
    splitting: false,
    minify: !isWatch,
    sourcemap: isWatch ? "inline" : "none",
  });

  if (!contentResult.success) {
    console.error("Content script build failed:", contentResult.logs);
    process.exit(1);
  }

  // Copy popup HTML
  await cp(join(srcDir, "popup/index.html"), join(distDir, "popup/index.html"));

  // Build CSS with Tailwind
  const cssInput = join(srcDir, "popup/styles/globals.css");
  const cssOutput = join(distDir, "popup/styles.css");

  const proc = Bun.spawn(
    ["bunx", "tailwindcss", "-i", cssInput, "-o", cssOutput, ...(isWatch ? [] : ["--minify"])],
    { cwd: rootDir, stdout: "inherit", stderr: "inherit" }
  );
  await proc.exited;

  console.log("Build complete!");
}

await build();

if (isWatch) {
  console.log("Watching for changes...");

  const watcher = watch(srcDir, { recursive: true }, async (event, filename) => {
    if (filename && !filename.includes("node_modules")) {
      console.log(`\nFile changed: ${filename}`);
      try {
        await build();
      } catch (e) {
        console.error("Build error:", e);
      }
    }
  });

  process.on("SIGINT", () => {
    watcher.close();
    process.exit(0);
  });
}
