// Script to generate placeholder icons for the extension
// Run with: bun run scripts/generate-icons.ts

import { writeFile, mkdir } from "fs/promises";
import { join } from "path";

const sizes = [16, 32, 48, 128];
const iconsDir = join(import.meta.dir, "../public/icons");

// Generate a simple SVG icon
function generateSvg(size: number): string {
  const padding = Math.floor(size * 0.1);
  const iconSize = size - padding * 2;
  const cornerRadius = Math.floor(size * 0.15);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect x="${padding}" y="${padding}" width="${iconSize}" height="${iconSize}" rx="${cornerRadius}" fill="#52525b"/>
  <rect x="${padding + iconSize * 0.2}" y="${padding + iconSize * 0.2}" width="${iconSize * 0.6}" height="${iconSize * 0.15}" rx="${cornerRadius * 0.3}" fill="white"/>
  <rect x="${padding + iconSize * 0.2}" y="${padding + iconSize * 0.45}" width="${iconSize * 0.6}" height="${iconSize * 0.15}" rx="${cornerRadius * 0.3}" fill="white" opacity="0.7"/>
  <rect x="${padding + iconSize * 0.2}" y="${padding + iconSize * 0.7}" width="${iconSize * 0.4}" height="${iconSize * 0.15}" rx="${cornerRadius * 0.3}" fill="white" opacity="0.4"/>
</svg>`;
}

async function main() {
  await mkdir(iconsDir, { recursive: true });

  for (const size of sizes) {
    const svg = generateSvg(size);
    const filename = `icon${size}.svg`;
    await writeFile(join(iconsDir, filename), svg);
    console.log(`Generated ${filename}`);
  }

  console.log("\nNote: For production, convert SVG to PNG using a tool like:");
  console.log("  - Inkscape: inkscape -w 128 -h 128 icon128.svg -o icon128.png");
  console.log("  - ImageMagick: convert -background none icon128.svg icon128.png");
  console.log("\nOr use an online converter.");
}

main().catch(console.error);
