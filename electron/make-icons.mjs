// Generates the ShowOnce desktop icons from code: a Meta-blue rounded
// square with a white watch-once mark (ring + play triangle). No image
// tools needed for the PNG and ICO outputs; the macOS ICNS is converted
// from icon.png with iconutil (see README packaging notes).
//
// Usage: node electron/make-icons.mjs [--size N] [--png out.png] [--ico out.ico]
// Defaults: electron/icon.png (512) and electron/icon.ico (256 PNG payload).

import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";
import path from "node:path";

const META_BLUE = [0, 130, 251];
const WHITE = [255, 255, 255];

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const out = Buffer.alloc(8 + data.length + 4);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "ascii");
  data.copy(out, 8);
  out.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, "ascii"), data])), 8 + data.length);
  return out;
}

function render(size) {
  const px = Buffer.alloc(size * size * 4);
  const c = size / 2;
  const radius = size * 0.22; // rounded-square corner radius
  const half = size * 0.5;
  const ringR = size * 0.24;
  const ringW = size * 0.055;
  // Play triangle, pointing right, centered.
  const ax = c - size * 0.09;
  const bx = c + size * 0.14;
  const hh = size * 0.15;
  const inTriangle = (x, y) => {
    if (x < ax || x > bx) return false;
    const t = (x - ax) / (bx - ax);
    return Math.abs(y - c) <= hh * (1 - t) + ringW * 0.3;
  };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // Rounded square: distance outside the inner box.
      const dx = Math.max(Math.abs(x + 0.5 - c) - (half - radius), 0);
      const dy = Math.max(Math.abs(y + 0.5 - c) - (half - radius), 0);
      if (Math.hypot(dx, dy) > radius) continue; // transparent corner
      const dist = Math.hypot(x + 0.5 - c, y + 0.5 - c);
      const white = Math.abs(dist - ringR) <= ringW / 2 || inTriangle(x + 0.5, y + 0.5);
      const [r, g, b] = white ? WHITE : META_BLUE;
      const i = (y * size + x) * 4;
      px[i] = r;
      px[i + 1] = g;
      px[i + 2] = b;
      px[i + 3] = 255;
    }
  }
  const raw = Buffer.alloc(size * (1 + size * 4));
  for (let y = 0; y < size; y++) {
    raw[y * (1 + size * 4)] = 0; // filter: none
    px.copy(raw, y * (1 + size * 4) + 1, y * size * 4, (y + 1) * size * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ICO with a PNG-compressed entry (Vista+): header + one 256x256 image.
function icoFromPng(png256) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(1, 4); // one image
  const entry = Buffer.alloc(16);
  entry[0] = 0; // width 0 means 256
  entry[1] = 0; // height 0 means 256
  entry[2] = 0; // no palette
  entry[3] = 0; // reserved
  entry.writeUInt16LE(1, 4); // color planes
  entry.writeUInt16LE(32, 6); // bits per pixel
  entry.writeUInt32LE(png256.length, 8); // payload size
  entry.writeUInt32LE(6 + 16, 12); // payload offset
  return Buffer.concat([header, entry, png256]);
}

const args = process.argv.slice(2);
const pngOut = args[args.indexOf("--png") + 1] ?? path.join("electron", "icon.png");
const icoOut = args[args.indexOf("--ico") + 1] ?? path.join("electron", "icon.ico");
const sizeArg = Number(args[args.indexOf("--size") + 1]);
const pngSize = Number.isInteger(sizeArg) && sizeArg > 0 ? sizeArg : 512;

writeFileSync(pngOut, render(pngSize));
writeFileSync(icoOut, icoFromPng(render(256)));
console.log(`icons: ${pngOut} (${pngSize}x${pngSize} PNG), ${icoOut} (256 PNG-in-ICO)`);
