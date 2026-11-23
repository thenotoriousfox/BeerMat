// A shared theme's TV and app pictures, drawn here by BeerMat Desk's own Qt TV and app mock (native/beermat_desk/
// previews.py, no screen needed), so every theme in the library has them, whoever added it. Needs Python with PySide6
// (QT_PYTHON, default python3); qtPreviews() fails at start-up without it and the service runs without these pictures.
import {mkdtempSync, mkdirSync, writeFileSync, rmSync} from 'node:fs';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {checkTheme} from '../shared/theme-bundle.js';

const run = promisify(execFile);
const native = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'native');

export async function qtPreviews(python = process.env.QT_PYTHON || 'python3') {
  await run(python, ['-c', 'import PySide6.QtQuick'], {timeout: 30000});   // fails now, at start-up, if Qt isn't there
  return async bundle => {
    const theme = checkTheme(bundle), dir = mkdtempSync(path.join(os.tmpdir(), 'beermat-qt-preview-'));
    try {
      for (const [file, bytes] of theme.files) {mkdirSync(path.dirname(path.join(dir, theme.id, file)), {recursive: true}); writeFileSync(path.join(dir, theme.id, file), bytes);}
      const {stdout} = await run(python, ['-m', 'beermat_desk.previews', dir, theme.id, theme.name], {cwd: native, timeout: 90000, maxBuffer: 8 * 1024 * 1024,
        env: {...process.env, QT_QPA_PLATFORM: 'offscreen', XDG_CACHE_HOME: dir, XDG_RUNTIME_DIR: dir}});
      const pictures = JSON.parse(stdout);
      return {tv: Buffer.from(pictures.tv, 'base64'), app: Buffer.from(pictures.app, 'base64')};
    } finally {
      rmSync(dir, {recursive: true, force: true});
    }
  };
}
