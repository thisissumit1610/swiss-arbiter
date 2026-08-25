/**
 * Generate the app icons.
 *
 * Written as pixels rather than pulled from an image library so the repository
 * has no binary blobs whose provenance nobody can check, and so the icon can be
 * regenerated at any size with `node scripts/make-icons.mjs`.
 *
 * The mark is a 4×4 chequer on a deep blue field — legible at 16px in a browser
 * tab, which a piece silhouette is not.
 */

import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const publicDir = join(here, '..', 'public');

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function encodePng(width, height, rgba) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // truecolour with alpha
  header[10] = 0;
  header[11] = 0;
  header[12] = 0;

  // Each scanline is prefixed with its filter type; 0 means "no filter".
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const NAVY = [17, 32, 66, 255];
const LIGHT = [240, 243, 248, 255];
const ACCENT = [79, 133, 232, 255];

function drawIcon(size, { maskable = false } = {}) {
  const rgba = Buffer.alloc(size * size * 4);
  // Maskable icons must survive being cropped to a circle, so the artwork sits
  // inside the middle 80% and the field runs to the edges.
  const inset = maskable ? size * 0.22 : size * 0.17;
  const radius = maskable ? 0 : size * 0.22;
  const board = size - inset * 2;
  const cell = board / 4;

  const put = (x, y, colour) => {
    const i = (y * size + x) * 4;
    rgba[i] = colour[0];
    rgba[i + 1] = colour[1];
    rgba[i + 2] = colour[2];
    rgba[i + 3] = colour[3];
  };

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // Rounded-square field.
      if (radius > 0 && outsideRoundedSquare(x, y, size, radius)) {
        put(x, y, [0, 0, 0, 0]);
        continue;
      }
      put(x, y, NAVY);

      const bx = x - inset;
      const by = y - inset;
      if (bx < 0 || by < 0 || bx >= board || by >= board) continue;

      const col = Math.floor(bx / cell);
      const row = Math.floor(by / cell);
      if ((col + row) % 2 === 0) {
        // The top-left light square is picked out in the accent colour, which
        // reads as "board 1" and stops the mark looking like a plain chequer.
        put(x, y, col === 0 && row === 0 ? ACCENT : LIGHT);
      }
    }
  }
  return rgba;
}

function outsideRoundedSquare(x, y, size, radius) {
  const corners = [
    [radius, radius],
    [size - radius, radius],
    [radius, size - radius],
    [size - radius, size - radius],
  ];
  const nearLeft = x < radius;
  const nearRight = x >= size - radius;
  const nearTop = y < radius;
  const nearBottom = y >= size - radius;
  if (!((nearLeft || nearRight) && (nearTop || nearBottom))) return false;

  const [cx, cy] = corners[(nearBottom ? 2 : 0) + (nearRight ? 1 : 0)];
  const dx = x + 0.5 - cx;
  const dy = y + 0.5 - cy;
  return dx * dx + dy * dy > radius * radius;
}

mkdirSync(publicDir, { recursive: true });

for (const [name, size, options] of [
  ['icon-192.png', 192, {}],
  ['icon-512.png', 512, {}],
  ['icon-180.png', 180, {}],
  ['icon-maskable.png', 512, { maskable: true }],
]) {
  const png = encodePng(size, size, drawIcon(size, options));
  writeFileSync(join(publicDir, name), png);
  console.log(`wrote ${name} (${size}×${size}, ${png.length} bytes)`);
}

// The SVG is what browsers actually use for the tab; it stays crisp at 16px.
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img" aria-label="Swiss Arbiter">
  <rect width="64" height="64" rx="14" fill="#112042"/>
  <g>
    <rect x="11" y="11" width="10.5" height="10.5" fill="#4f85e8"/>
    <rect x="32" y="11" width="10.5" height="10.5" fill="#f0f3f8"/>
    <rect x="21.5" y="21.5" width="10.5" height="10.5" fill="#f0f3f8"/>
    <rect x="42.5" y="21.5" width="10.5" height="10.5" fill="#f0f3f8"/>
    <rect x="11" y="32" width="10.5" height="10.5" fill="#f0f3f8"/>
    <rect x="32" y="32" width="10.5" height="10.5" fill="#f0f3f8"/>
    <rect x="21.5" y="42.5" width="10.5" height="10.5" fill="#f0f3f8"/>
    <rect x="42.5" y="42.5" width="10.5" height="10.5" fill="#f0f3f8"/>
  </g>
</svg>
`;
writeFileSync(join(publicDir, 'icon.svg'), svg);
console.log('wrote icon.svg');
