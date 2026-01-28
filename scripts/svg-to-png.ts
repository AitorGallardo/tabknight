// Convert SVG icons to PNG
// This script creates placeholder PNG files for development
// For production, use proper image conversion tools

import { writeFile, readFile, mkdir } from "fs/promises";
import { join } from "path";

const sizes = [16, 32, 48, 128];
const iconsDir = join(import.meta.dir, "../public/icons");

// Minimal valid PNG (1x1 purple pixel) as base64 - used as fallback
const minimalPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwADhgH/E0eNlAAAAABJRU5ErkJggg==",
  "base64"
);

// Create a simple colored PNG programmatically
function createColoredPng(size: number): Buffer {
  // PNG file structure
  const width = size;
  const height = size;

  // PNG signature
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  // IHDR chunk
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8; // bit depth
  ihdrData[9] = 2; // color type (RGB)
  ihdrData[10] = 0; // compression
  ihdrData[11] = 0; // filter
  ihdrData[12] = 0; // interlace

  const ihdrChunk = createChunk("IHDR", ihdrData);

  // Create raw pixel data (RGB - indigo color #6366f1)
  const r = 0x63,
    g = 0x66,
    b = 0xf1;
  const rowSize = 1 + width * 3; // filter byte + RGB pixels
  const rawData = Buffer.alloc(height * rowSize);

  for (let y = 0; y < height; y++) {
    const rowStart = y * rowSize;
    rawData[rowStart] = 0; // filter type (none)
    for (let x = 0; x < width; x++) {
      const px = rowStart + 1 + x * 3;
      rawData[px] = r;
      rawData[px + 1] = g;
      rawData[px + 2] = b;
    }
  }

  // Compress with zlib
  const compressed = Bun.deflateSync(rawData);
  const idatChunk = createChunk("IDAT", Buffer.from(compressed));

  // IEND chunk
  const iendChunk = createChunk("IEND", Buffer.alloc(0));

  return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
}

function createChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);

  const typeBuffer = Buffer.from(type, "ascii");
  const crcData = Buffer.concat([typeBuffer, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(crcData), 0);

  return Buffer.concat([length, typeBuffer, data, crc]);
}

// CRC32 implementation for PNG
function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  const table = makeCrcTable();

  for (let i = 0; i < data.length; i++) {
    crc = (crc >>> 8) ^ table[(crc ^ data[i]) & 0xff];
  }

  return (crc ^ 0xffffffff) >>> 0;
}

function makeCrcTable(): number[] {
  const table: number[] = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c;
  }
  return table;
}

async function main() {
  await mkdir(iconsDir, { recursive: true });

  for (const size of sizes) {
    const png = createColoredPng(size);
    const filename = `icon${size}.png`;
    await writeFile(join(iconsDir, filename), png);
    console.log(`Generated ${filename} (${size}x${size})`);
  }

  console.log("\nPlaceholder icons generated!");
  console.log("For production, replace with properly designed icons.");
}

main().catch(console.error);
