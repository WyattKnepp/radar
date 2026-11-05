// Draws the radar/dial app icon and writes PNGs to public/icons/.
// No dependencies: rasterizes with 4x4 supersampling and encodes PNG by hand.
// Run: npm run icons
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');

const BG = [4, 8, 10];
const GREEN = [61, 255, 154];
const WHITE = [234, 255, 244];

// Color of one point in unit coordinates (0..1), as [r, g, b] or null for bg.
function shade(x, y) {
  const cx = 0.5, cy = 0.62;
  const dx = x - cx, dy = y - cy;
  const r = Math.hypot(dx, dy);
  const ang = Math.atan2(dx, -dy); // 0 = up, + = right

  // Needle leaning right.
  const na = 0.55;
  const ux = Math.sin(na), uy = -Math.cos(na);
  const along = dx * ux + dy * uy;
  const perp = Math.abs(dx * uy - dy * ux);
  if (along > -0.04 && along < 0.36 && perp < 0.018) return WHITE;
  if (r < 0.045) return GREEN;

  if (dy <= 0.005) {
    // Outer arc and inner rings of the upper half.
    if (Math.abs(r - 0.4) < 0.02) return GREEN;
    if (Math.abs(r - 0.28) < 0.008 || Math.abs(r - 0.16) < 0.008) return mix(BG, GREEN, 0.45);
    // Ticks.
    for (let a = -80; a <= 80; a += 20) {
      if (a === 0) continue;
      const t = (a * Math.PI) / 180;
      if (Math.abs(ang - t) < 0.022 && r > 0.33 && r < 0.38) return mix(BG, GREEN, 0.8);
    }
    // Sweep wedge trailing the needle.
    if (r < 0.39 && ang < na && ang > na - 0.9) {
      return mix(BG, GREEN, 0.28 * (1 - (na - ang) / 0.9));
    }
  }
  // Baseline.
  if (Math.abs(dy) < 0.01 && Math.abs(dx) < 0.42) return mix(BG, GREEN, 0.6);
  return null;
}

const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);

function render(size) {
  const ss = 4;
  const px = Buffer.alloc(size * (size * 3 + 1));
  for (let y = 0; y < size; y++) {
    px[y * (size * 3 + 1)] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      const acc = [0, 0, 0];
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const ux = (x + (sx + 0.5) / ss) / size;
          const uy = (y + (sy + 0.5) / ss) / size;
          // Soft green glow toward the dial center.
          const glow = Math.max(0, 0.14 - Math.hypot(ux - 0.5, uy - 0.55) * 0.22);
          const c = shade(ux, uy) || mix(BG, GREEN, glow);
          for (let i = 0; i < 3; i++) acc[i] += c[i];
        }
      }
      const o = y * (size * 3 + 1) + 1 + x * 3;
      for (let i = 0; i < 3; i++) px[o + i] = Math.round(acc[i] / (ss * ss));
    }
  }
  return png(size, size, px);
}

function png(w, h, raw) {
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // truecolor RGB
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

mkdirSync(OUT, { recursive: true });
for (const [name, size] of [['apple-touch-icon.png', 180], ['icon-192.png', 192], ['icon-512.png', 512]]) {
  writeFileSync(path.join(OUT, name), render(size));
  console.log(`wrote public/icons/${name}`);
}
