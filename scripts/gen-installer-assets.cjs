/**
 * Generates mode-specific app icons and installer artwork.
 * from logo/logo.png using the supplied aptPOS mark and brand palette.
 * Run: node scripts/gen-installer-assets.cjs
 */
'use strict';

const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const LOGO = path.join(ROOT, 'logo', 'logo.png');
const OUT  = path.join(ROOT, 'build-resources');

const BG_DARK    = { r: 255, g: 255, b: 255 };
const BG_CARD    = { r: 234, g: 247, b: 255 };
const BLUE       = { r: 10,  g: 75,  b: 217 }; // #0A4BD9
const INDIGO     = { r: 0,   g: 180, b: 255 }; // #00B4FF
const ORANGE     = { r: 255, g: 138, b: 0 }; // #FF8A00

// ── BMP writer ────────────────────────────────────────────────────────────────

function writeBmp(filePath, width, height, rgbBuf) {
  const rowSize = Math.ceil((width * 3) / 4) * 4;
  const pixelDataSize = rowSize * height;
  const fileSize = 54 + pixelDataSize;
  const buf = Buffer.alloc(fileSize, 0);

  buf.write('BM', 0, 'ascii');
  buf.writeUInt32LE(fileSize, 2);
  buf.writeUInt32LE(54, 10);
  buf.writeUInt32LE(40, 14);
  buf.writeInt32LE(width, 18);
  buf.writeInt32LE(-height, 22); // negative = top-down
  buf.writeUInt16LE(1, 26);
  buf.writeUInt16LE(24, 28);
  buf.writeUInt32LE(0, 30);
  buf.writeUInt32LE(pixelDataSize, 34);
  buf.writeInt32LE(2835, 38);
  buf.writeInt32LE(2835, 42);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const src = (y * width + x) * 3;
      const dst = 54 + y * rowSize + x * 3;
      buf[dst]     = rgbBuf[src + 2]; // B
      buf[dst + 1] = rgbBuf[src + 1]; // G
      buf[dst + 2] = rgbBuf[src];     // R
    }
  }

  fs.writeFileSync(filePath, buf);
  console.log('wrote', path.basename(filePath), width + 'x' + height);
}

// ── Drawing helpers ───────────────────────────────────────────────────────────

function drawBgGradient(canvas, cw, ch) {
  for (let y = 0; y < ch; y++) {
    const t = y / ch;
    const r = Math.round(BG_DARK.r + (BG_CARD.r - BG_DARK.r) * t);
    const g = Math.round(BG_DARK.g + (BG_CARD.g - BG_DARK.g) * t);
    const b = Math.round(BG_DARK.b + (BG_CARD.b - BG_DARK.b) * t);
    for (let x = 0; x < cw; x++) {
      const di = (y * cw + x) * 3;
      canvas[di] = r; canvas[di + 1] = g; canvas[di + 2] = b;
    }
  }
}

function blendRgba(canvas, cw, ch, rgba, iw, ih, ox, oy) {
  for (let y = 0; y < ih; y++) {
    for (let x = 0; x < iw; x++) {
      const cx = ox + x, cy = oy + y;
      if (cx < 0 || cy < 0 || cx >= cw || cy >= ch) continue;
      const si = (y * iw + x) * 4;
      const di = (cy * cw + cx) * 3;
      const a = rgba[si + 3] / 255;
      canvas[di]     = Math.round(rgba[si]     * a + canvas[di]     * (1 - a));
      canvas[di + 1] = Math.round(rgba[si + 1] * a + canvas[di + 1] * (1 - a));
      canvas[di + 2] = Math.round(rgba[si + 2] * a + canvas[di + 2] * (1 - a));
    }
  }
}

async function blendSvg(canvas, width, height, svg) {
  const rgba = await sharp(Buffer.from(svg)).ensureAlpha().raw().toBuffer();
  blendRgba(canvas, width, height, rgba, width, height, 0, 0);
}

// ── ICO ───────────────────────────────────────────────────────────────────────

async function generateIco(fileName, hue = 0) {
  const sizes = [16, 24, 32, 48, 64, 128, 256];
  const pngs = await Promise.all(sizes.map((size) => {
    let image = sharp(LOGO);
    if (hue !== 0) image = image.modulate({ hue });
    return image.resize(size, size, { fit: 'cover', position: 'centre' }).png().toBuffer();
  }));

  const headerSize = 6 + sizes.length * 16;
  let offset = headerSize;
  const entries = pngs.map((png, i) => {
    const e = { size: sizes[i], dataSize: png.length, offset };
    offset += png.length;
    return e;
  });

  const buf = Buffer.alloc(offset);
  buf.writeUInt16LE(0, 0);
  buf.writeUInt16LE(1, 2);
  buf.writeUInt16LE(sizes.length, 4);

  entries.forEach((e, i) => {
    const base = 6 + i * 16;
    buf[base]     = e.size === 256 ? 0 : e.size;
    buf[base + 1] = e.size === 256 ? 0 : e.size;
    buf[base + 2] = 0;
    buf[base + 3] = 0;
    buf.writeUInt16LE(1, base + 4);
    buf.writeUInt16LE(32, base + 6);
    buf.writeUInt32LE(e.dataSize, base + 8);
    buf.writeUInt32LE(e.offset, base + 12);
  });

  pngs.forEach((png, i) => png.copy(buf, entries[i].offset));
  fs.writeFileSync(path.join(OUT, fileName), buf);
  console.log('wrote', fileName, 'sizes:', sizes.join(', '));
}

// ── Header BMP 150×57 ─────────────────────────────────────────────────────────

async function generateHeader() {
  const W = 150, H = 57;
  const canvas = Buffer.alloc(W * H * 3);
  drawBgGradient(canvas, W, H);

  const logoSize = 36, logoX = 8, logoY = Math.floor((H - logoSize) / 2);
  const logoRgba = await sharp(LOGO)
    .resize(logoSize, logoSize, { fit: 'cover' })
    .ensureAlpha().raw().toBuffer();
  blendRgba(canvas, W, H, logoRgba, logoSize, logoSize, logoX, logoY);

  const textX = logoX + logoSize + 8;
  await blendSvg(canvas, W, H, `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
    <text x="${textX}" y="37" font-family="Segoe UI, Arial, sans-serif" font-size="24" font-weight="700">
      <tspan fill="#0c1b3a">apt</tspan><tspan fill="#0A4BD9">POS</tspan>
    </text>
  </svg>`);

  writeBmp(path.join(OUT, 'installerHeader.bmp'), W, H, canvas);
}

// ── Sidebar BMP 164×314 ───────────────────────────────────────────────────────

function drawSidebarGradient(canvas, cw, ch) {
  const top = { r: 12, g: 27, b: 58 };    // #0c1b3a
  const bottom = { r: 15, g: 45, b: 102 }; // #0f2d66
  for (let y = 0; y < ch; y++) {
    const t = y / ch;
    const r = Math.round(top.r + (bottom.r - top.r) * t);
    const g = Math.round(top.g + (bottom.g - top.g) * t);
    const b = Math.round(top.b + (bottom.b - top.b) * t);
    for (let x = 0; x < cw; x++) {
      const di = (y * cw + x) * 3;
      canvas[di] = r; canvas[di + 1] = g; canvas[di + 2] = b;
    }
  }
}

async function generateSidebar() {
  const W = 164, H = 314;
  const canvas = Buffer.alloc(W * H * 3);
  drawSidebarGradient(canvas, W, H);

  // Subtle ambient glow behind the aptPOS mark
  const glowCX = W / 2, glowCY = H * 0.30, glowR = 88;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const dist = Math.hypot(x - glowCX, y - glowCY);
      if (dist < glowR) {
        const t = (1 - dist / glowR) * 0.32;
        const di = (y * W + x) * 3;
        canvas[di]     = Math.min(255, canvas[di] + Math.round(10 * t));
        canvas[di + 1] = Math.min(255, canvas[di + 1] + Math.round(115 * t));
        canvas[di + 2] = Math.min(255, canvas[di + 2] + Math.round(215 * t));
      }
    }
  }

  const logoSize = 76;
  const logoX = Math.floor((W - logoSize) / 2);
  const logoY = 44;
  const logoRgba = await sharp(LOGO)
    .resize(logoSize, logoSize, { fit: 'cover' })
    .ensureAlpha().raw().toBuffer();
  blendRgba(canvas, W, H, logoRgba, logoSize, logoSize, logoX, logoY);

  const textY = logoY + logoSize + 44;
  await blendSvg(canvas, W, H, `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
    <text x="${W / 2}" y="${textY}" text-anchor="middle" font-family="Segoe UI, Arial, sans-serif" font-size="29" font-weight="700">
      <tspan fill="#ffffff">apt</tspan><tspan fill="#38bdf8">POS</tspan>
    </text>
    <text x="${W / 2}" y="${textY + 26}" text-anchor="middle" fill="#cbd5e1" font-family="Segoe UI, Arial, sans-serif" font-size="8.5" font-weight="600" letter-spacing="1.2">SMART RETAIL</text>
    <text x="${W / 2}" y="${textY + 39}" text-anchor="middle" fill="#94a3b8" font-family="Segoe UI, Arial, sans-serif" font-size="8.5" letter-spacing="1">POS • INVENTORY • ERP</text>
    <text x="${W / 2}" y="${H - 18}" text-anchor="middle" fill="#64748b" font-family="Segoe UI, Arial, sans-serif" font-size="8">Official Windows Setup</text>
  </svg>`);

  // Tri-color brand accent bar below text
  const lineY = textY + 52;
  const lineW = 48, lineX = Math.floor((W - lineW) / 2);
  for (let dy = 0; dy < 2; dy++) {
    for (let x = lineX; x < lineX + lineW; x++) {
      const di = ((lineY + dy) * W + x) * 3;
      const position = x - lineX;
      const color = position < lineW / 3 ? BLUE : position < (lineW * 2) / 3 ? INDIGO : ORANGE;
      canvas[di] = color.r; canvas[di + 1] = color.g; canvas[di + 2] = color.b;
    }
  }

  writeBmp(path.join(OUT, 'installerSidebar.bmp'), W, H, canvas);
}

// ── main ──────────────────────────────────────────────────────────────────────

(async () => {
  try {
    await generateIco('aptpos.ico');
    await generateIco('aptrpos.ico', -30);
    await generateIco('apterp.ico', 60);
    await generateHeader();
    await generateSidebar();
    console.log('Done.');
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
})();
