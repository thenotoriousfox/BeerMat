// Updates for BeerMat Desk, done by its quiz server so the desk window never blocks: check BeerMat's signed manifest
// (shared/update.js) for a newer version, and download the file for this kind of install into <data>/updates/,
// checking its size and SHA-256 on the way. The desk then installs it (native/beermat_desk/updates.py).
import {mkdirSync, createWriteStream, renameSync, rmSync, readdirSync, existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {readManifest, newer, fileUrl, updateKinds, DOWNLOADS, updatePublicKey} from '../shared/update.js';

export function createUpdates({dir, currentVersion, fetchImpl = globalThis.fetch, base = DOWNLOADS, publicKey = updatePublicKey}) {
  let downloading = null;

  async function latest() {
    const response = await fetchImpl(`${base}/latest.json`, {cache: 'no-store', signal: AbortSignal.timeout(15000)});
    if (!response.ok) throw Error(`BeerMat’s downloads answered ${response.status}`);
    const manifest = readManifest(await response.json(), {publicKey});
    if (!manifest) throw Error('The update information isn’t signed by BeerMat: not updating');
    return manifest;
  }

  // What's newer than this desk, if anything, and the file for this kind of install (none: download it by hand).
  async function check(kind) {
    const manifest = await latest(), available = newer(manifest.version, currentVersion);
    const file = updateKinds.includes(kind) && manifest.files[kind] || null;
    return {current: currentVersion, latest: manifest.version, available, released: manifest.released || null,
      file: available && file ? {name: file.name, size: file.size} : null, page: 'https://beermatquiz.co.uk/download/'};
  }

  // The newer version's file for this kind of install, checked; its path. One download at a time.
  async function download(kind) {
    if (downloading) return downloading;
    downloading = (async () => {
      const manifest = await latest(), file = manifest.files[kind];
      if (!newer(manifest.version, currentVersion)) throw Error('BeerMat Desk is up to date');
      if (!file) throw Error('There’s no update for this kind of install: download it from the website');
      mkdirSync(dir, {recursive: true});
      for (const old of readdirSync(dir)) if (old !== file.name) rmSync(path.join(dir, old), {force: true, recursive: true});
      const target = path.join(dir, file.name), partial = target + '.part';
      if (existsSync(target)) rmSync(target);
      const response = await fetchImpl(fileUrl(manifest, file, base), {signal: AbortSignal.timeout(30 * 60000)});
      if (!response.ok || !response.body) throw Error(`The download failed (${response.status})`);
      const hash = createHash('sha256'), out = createWriteStream(partial);
      let size = 0;
      try {
        for await (const chunk of response.body) {
          size += chunk.length;
          if (size > file.size) throw Error('The download is bigger than BeerMat released: not updating');
          hash.update(chunk);
          if (!out.write(chunk)) await new Promise(r => out.once('drain', r));
        }
        await new Promise((resolve, reject) => out.end(error => error ? reject(error) : resolve()));
        if (size !== file.size || hash.digest('hex') !== file.sha256) throw Error('The download doesn’t match what BeerMat released: not updating');
      } catch (error) {
        out.destroy(); rmSync(partial, {force: true});
        throw error;
      }
      renameSync(partial, target);
      return {version: manifest.version, path: target, name: file.name};
    })();
    try {return await downloading;} finally {downloading = null;}
  }

  return {check, download};
}
