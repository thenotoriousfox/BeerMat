// Writes latest.json, the signed update manifest (shared/update.js), for a release's files:
//   node scripts/update-manifest.mjs <folder with the release's files> <version> > latest.json
// The release key comes from UPDATE_KEY (base64 PKCS#8 Ed25519, the release workflow's secret) or UPDATE_KEY_FILE
// (default ~/.local/share/beermat/update-key.txt). The Android app's versionCode comes from native/android.
import {readFileSync, statSync, existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {signManifest, readManifest} from '../shared/update.js';

const [folder, version] = process.argv.slice(2);
if (!folder || !/^\d+\.\d+\.\d+$/.test(version || '')) {console.error('usage: node scripts/update-manifest.mjs <folder> <version>'); process.exit(2);}
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const key = (process.env.UPDATE_KEY || readFileSync(process.env.UPDATE_KEY_FILE || path.join(os.homedir(), '.local/share/beermat/update-key.txt'), 'utf8')).trim();
const versionCode = Number(/versionCode\s*=\s*(\d+)/.exec(readFileSync(path.join(root, 'native/android/app/build.gradle.kts'), 'utf8'))?.[1]);

const names = {
  'windows-installer': `BeerMat-Desk-Setup-${version}.exe`,
  'windows-zip': `BeerMat-Desk-${version}-win-x64.zip`,
  'linux-appimage': `BeerMat-Desk-${version}-linux-x64.AppImage`,
  'linux-tar': `BeerMat-Desk-${version}-linux-x64.tar.gz`,
  android: `BeerMat-${version}.apk`,
};
const files = {};
for (const [kind, name] of Object.entries(names)) {
  const file = path.join(folder, name);
  if (!existsSync(file)) {console.error(`No ${name}: ${kind} installs won't be offered this version`); continue;}
  files[kind] = {name, size: statSync(file).size, sha256: createHash('sha256').update(readFileSync(file)).digest('hex'), ...kind === 'android' && {versionCode}};
}
if (!Object.keys(files).length) {console.error('No release files found'); process.exit(1);}
const manifest = signManifest({version, released: new Date().toISOString(), files}, key);
if (!readManifest(manifest, process.env.UPDATE_PUBLIC_KEY ? {publicKey: process.env.UPDATE_PUBLIC_KEY} : {})) {console.error('The manifest doesn’t check out with the public key in shared/update.js: is UPDATE_KEY the release key?'); process.exit(1);}
process.stdout.write(JSON.stringify(manifest, null, 2) + '\n');
