import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import {qrMatrix, wifiCode} from '../qr.js';

const finder = (m, r0, c0) => [0, 1, 2, 3, 4, 5, 6].every(r => [0, 1, 2, 3, 4, 5, 6].every(c => m[r0 + r][c0 + c] === (Math.max(Math.abs(r - 3), Math.abs(c - 3)) !== 2)));
test('QR matrices have the right size, finder patterns and limits', () => {
  for (const [text, version] of [['PubQuiz', 1], ['http://10.42.0.1', 2], ['x'.repeat(120), 7], ['y'.repeat(213), 10]]) {
    const m = qrMatrix(text), n = 17 + 4 * version;
    assert.equal(m.length, n, text.slice(0, 10)); assert.ok(m.every(row => row.length === n));
    assert.ok(finder(m, 0, 0) && finder(m, 0, n - 7) && finder(m, n - 7, 0));
    assert.equal(m[n - 8][8], true, 'dark module');
  }
  assert.throws(() => qrMatrix('z'.repeat(214)), /too long/);
  assert.equal(wifiCode('Fox; "Quiz"'), 'WIFI:T:nopass;S:Fox\\; \\"Quiz\\";;');
  assert.equal(wifiCode('Quiz', 'pa;ss:word'), 'WIFI:T:WPA;S:Quiz;P:pa\\;ss\\:word;;');
});

// Decodes with zbar when it is installed (e.g. pacman -S zbar); skipped otherwise.
let zbar = true; try {execFileSync('zbarimg', ['--version'], {stdio: 'ignore'});} catch {zbar = false;}
test('QR codes decode back to their text', {skip: !zbar && 'zbarimg not installed'}, () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'qr-'));
  try {
    for (const text of ['PubQuiz', wifiCode('PubQuiz'), 'http://10.42.0.1', 'Pub quiz £5 ✓ ' + 'a'.repeat(60), 'b'.repeat(100), 'c'.repeat(170), 'd'.repeat(213)]) {
      const m = qrMatrix(text), n = m.length, scale = 4, size = (n + 8) * scale, rows = [];
      for (let y = 0; y < size; y++) rows.push(Array.from({length: size}, (_, x) => m[Math.floor(y / scale) - 4]?.[Math.floor(x / scale) - 4] ? 1 : 0).join(' '));
      const file = path.join(dir, 'code.pbm'); writeFileSync(file, `P1\n${size} ${size}\n${rows.join('\n')}\n`);
      assert.equal(execFileSync('zbarimg', ['-q', '--raw', file]).toString().replace(/\n$/, ''), text);
    }
  } finally {rmSync(dir, {recursive: true, force: true});}
});
