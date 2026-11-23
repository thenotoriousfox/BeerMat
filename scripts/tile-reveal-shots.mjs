// Quick visual check: render the tile reveal at 0–12 tiles gone for each flag picture.
// Usage: node scripts/tile-reveal-shots.mjs [output-dir]
// Writes PNG files to the output dir (default /tmp/tile-shots).
import { chromium } from '../node_modules/playwright/index.mjs';
import { readFileSync, mkdirSync } from 'fs';
import { resolve } from 'path';

const outDir = process.argv[2] ?? '/tmp/tile-shots';
mkdirSync(outDir, { recursive: true });

// seededOrder: same algorithm as app.js / server
function seededOrder(n, seed) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) { h = Math.imul(31, h) + seed.charCodeAt(i) | 0; }
  const a = Array.from({length: n}, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    h = Math.imul(h ^ (h >>> 16), 0x45d9f3b) | 0;
    h = Math.imul(h ^ (h >>> 16), 0x45d9f3b) | 0;
    h ^= h >>> 16;
    const j = ((h >>> 0) % (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const flags = [
  { id: 'r3-q1', file: '/home/dtj/.local/share/BeerMat/BeerMat Desk/media/ebbd45712b77d52c3104bf9894206c9ad8372fb31a7eca31.png' },
  { id: 'r3-q3', file: '/home/dtj/.local/share/BeerMat/BeerMat Desk/media/e1e8b593d47fa1af721204b8a3e586ae42110c21cbb76474.png' },
  { id: 'r3-q5', file: '/home/dtj/.local/share/BeerMat/BeerMat Desk/media/3b59f60d8162bb1529ebd4d57a4cad695a9f6523ed6ecd41.png' },
];

const browser = await chromium.launch();
const page = await browser.newPage();
await page.setViewportSize({ width: 800, height: 500 });

const css = readFileSync(resolve('/home/dtj/BeerMat/web/style.css'), 'utf8');

for (const flag of flags) {
  const imgData = readFileSync(flag.file);
  const dataUrl = `data:image/png;base64,${imgData.toString('base64')}`;
  const order = seededOrder(20, `tiles:${flag.id}`);

  for (const gone of [0, 1, 3, 6, 10, 15, 19, 20]) {
    const tileSpans = Array.from({length: 20}, (_, i) => {
      const isGone = order[i] < gone;
      return `<span class="${isGone ? 'gone' : ''}" data-order="${order[i]}"></span>`;
    }).join('');

    const html = `<!DOCTYPE html><html><head><style>
      body { margin: 0; background: #1e1b4b; display: flex; align-items: center; justify-content: center; height: 100vh; }
      img { max-width: 700px; max-height: 440px; display: block; }
      ${css}
    </style></head><body>
      <div class="revealing-picture">
        <img src="${dataUrl}" alt="flag">
        <div class="reveal-tiles">${tileSpans}</div>
      </div>
    </body></html>`;

    await page.setContent(html, { waitUntil: 'load' });
    const name = `${flag.id}_tiles_${String(gone).padStart(2,'0')}_gone.png`;
    await page.screenshot({ path: `${outDir}/${name}`, fullPage: false });
    console.log(`  ${name}`);
  }
}

await browser.close();
console.log(`\nDone — screenshots in ${outDir}`);
