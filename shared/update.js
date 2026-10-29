// BeerMat's update manifest: downloads.beermatquiz.co.uk/latest.json says which version is the latest and what each
// of its files is (name, size, SHA-256), signed with BeerMat's release key so an app only updates to files BeerMat
// released. The release workflow signs it (scripts/update-manifest.mjs, the UPDATE_KEY secret); the desk's quiz
// server checks it (server/updates.js) with the public key below. The Android app checks the file's SHA-256 and that
// the new app is signed as itself (Android refuses anything else anyway).
import {createPrivateKey, createPublicKey, sign, verify} from 'node:crypto';
import {canonical} from './claims.js';

export const updatePublicKey = 'MCowBQYDK2VwAyEAebZBtn7jVOAqloMdCMw9TYbJjqoNV8ew2XgFaedXh3A=';
export const DOWNLOADS = 'https://downloads.beermatquiz.co.uk';
// What each kind of install updates with.
export const updateKinds = ['windows-installer', 'windows-zip', 'linux-appimage', 'linux-tar', 'android'];
const fileName = /^[A-Za-z0-9][A-Za-z0-9._-]{0,120}$/;
const versionPattern = /^\d{1,4}\.\d{1,4}\.\d{1,4}$/;

export function signManifest(payload, privateKey) {
  const key = createPrivateKey({key: Buffer.from(privateKey, 'base64'), format: 'der', type: 'pkcs8'});
  const body = {v: 1, kind: 'beermat.update', ...payload};
  return {...body, sig: sign(null, Buffer.from(canonical(body)), key).toString('base64')};
}

// The manifest when it's genuine and well formed; otherwise null.
export function readManifest(manifest, {publicKey = updatePublicKey} = {}) {
  try {
    const {sig, ...body} = manifest;
    if (body.v !== 1 || body.kind !== 'beermat.update' || !versionPattern.test(body.version) || !body.files || typeof body.files !== 'object') return null;
    for (const [kind, f] of Object.entries(body.files))
      if (!updateKinds.includes(kind) || !fileName.test(f?.name) || !/^[0-9a-f]{64}$/.test(f.sha256) || !Number.isSafeInteger(f.size) || f.size <= 0) return null;
    const key = createPublicKey({key: Buffer.from(publicKey, 'base64'), format: 'der', type: 'spki'});
    return verify(null, Buffer.from(canonical(body)), key, Buffer.from(sig, 'base64')) ? body : null;
  } catch {return null;}
}

// Whether version a is newer than b ('0.5.10' > '0.5.9').
export function newer(a, b) {
  const x = String(a).split('.').map(Number), y = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
  return false;
}

// Where a manifest's file is: always under BeerMat's downloads, in its version's folder.
export const fileUrl = (manifest, file, base = DOWNLOADS) => `${base}/${manifest.version}/${encodeURIComponent(file.name)}`;
