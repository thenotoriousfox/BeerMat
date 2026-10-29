// Shared themes: what a theme bundle must be before BeerMat Online stores it or a laptop installs it
// (shared/theme-bundle.js). The checks read the bytes; nothing the bundle says about itself is trusted.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readdirSync} from 'node:fs';
import path from 'node:path';
import {checkTheme, renameTheme, bundleOf, LIMITS} from '../shared/theme-bundle.js';
import {bundleFolder} from '../server/themes.js';

const root = path.join(path.dirname(new URL(import.meta.url).pathname), '..'), themes = path.join(root, 'themes');
const b64 = text => Buffer.from(text).toString('base64');
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]).toString('base64');
const theme = (css, extra = {}) => ({id: 'pub-glow', files: {'theme.json': b64('{"name": "Pub glow", "order": 3, "evil": "<script>"}'), 'look.css': b64(css), ...extra}});
const ok = ':root[data-look=pub-glow] { --gold: #ffcc00; }\n:root[data-look=pub-glow] .decor { display: block; background: url(/themes/pub-glow/art/glow.png); }\n';

test('every theme BeerMat ships passes, as a shared theme would', () => {
  const ids = readdirSync(themes, {withFileTypes: true}).filter(e => e.isDirectory()).map(e => e.name);
  assert.ok(ids.includes('halloween'));
  // stage is the default look itself: nothing of its own to share.
  assert.throws(() => checkTheme(bundleFolder(themes, 'stage')), /needs a look/);
  for (const id of ids.filter(i => i !== 'stage')) {
    const checked = checkTheme(bundleFolder(themes, id));
    assert.equal(checked.id, id);
    assert.ok(!checked.files.has('make-sounds.mjs'), `${id}: only pictures, fonts, sounds and its look`);
  }
});

test('a theme is cleaned up and checked file by file', () => {
  const t = checkTheme(theme(ok, {'art/glow.png': PNG, 'sounds/correct.mp3': b64('ID3 tag'), 'CREDITS.md': b64('Made by us.')}));
  assert.deepEqual(JSON.parse(t.files.get('theme.json')), {name: 'Pub glow', order: 3}, 'only what theme.json may say');
  for (const [files, reason] of [
    [{'art/glow.png': PNG, 'run.js': b64('alert(1)')}, /run\.js: only theme\.json/],
    [{'art/glow.png': PNG, 'art/other.css': b64('body{}')}, /other\.css: only theme\.json/],
    [{'art/glow.png': PNG, '../escape.png': PNG}, /escape\.png/],
    [{'art/glow.png': b64('<html>not a png')}, /art\/glow\.png: not a \.png file/],
    [{'art/glow.png': PNG, 'sounds/x.mp3': b64('#!/bin/sh')}, /not a \.mp3 file/],
    [{'art/glow.png': PNG, 'art/a.svg': b64('<svg><script>alert(1)</script></svg>')}, /can’t contain scripts/],
    [{'art/glow.png': PNG, 'art/a.svg': b64('<svg onload="alert(1)"></svg>')}, /event handlers/],
    [{'art/glow.png': PNG, 'art/a.svg': b64('<svg><image href="https://tracker.example/x.png"/></svg>')}, /links out/],
    [{'art/glow.png': PNG, 'art/a.svg': b64('<svg><foreignObject><div/></foreignObject></svg>')}, /foreign objects/],
    [{'art/glow.png': PNG, 'art/a.svg': b64('<!DOCTYPE svg [<!ENTITY x "y">]><svg/>')}, /not a \.svg file|entities/],
  ]) assert.throws(() => checkTheme(theme(ok, files)), reason);
  assert.throws(() => checkTheme(theme(ok, {'art/glow.png': Buffer.alloc(LIMITS.file + 1, 0x89).toString('base64')})), /over 5 MB|not a \.png/);
  assert.throws(() => checkTheme({id: 'Pub Glow', files: {}}), /lower-case/);
  assert.throws(() => checkTheme({id: 'x', files: {'theme.json': b64('{}'), 'look.css': b64('')}}), /needs a name/);
  assert.throws(() => checkTheme({id: 'x', files: {'theme.json': b64('{"name": "Empty"}')}}), /a look .* sounds/);
});

test('look.css may only style its own look and use its own files', () => {
  const files = {'art/glow.png': PNG};
  for (const [css, reason] of [
    ['body { background: red; }', /“body” must start with :root\[data-look=pub-glow\]/],
    [':root[data-look=pub-glow] h1, .desk { color: red; }', /“\.desk” must start/],
    [':root[data-look=stage] { --gold: red; }', /styles another look \(stage\)/],
    ['@import url(/themes/pub-glow/art/glow.png);', /imports/],
    [':root[data-look=pub-glow] { background: url(https://tracker.example/pixel.png); }', /isn’t one of this theme’s files/],
    [':root[data-look=pub-glow] { background: url(/themes/pub-glow/art/missing.png); }', /isn’t one of this theme’s files/],
    [':root[data-look=pub-glow] { background: url(/themes/pub-glow/theme.json); }', /isn’t one of this theme’s files/],
    [':root[data-look=pub-glow] { background: url(/web/host.js); }', /isn’t one of this theme’s files/],
    [':root[data-look=pub-glow] { content: "\\41"; }', /escapes/],
    [':root[data-look=pub-glow] { width: expression(alert(1)); }', /expressions/],
    ['@page { margin: 0; }', /@page isn’t allowed/],
    ['@media screen { body { color: red; } }', /“body” must start/],
    [':root[data-look=pub-glow] { color: red; ', /unbalanced|text outside/],
  ]) assert.throws(() => checkTheme(theme(css, files)), reason, css);
  // Media queries, fonts and animations are fine when they keep to the theme.
  const fine = ok + '@media (prefers-reduced-motion: no-preference) { :root[data-look=pub-glow] .decor i { animation: glow 2s infinite; } }\n'
    + '@keyframes glow { from { opacity: .5; } to { opacity: 1; } }\n@font-face { font-family: "Pub Hand"; src: url(/themes/pub-glow/art/hand.woff2); }\n'
    + ':root[data-look=pub-glow] h1 { font-family: "Pub Hand", Fredoka, sans-serif; }\n/* a comment with body { } in it */';
  assert.doesNotThrow(() => checkTheme(theme(fine, {...files, 'art/hand.woff2': b64('wOF2 font data')})));
});

test('renamed under its library id, a theme keeps working and its fonts and animations can’t clash', () => {
  const css = ok + '@keyframes glow { to { opacity: 1; } }\n:root[data-look=pub-glow] .decor i { animation: glow 2s infinite, pulse 1s; }\n'
    + '@font-face { font-family: "Pub Hand"; src: url(/themes/pub-glow/art/hand.woff2); }\n:root[data-look=pub-glow] h1 { font-family: "Pub Hand", Fredoka; }\n';
  const checked = checkTheme(theme(css, {'art/glow.png': PNG, 'art/hand.woff2': b64('wOF2 font')}));
  const renamed = renameTheme(checked, 's-7k2q9x'), out = renamed.files.get('look.css').toString();
  assert.match(out, /:root\[data-look=s-7k2q9x\] \{ --gold/);
  assert.match(out, /url\(\/themes\/s-7k2q9x\/art\/glow\.png\)/);
  assert.match(out, /@keyframes s-7k2q9x--glow/);
  assert.match(out, /animation: s-7k2q9x--glow 2s infinite, pulse 1s/, 'only its own animation, not BeerMat’s');
  assert.match(out, /font-family: "s-7k2q9x--Pub Hand"; src/);
  assert.match(out, /font-family: "s-7k2q9x--Pub Hand", Fredoka/);
  assert.doesNotMatch(out, /pub-glow/);
  // The renamed theme passes the same checks under its new id, and survives the wire.
  assert.equal(checkTheme(bundleOf(renamed)).id, 's-7k2q9x');
  // Halloween too, with its scenery and many animations.
  const halloween = renameTheme(checkTheme(bundleFolder(themes, 'halloween')), 's-hallo1');
  assert.equal(checkTheme(bundleOf(halloween)).id, 's-hallo1');
  assert.match(halloween.files.get('look.css').toString(), /animation: s-hallo1--hw-/);
});

test('tv.json: what the native TV draws, checked key by key', () => {
  const tv = value => theme(ok, {'art/glow.png': PNG, 'tv.json': b64(JSON.stringify(value))});
  const good = {background: {gradient: [[0, '#000'], [1, 'rgba(20, 10, 40, 0.9)']], glows: [[960, 1080, 1200, 600, 'rgba(255, 120, 40, .2)']]},
    title: {gradient: [[0, '#fff'], [1, '#f80']], glow: '#ff6e14', flicker: {duration: 6000, keys: [[0, 1], [0.5, 0.8], [1, 1]]}},
    eyebrow: {color: '#9dff5a'}, panel: {gradient: [[0, '#221133']], border: '#ff8800'},
    scene: [{image: 'art/glow.png', x: 0, y: 500, width: 1920, height: 580, fit: 'crop', align: 'bottom'},
      {dot: true, x: 100, y: 1000, width: 6, height: 6, color: '#ffb347', motion: {duration: 6000, easing: 'out', keys: [[0, 0, 0, 0], [1, 20, -240, 0]]}},
      {blobs: [[0.2, 0.7, 0.3, 0.6, 0.3]], x: -960, y: 860, width: 3840, height: 240, motion: {duration: 60000, alternate: true, keys: [[0, 0, 0], [1, 500, 0]]}}]};
  assert.doesNotThrow(() => checkTheme(tv(good)));
  assert.doesNotThrow(() => checkTheme(tv({...good, phone: {background: {gradient: [[0, '#000']]}, scene: [{image: 'art/glow.png', x: -20, bottom: 0, width: 430, height: 200}]}})));
  for (const [value, reason] of [
    [{...good, script: 'alert(1)'}, /tv\.json\.script isn’t a known setting/],
    [{scene: [{image: 'art/missing.png', width: 10, height: 10}]}, /must be one of this theme’s pictures/],
    [{scene: [{image: 'https://tracker.example/x.png', width: 10, height: 10}]}, /must be one of this theme’s pictures/],
    [{scene: [{image: 'art/glow.png', dot: true, width: 10, height: 10}]}, /one of image, dot or blobs/],
    [{scene: [{dot: true, width: 1e9, height: 10}]}, /width must be a number/],
    [{title: {glow: 'url(javascript:alert(1))'}}, /must be a colour/],
    [{scene: Array.from({length: 41}, () => ({dot: true, width: 5, height: 5}))}, /at most 40/],
    [{scene: [{dot: true, width: 5, height: 5, motion: {duration: 1, keys: [[0, 0, 0], [1, 1, 1]]}}]}, /duration must be a number/],
    [{phone: {scene: [{image: 'art/a.svg', width: 10, height: 10}]}}, /\.png, \.webp or \.jpg/],
    [{phone: {scene: [{image: 'art/glow.png', width: 10, height: 10, motion: {}}]}}, /motion isn’t a known setting/],
  ]) assert.throws(() => checkTheme(tv(value)), reason);
  // Halloween's, as shipped.
  assert.ok(checkTheme(bundleFolder(themes, 'halloween')).files.has('tv.json'));
});
