// Renders BeerMat's SVGs (brand/make-brand.py) into every PNG and icon the apps use, with the browser Playwright
// already installs for the tests, then PIL for the iPhone icon (no transparency allowed) and the Windows .ico.
//   node brand/render.mjs
import {readFileSync, existsSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {chromium} from 'playwright';

const root = path.join(import.meta.dirname, '..'), brand = f => path.join(root, 'brand', f), night = '#140b2e';
const svg = name => readFileSync(brand(name), 'utf8');
const android = path.join(root, 'mobile/android/app/src/main/res'), ios = path.join(root, 'mobile/ios/App/App/Assets.xcassets');
const densities = {mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4};
const browser = await chromium.launch();
const page = await browser.newPage();

// One image: the SVG filling a w×h box (`shape`: square, rounded or circle; `bg` behind a centred logo of `scale`).
async function png(out, w, h, name, {shape = 'square', bg = null, scale = 1} = {}) {
  const radius = {square: '0', rounded: '22.5%', circle: '50%'}[shape];
  await page.setViewportSize({width: w, height: h});
  await page.setContent(`<!doctype html><style>html,body{margin:0;width:${w}px;height:${h}px;background:${bg || 'transparent'};display:grid;place-items:center;overflow:hidden}
    div{width:${w * scale}px;height:${h * scale}px;border-radius:${radius};overflow:hidden;display:grid;place-items:center} svg{width:100%;height:100%}</style><div>${svg(name)}</div>`);
  await page.screenshot({path: out, omitBackground: !bg});
}
const done = [];
const make = async (out, ...args) => {await png(out, ...args); done.push(path.relative(root, out));};

// Desktop app (electron-builder) and the Linux app-menu launcher.
await make(path.join(root, 'build/icon.png'), 1024, 1024, 'icon.svg', {shape: 'rounded'});
await make(path.join(root, 'scripts/pubquiz.png'), 512, 512, 'icon.svg', {shape: 'rounded'});
// Android: square-ish and round launcher icons, and the adaptive icon's foreground (its background is a colour).
for (const [d, k] of Object.entries(densities)) {
  await make(path.join(android, `mipmap-${d}/ic_launcher.png`), 48 * k, 48 * k, 'icon.svg', {shape: 'rounded'});
  await make(path.join(android, `mipmap-${d}/ic_launcher_round.png`), 48 * k, 48 * k, 'icon.svg', {shape: 'circle'});
  await make(path.join(android, `mipmap-${d}/ic_launcher_foreground.png`), 108 * k, 108 * k, 'icon-foreground.svg');
}
// Splash screens: the stacked logo on the night colour, in every size the projects already have.
const splashes = [['drawable/splash.png', 480, 320], ...Object.entries({mdpi: [320, 480], hdpi: [480, 800], xhdpi: [720, 1280], xxhdpi: [960, 1600], xxxhdpi: [1280, 1920]})
  .flatMap(([d, [w, h]]) => [[`drawable-port-${d}/splash.png`, w, h], [`drawable-land-${d}/splash.png`, h, w]])];
for (const [file, w, h] of splashes) if (existsSync(path.join(android, file))) await make(path.join(android, file), w, h, 'logo-stacked.svg', {bg: night, scale: w < h ? 0.7 : 0.45});
for (const file of ['splash-2732x2732.png', 'splash-2732x2732-1.png', 'splash-2732x2732-2.png']) await make(path.join(ios, 'Splash.imageset', file), 2732, 2732, 'logo-stacked.svg', {bg: night, scale: 0.4});
// iPhone: one 1024 icon, square (iOS rounds it), flattened below.
await make(path.join(ios, 'AppIcon.appiconset/AppIcon-512@2x.png'), 1024, 1024, 'icon.svg');
await browser.close();

// The iPhone icon may not have an alpha channel; Windows wants one .ico with every size.
execFileSync('python3', ['-c', `
from PIL import Image
icon = '${path.join(ios, 'AppIcon.appiconset/AppIcon-512@2x.png')}'
Image.open(icon).convert('RGB').save(icon)
for f in ${JSON.stringify(splashes.map(([f]) => path.join(android, f)).concat(['splash-2732x2732.png', 'splash-2732x2732-1.png', 'splash-2732x2732-2.png'].map(f => path.join(ios, 'Splash.imageset', f))))}:
    try: Image.open(f).convert('RGB').save(f)
    except FileNotFoundError: pass
Image.open('${path.join(root, 'build/icon.png')}').save('${path.join(root, 'build/icon.ico')}', sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
`]);
console.log(`${done.length + 1} images:\n  ${[...done, 'build/icon.ico'].join('\n  ')}`);
