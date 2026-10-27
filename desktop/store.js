// The desktop app's own settings (screens, port, first run) and its quizmaster key, in the user's data folder:
// %APPDATA%\PubQuiz on Windows, ~/.config/PubQuiz on Linux (the folder keeps the app's old name; main.js). Writes go to a temporary file first, so a crash or power
// cut never leaves half a settings file.
import {readFileSync, writeFileSync, renameSync, existsSync, mkdirSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
import path from 'node:path';

export function writeAtomic(file, data, mode = 0o600) {
  mkdirSync(path.dirname(file), {recursive: true});
  const temporary = `${file}.${process.pid}.tmp`;
  writeFileSync(temporary, data, {mode});
  renameSync(temporary, file);
}

export function createPrefs(file, defaults = {}) {
  let saved = {};
  try {saved = JSON.parse(readFileSync(file, 'utf8'));} catch {}
  if (!saved || typeof saved !== 'object' || Array.isArray(saved)) saved = {};
  return {
    get: () => ({...defaults, ...saved}),
    set(changes) {saved = {...saved, ...changes}; writeAtomic(file, JSON.stringify(saved, null, 2));},
  };
}

// The key unlocks the desk from a browser too (the fallback, or another device), so it is long and random. It is
// encrypted with the system keychain where Electron offers one (safeStorage: DPAPI on Windows, the Secret Service
// on Linux); otherwise it is a file only this user can read.
export function hostKey(file, crypt = null) {
  if (existsSync(file)) {
    const stored = readFileSync(file);
    if (stored.subarray(0, 4).toString() === 'enc:') return crypt.decrypt(stored.subarray(4));
    return stored.toString('utf8').trim();
  }
  const key = randomBytes(18).toString('base64url');
  writeAtomic(file, crypt ? Buffer.concat([Buffer.from('enc:'), crypt.encrypt(key)]) : key);
  return key;
}
