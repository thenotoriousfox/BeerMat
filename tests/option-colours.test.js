// Answer A–H are the same eight colour blocks on every screen: the browser player and TV (web/style.css .opt.o0…o7),
// the Qt TV (TvStage.qml optionFills) and the Android and iPhone apps (Brand.options). A change in one place shows here.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read = file => readFileSync(new URL('../' + file, import.meta.url), 'utf8');
const lower = pairs => pairs.map(p => p.map(c => c.toLowerCase()));

test('every screen has the same answer colours', () => {
  const css = read('web/style.css');
  const web = Array.from({length: 8}, (_, n) => {
    const m = css.match(new RegExp(`\\.keypad \\.opt\\.o${n}[^{]*\\{ background: linear-gradient\\(160deg, (#[0-9a-f]{6}), (#[0-9a-f]{6})\\)`, 'i'));
    assert.ok(m, `style.css .opt.o${n}`); return [m[1], m[2]];
  });
  const qml = read('native/beermat_desk/qml/TvStage.qml').match(/optionFills: \[([\s\S]*?)\]\n/)[1];
  const qt = [...qml.matchAll(/\["(#[0-9a-f]{6})", "(#[0-9a-f]{6})"\]/gi)].map(m => [m[1], m[2]]);
  const kt = read('native/android/app/src/main/java/uk/beermat/player/ui/Theme.kt').match(/val options = listOf\(([\s\S]*?)\)\n/)[1];
  const android = [...kt.matchAll(/Color\(0xFF([0-9A-F]{6})\) to Color\(0xFF([0-9A-F]{6})\)/gi)].map(m => ['#' + m[1], '#' + m[2]]);
  const swift = read('native/ios/BeerMat/Theme.swift').match(/static let options: \[\(Color, Color\)\] = \[([\s\S]*?)\]\n/)[1];
  const iphone = [...swift.matchAll(/\(Color\(hex: 0x([0-9A-F]{6})\), Color\(hex: 0x([0-9A-F]{6})\)\)/gi)].map(m => ['#' + m[1], '#' + m[2]]);
  assert.equal(web.length, 8);
  assert.deepEqual(lower(qt), lower(web), 'Qt TV');
  assert.deepEqual(lower(android), lower(web), 'Android app');
  assert.deepEqual(lower(iphone), lower(web), 'iPhone app');
});
