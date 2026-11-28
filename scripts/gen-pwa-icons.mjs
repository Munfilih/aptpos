import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const outDir = path.join(process.cwd(), 'public', 'icons');
fs.mkdirSync(outDir, { recursive: true });

const defs = `<defs><linearGradient id="b" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#00B4FF"/><stop offset="1" stop-color="#0A4BD9"/></linearGradient></defs>`;
const bag = `<path d="M37 56h62l8 54H29l8-54Zm18-2c0-15 9-25 23-25s23 10 23 25" fill="none" stroke="#fff" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/><path d="M51 79c11 14 23 14 34 0" fill="none" stroke="#fff" stroke-width="8" stroke-linecap="round"/>`;

// "any" icon: rounded gradient tile filling the whole canvas (the aptPOS app icon)
const anySvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 136 136">${defs}<rect width="136" height="136" rx="28" fill="url(#b)"/>${bag}</svg>`;

// maskable / apple icon: full-bleed gradient square, mark kept inside the 80% safe zone
const bleedSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 136 136">${defs}<rect width="136" height="136" fill="url(#b)"/><g transform="translate(68 68) scale(0.78) translate(-68 -68)">${bag}</g></svg>`;

const render = (svg, size, file) =>
  sharp(Buffer.from(svg), { density: 600 })
    .resize(size, size)
    .png({ compressionLevel: 9 })
    .toFile(path.join(outDir, file));

await Promise.all([
  render(anySvg, 32, 'favicon-32.png'),
  render(anySvg, 192, 'icon-192.png'),
  render(anySvg, 512, 'icon-512.png'),
  render(bleedSvg, 180, 'apple-touch-icon.png'),
  render(bleedSvg, 192, 'icon-maskable-192.png'),
  render(bleedSvg, 512, 'icon-maskable-512.png'),
]);

fs.writeFileSync(path.join(outDir, 'icon.svg'), anySvg);
console.log('Generated aptPOS mark-only PWA icons in', outDir);
