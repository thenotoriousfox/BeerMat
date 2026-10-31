// Themes: one folder each in themes/<id>/, found when the server starts, so a new theme is a new folder.
//   theme.json   {"name": "Halloween", "order": 7, "seasonal": true}
//   look.css     its look for the TV and phones, under :root[data-look=<id>] (optional; without it, the default colours)
//   sounds/      its sound theme, files named like a sound pack's general/ folder (optional)
//   art/ …       anything else its look.css uses, served from /themes/<id>/
// Seasonal themes are only used when chosen, never for random or by-type picks.
import {readdirSync, readFileSync, existsSync, statSync} from 'node:fs';
import path from 'node:path';
import {slotFiles} from '../web/soundnames.js';

export const themeId = /^[a-z0-9][a-z0-9-]{0,39}$/;
// Files a theme may serve: its pictures, fonts, sounds and stylesheet; nothing else is ever sent.
export const themeFile = /^[a-zA-Z0-9_-]+(\/[a-zA-Z0-9_-]+)*\.(svg|png|webp|jpg|woff2|mp3|ogg|wav|css)$/;

// The look's colour tokens: its custom properties under :root[data-look=<id>] (--bg, --gold…) that are plain colours.
const colourValue = /^(#[0-9a-fA-F]{3,8}|rgba?\([\d\s.,]+\))$/;
export function colourTokens(css, id) {
  const tokens = {}, text = css.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const [, block] of text.matchAll(new RegExp(`:root\\[data-look=["']?${id}["']?\\]\\s*\\{([^}]*)\\}`, 'g')))
    for (const [, name, value] of block.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) if (colourValue.test(value.trim())) tokens[name] = value.trim();
  return tokens;
}
// A phone scene's pictures as addresses the app can load.
const withPaths = (phone, base) => ({...phone, scene: Array.isArray(phone.scene) ? phone.scene.map(l => typeof l.image === 'string' ? {...l, image: base + l.image} : l) : []});

export function loadThemes(dir, prefix = '/themes/') {
  let ids = [];
  try {ids = readdirSync(dir, {withFileTypes: true}).filter(e => e.isDirectory() && themeId.test(e.name)).map(e => e.name);} catch {}
  const themes = [];
  for (const id of ids) {
    let info;
    try {info = JSON.parse(readFileSync(path.join(dir, id, 'theme.json'), 'utf8'));} catch {continue;}
    const name = typeof info.name === 'string' && info.name.trim() ? info.name.trim().slice(0, 40) : id;
    const sounds = {};
    for (const [slot, names] of Object.entries(slotFiles)) {
      const file = names.flatMap(n => ['.mp3', '.ogg', '.wav'].map(ext => `${n}${ext}`)).find(f => existsSync(path.join(dir, id, 'sounds', f)));
      if (file) sounds[slot] = `${prefix}${id}/sounds/${file}`;
    }
    let css = '', tv = null;
    try {css = readFileSync(path.join(dir, id, 'look.css'), 'utf8');} catch {}
    try {tv = JSON.parse(readFileSync(path.join(dir, id, 'tv.json'), 'utf8'));} catch {}
    themes.push({id, name, order: Number.isFinite(info.order) ? info.order : 1000, seasonal: info.seasonal === true, sounds, css,
      // For the native apps (GET /api/looks/<id>): the look's colour tokens, and what phones draw (tv.json's phone).
      colours: colourTokens(css, id), phone: tv && typeof tv.phone === 'object' ? withPaths(tv.phone, `${prefix}${id}/`) : null});
  }
  themes.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
  return {
    themes,
    // Every theme's look in one stylesheet (/themes.css), loaded after style.css.
    css: themes.filter(t => t.css).map(t => `/* ---- themes/${t.id}/look.css ---- */\n${t.css}`).join('\n'),
    // A theme's pictures, sounds and CSS, and its tv.json (what a TV screen on another computer draws: tvscreen.py).
    file(id, file) {return themeId.test(id) && (themeFile.test(file) || file === 'tv.json') && themes.some(t => t.id === id) ? path.join(dir, id, file) : null;},
  };
}

// A theme folder as a shared-theme bundle (shared/theme-bundle.js): the files a theme may share, nothing else (no
// scripts such as make-sounds.mjs). The bundle is checked before it goes anywhere.
export function bundleFolder(dir, id) {
  const files = {}, walk = sub => {
    for (const entry of readdirSync(path.join(dir, id, sub), {withFileTypes: true})) {
      const rel = sub ? `${sub}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(rel);
      else if (/^(theme\.json|look\.css|tv\.json|CREDITS\.md)$/.test(rel) || /\.(png|webp|jpg|svg|woff2|mp3|ogg|wav)$/.test(rel)) files[rel] = readFileSync(path.join(dir, id, rel)).toString('base64');
    }
  };
  walk('');
  return {id, files};
}
