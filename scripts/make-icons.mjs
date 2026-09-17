// Draws the PNG app icons (the bolt from public/icon.svg) with no image library.
import { crc32, deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';

const BG = [15, 23, 42];
const FG = [250, 204, 21];
// The bolt in a unit square, the same shape as icon.svg.
const BOLT = [[0.58, 0.08], [0.24, 0.56], [0.47, 0.56], [0.4, 0.92], [0.76, 0.42], [0.53, 0.42]];

function inPolygon(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function inRoundedSquare(u, v, r) {
  const dx = Math.max(r - u, 0, u - (1 - r));
  const dy = Math.max(r - v, 0, v - (1 - r));
  return dx * dx + dy * dy <= r * r;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

// Maskable icons keep the bolt inside the central safe zone and fill the whole square.
function png(size, maskable) {
  const scale = maskable ? 0.6 : 0.8;
  const offset = (1 - scale) / 2;
  const stride = size * 4 + 1;
  const raw = Buffer.alloc(stride * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = (x + 0.5) / size;
      const v = (y + 0.5) / size;
      const bolt = inPolygon((u - offset) / scale, (v - offset) / scale, BOLT);
      const [r, g, b] = bolt ? FG : BG;
      const o = y * stride + 1 + x * 4;
      raw[o] = r;
      raw[o + 1] = g;
      raw[o + 2] = b;
      raw[o + 3] = maskable || inRoundedSquare(u, v, 0.18) ? 255 : 0;
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

writeFileSync('public/icon-192.png', png(192, false));
writeFileSync('public/icon-512.png', png(512, false));
writeFileSync('public/icon-maskable-512.png', png(512, true));
console.log('Icons written to public/');
