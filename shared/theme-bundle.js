// Shared themes (the theme library): a theme folder sent as one JSON bundle, {id, files: {path: base64}}, and the
// checks it passes before BeerMat Online stores it and again before a quiz laptop installs it. A shared theme's
// look.css runs on other venues' TVs and phones, so it may only style its own look and use its own files:
//   - tv.json (what the native TV draws: background, title, eyebrow, panel and scenery): known keys only, colours,
//     bounded numbers, and pictures from the bundle;
//   - files: theme.json, look.css, tv.json, CREDITS.md, and pictures, fonts and sounds (.png .webp .jpg .svg .woff2 .mp3 .ogg
//     .wav), each what its name says (checked by its first bytes), 5 MB each, 15 MB and 80 files in all;
//   - look.css: every rule under :root[data-look=<id>] (inside @media and @supports too), plus @font-face and
//     @keyframes; url() only to /themes/<id>/<a file in the bundle>; no @import, other at-rules, escapes or scripts.
//     Its fonts and animations are renamed under the theme's library id (renameTheme), so they can't clash with
//     BeerMat's own or another theme's;
//   - .svg pictures: no scripts, event handlers, foreign objects, entities or links out.
// Nothing here trusts the bundle's own claims: every check reads the bytes.
export const themeId = /^[a-z0-9][a-z0-9-]{0,39}$/;
const filePath = /^(theme\.json|look\.css|tv\.json|CREDITS\.md|[a-zA-Z0-9_-]+(\/[a-zA-Z0-9_-]+)*\.(png|webp|jpg|svg|woff2|mp3|ogg|wav))$/;
export const LIMITS = {files: 80, file: 5 * 1024 * 1024, total: 15 * 1024 * 1024};

const fail = message => {throw Object.assign(new Error(message), {status: 400});};
const starts = (b, ...bytes) => bytes.every((x, i) => b[i] === x);
const ascii = (b, at, text) => b.subarray(at, at + text.length).toString('latin1') === text;
// What each kind of file must start with.
const looksLike = {
  png: b => starts(b, 0x89, 0x50, 0x4e, 0x47), jpg: b => starts(b, 0xff, 0xd8, 0xff), webp: b => ascii(b, 0, 'RIFF') && ascii(b, 8, 'WEBP'),
  woff2: b => ascii(b, 0, 'wOF2'), ogg: b => ascii(b, 0, 'OggS'), wav: b => ascii(b, 0, 'RIFF') && ascii(b, 8, 'WAVE'),
  mp3: b => ascii(b, 0, 'ID3') || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0), svg: b => /^\s*(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*<svg[\s>]/i.test(b.toString('utf8').replace(/^﻿/, '')),
};

function checkSvg(text, path) {
  for (const [pattern, what] of [[/<script/i, 'scripts'], [/\son[a-z]+\s*=/i, 'event handlers'], [/<foreignObject/i, 'foreign objects'], [/<!ENTITY|<!DOCTYPE/i, 'entities'],
    [/(href|src)\s*=\s*["']?\s*(?!#)[a-z][a-z0-9+.-]*:/i, 'links out'], [/javascript:/i, 'scripts']]) {
    if (pattern.test(text)) fail(`${path}: pictures can’t contain ${what}`);
  }
}

// The stylesheet's structure: rules and blocks, with comments gone. Only what a look needs is allowed.
function checkCss(css, id, files) {
  if (/\\/.test(css)) fail('look.css: escapes (\\) aren’t allowed');
  const text = css.replace(/\/\*[\s\S]*?\*\//g, ' ');
  if (/expression\s*\(|javascript:|behavior\s*:|-moz-binding|@import|@namespace/i.test(text)) fail('look.css: imports, scripts and expressions aren’t allowed');
  for (const [, look] of text.matchAll(/data-look\s*=\s*["']?([^"'\]\s]+)/g)) if (look !== id) fail(`look.css styles another look (${look}): only its own, ${id}`);
  for (const [, raw] of text.matchAll(/url\(\s*([^)]*?)\s*\)/gi)) {
    const url = raw.replace(/^["']|["']$/g, ''), match = /^\/themes\/([^/]+)\/(.+)$/.exec(url);
    if (!match || match[1] !== id || !files.has(match[2]) || match[2] === 'theme.json' || match[2] === 'CREDITS.md') fail(`look.css: url(${url}) isn’t one of this theme’s files (/themes/${id}/…)`);
  }
  const scope = new RegExp(`^:root\\[data-look=["']?${id}["']?\\]`);
  let i = 0;
  const block = depth => {
    while (i < text.length) {
      const open = text.indexOf('{', i), close = text.indexOf('}', i);
      if (close !== -1 && (open === -1 || close < open)) {
        if (!depth) fail('look.css: an unexpected }');
        if (text.slice(i, close).trim() && !/^[^{}]*$/.test(text.slice(i, close))) fail('look.css: unexpected text');
        i = close + 1; return;
      }
      if (open === -1) {if (text.slice(i).trim()) fail('look.css: text outside any rule'); i = text.length; return;}
      const prelude = text.slice(i, open).trim(); i = open + 1;
      if (/^@(media|supports)\b/i.test(prelude)) {block(depth + 1); continue;}
      if (/^@font-face$/i.test(prelude) || /^@keyframes\s/i.test(prelude)) {
        if (/^@keyframes/i.test(prelude) && !/^@keyframes\s+[\w-]+$/i.test(prelude)) fail('look.css: an animation needs a plain name');
        const end = text.indexOf('}', i);
        // @keyframes holds its own rules ({ from {…} to {…} }): skip to its closing brace.
        if (/^@keyframes/i.test(prelude)) {let level = 1; while (level && i < text.length) {const c = text[i++]; if (c === '{') level++; else if (c === '}') level--;}}
        else i = end + 1;
        continue;
      }
      if (prelude.startsWith('@')) fail(`look.css: ${prelude.split(/\s/)[0]} isn’t allowed`);
      for (const selector of prelude.split(',')) if (!scope.test(selector.trim())) fail(`look.css: “${selector.trim().slice(0, 60)}” must start with :root[data-look=${id}]`);
      const end = text.indexOf('}', i);
      if (end === -1 || text.slice(i, end).includes('{')) fail('look.css: unbalanced braces');
      i = end + 1;
    }
  };
  block(0);
}

// tv.json, checked key by key (themes/README.md describes it).
const colour = /^(#[0-9a-fA-F]{3}|#[0-9a-fA-F]{6}|#[0-9a-fA-F]{8}|rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(,\s*(0|1|0?\.\d+)\s*)?\))$/;
function checkTv(tv, files) {
  const bad = what => fail(`tv.json: ${what}`);
  const obj = (v, keys, where) => {
    if (!v || typeof v !== 'object' || Array.isArray(v)) bad(`${where} must be an object`);
    for (const k of Object.keys(v)) if (!keys.includes(k)) bad(`${where}.${k} isn’t a known setting`);
    return v;
  };
  const num = (v, lo, hi, where) => {if (typeof v !== 'number' || !Number.isFinite(v) || v < lo || v > hi) bad(`${where} must be a number from ${lo} to ${hi}`);};
  const col = (v, where) => {if (typeof v !== 'string' || !colour.test(v.trim())) bad(`${where} must be a colour (#rgb, #rrggbb or rgba())`);};
  const list = (v, most, where) => {if (!Array.isArray(v) || v.length > most) bad(`${where} must be a list of at most ${most}`); return v;};
  const gradient = (v, where) => {list(v, 8, where); if (!v.length) bad(`${where} is empty`); v.forEach((s, i) => {list(s, 2, `${where}[${i}]`); num(s[0], 0, 1, `${where}[${i}][0]`); col(s[1], `${where}[${i}][1]`);});};
  const keys = (v, where, size) => {list(v, 20, where); if (v.length < 2) bad(`${where} needs two keys or more`); v.forEach((k, i) => {list(k, size, `${where}[${i}]`); num(k[0], 0, 1, `${where}[${i}][0]`); k.slice(1).forEach((x, j) => num(x, -5000, 5000, `${where}[${i}][${j + 1}]`));});};
  obj(tv, ['background', 'title', 'eyebrow', 'panel', 'scene'], 'tv.json');
  if (tv.background) {
    obj(tv.background, ['gradient', 'glows'], 'background');
    if (tv.background.gradient) gradient(tv.background.gradient, 'background.gradient');
    if (tv.background.glows) list(tv.background.glows, 6, 'background.glows').forEach((g, i) => {list(g, 5, `background.glows[${i}]`); g.slice(0, 4).forEach((x, j) => num(x, -5000, 5000, `background.glows[${i}][${j}]`)); col(g[4], `background.glows[${i}][4]`);});
  }
  if (tv.title) {
    obj(tv.title, ['gradient', 'glow', 'flicker'], 'title');
    if (tv.title.gradient) gradient(tv.title.gradient, 'title.gradient');
    if (tv.title.glow) col(tv.title.glow, 'title.glow');
    if (tv.title.flicker) {obj(tv.title.flicker, ['duration', 'keys'], 'title.flicker'); num(tv.title.flicker.duration, 100, 600000, 'title.flicker.duration'); keys(tv.title.flicker.keys, 'title.flicker.keys', 2);}
  }
  if (tv.eyebrow) {obj(tv.eyebrow, ['color', 'glow'], 'eyebrow'); for (const k of ['color', 'glow']) if (tv.eyebrow[k]) col(tv.eyebrow[k], `eyebrow.${k}`);}
  if (tv.panel) {obj(tv.panel, ['gradient', 'border'], 'panel'); gradient(tv.panel.gradient, 'panel.gradient'); if (tv.panel.border) col(tv.panel.border, 'panel.border');}
  if (tv.scene) list(tv.scene, 40, 'scene').forEach((layer, i) => {
    const where = `scene[${i}]`;
    obj(layer, ['image', 'dot', 'blobs', 'x', 'y', 'width', 'height', 'opacity', 'mirror', 'fit', 'align', 'color', 'glow', 'motion'], where);
    if ([layer.image !== undefined, layer.dot !== undefined, layer.blobs !== undefined].filter(Boolean).length !== 1) bad(`${where} is one of image, dot or blobs`);
    if (layer.image !== undefined && (typeof layer.image !== 'string' || !files.has(layer.image) || !/\.(png|webp|jpg|svg)$/.test(layer.image))) bad(`${where}.image must be one of this theme’s pictures`);
    if (layer.dot !== undefined && layer.dot !== true) bad(`${where}.dot must be true`);
    if (layer.blobs !== undefined) list(layer.blobs, 8, `${where}.blobs`).forEach((b, j) => {list(b, 5, `${where}.blobs[${j}]`); if (b.length !== 5) bad(`${where}.blobs[${j}] is [x, y, width, height, opacity]`); b.forEach((x, k) => num(x, 0, 2, `${where}.blobs[${j}][${k}]`));});
    for (const k of ['x', 'y']) if (layer[k] !== undefined) num(layer[k], -5000, 5000, `${where}.${k}`);
    for (const k of ['width', 'height']) num(layer[k], 0.1, 8000, `${where}.${k}`);
    if (layer.opacity !== undefined) num(layer.opacity, 0, 1, `${where}.opacity`);
    if (layer.mirror !== undefined && typeof layer.mirror !== 'boolean') bad(`${where}.mirror must be true or false`);
    if (layer.fit !== undefined && !['crop', 'fit', 'stretch'].includes(layer.fit)) bad(`${where}.fit is crop, fit or stretch`);
    if (layer.align !== undefined && !['top', 'center', 'bottom'].includes(layer.align)) bad(`${where}.align is top, center or bottom`);
    for (const k of ['color', 'glow']) if (layer[k] !== undefined) col(layer[k], `${where}.${k}`);
    if (layer.motion !== undefined) {
      const m = obj(layer.motion, ['duration', 'offset', 'alternate', 'easing', 'keys'], `${where}.motion`);
      num(m.duration, 100, 600000, `${where}.motion.duration`);
      if (m.offset !== undefined) num(m.offset, 0, 600000, `${where}.motion.offset`);
      if (m.alternate !== undefined && typeof m.alternate !== 'boolean') bad(`${where}.motion.alternate must be true or false`);
      if (m.easing !== undefined && !['linear', 'sine', 'out'].includes(m.easing)) bad(`${where}.motion.easing is linear, sine or out`);
      keys(m.keys, `${where}.motion.keys`, 4);
    }
  });
}

// A bundle as received: returns {id, name, info, files: Map<path, Buffer>}, or throws (status 400) with the reason.
export function checkTheme(bundle) {
  if (!bundle || typeof bundle !== 'object') fail('Not a theme');
  const {id, files} = bundle;
  if (typeof id !== 'string' || !themeId.test(id)) fail('A theme id is lower-case letters, digits and hyphens');
  if (!files || typeof files !== 'object' || Array.isArray(files)) fail('A theme needs its files');
  const entries = Object.entries(files);
  if (!entries.length || entries.length > LIMITS.files) fail(`A theme has 1 to ${LIMITS.files} files`);
  const decoded = new Map();
  let total = 0;
  for (const [path, data] of entries) {
    if (!filePath.test(path)) fail(`${path}: only theme.json, look.css, CREDITS.md and pictures, fonts and sounds`);
    if (typeof data !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(data)) fail(`${path}: not base64`);
    const bytes = Buffer.from(data, 'base64');
    if (bytes.length > LIMITS.file) fail(`${path}: over 5 MB`);
    total += bytes.length;
    const kind = path.split('.').pop();
    if (looksLike[kind] && !looksLike[kind](bytes)) fail(`${path}: not a .${kind} file`);
    if (kind === 'svg') checkSvg(bytes.toString('utf8'), path);
    decoded.set(path, bytes);
  }
  if (total > LIMITS.total) fail('A theme is 15 MB at most');
  let info;
  try {info = JSON.parse(decoded.get('theme.json')?.toString('utf8') ?? 'null');} catch {fail('theme.json isn’t JSON');}
  if (!info || typeof info !== 'object' || typeof info.name !== 'string' || !info.name.trim()) fail('theme.json needs a name');
  const clean = {name: info.name.trim().slice(0, 40), ...Number.isFinite(info.order) && {order: info.order}, ...info.seasonal === true && {seasonal: true}};
  decoded.set('theme.json', Buffer.from(JSON.stringify(clean, null, 2) + '\n'));
  const css = decoded.get('look.css');
  if (css) checkCss(css.toString('utf8'), id, decoded);
  if (decoded.has('tv.json')) {
    let tv;
    try {tv = JSON.parse(decoded.get('tv.json').toString('utf8'));} catch {fail('tv.json isn’t JSON');}
    checkTv(tv, decoded);
  }
  if (!css && ![...decoded.keys()].some(p => p.startsWith('sounds/'))) fail('A theme needs a look (look.css), sounds, or both');
  return {id, name: clean.name, info: clean, files: decoded};
}

// The same theme under another id (BeerMat Online gives each shared theme its own): its look and file paths, and its
// own animations and fonts named <newId>--<name> where they're defined and used. The result passes checkTheme.
export function renameTheme(theme, newId) {
  if (!themeId.test(newId)) fail('A theme id is lower-case letters, digits and hyphens');
  const files = new Map(theme.files), source = files.get('look.css');
  if (source) {
    const old = theme.id.replace(/-/g, '\\-');
    let css = source.toString('utf8').replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(new RegExp(`data-look=(["']?)${old}\\1\\]`, 'g'), `data-look=$1${newId}$1]`)
      .replace(new RegExp(`/themes/${old}/`, 'g'), `/themes/${newId}/`);
    const animations = [...css.matchAll(/@keyframes\s+([\w-]+)/gi)].map(m => m[1]);
    const fonts = [...css.matchAll(/@font-face\s*\{[^}]*?font-family\s*:\s*["']?([^;"'}]+?)["']?\s*[;}]/gi)].map(m => m[1].trim());
    const own = (list, name) => list.includes(name) ? `${newId}--${name.replace(new RegExp(`^${theme.id}--`), '')}` : name;
    const words = (value, list) => value.replace(/["']?([\w -]+?)["']?(?=\s*(,|$|!))/g, (whole, name) => list.includes(name.trim()) ? whole.replace(name.trim(), own(list, name.trim())) : whole);
    css = css.replace(/@keyframes\s+([\w-]+)/gi, (_, name) => `@keyframes ${own(animations, name)}`)
      .replace(/(animation(?:-name)?\s*:)([^;}]*)/gi, (_, prop, value) => prop + value.replace(/[\w-]+/g, word => animations.includes(word) ? own(animations, word) : word))
      .replace(/(font-family\s*:)([^;}]*)/gi, (_, prop, value) => prop + words(value, fonts));
    files.set('look.css', Buffer.from(css));
  }
  return {...theme, id: newId, files};
}

// Back to the wire form.
export const bundleOf = theme => ({id: theme.id, files: Object.fromEntries([...theme.files].map(([path, bytes]) => [path, bytes.toString('base64')]))});
