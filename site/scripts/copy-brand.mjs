// The site uses BeerMat's own logos and font (brand/), copied in at build time rather than kept twice.
import {copyFileSync, mkdirSync} from 'node:fs';
import path from 'node:path';

const brand = path.join(import.meta.dirname, '..', '..', 'brand'), out = path.join(import.meta.dirname, '..', 'public', 'brand');
mkdirSync(out, {recursive: true});
for (const f of ['mark.svg', 'logo.svg', 'logo-stacked.svg', 'wordmark.svg', 'mark-print.svg', 'fredoka.woff2', 'Fredoka-OFL.txt']) copyFileSync(path.join(brand, f), path.join(out, f));
