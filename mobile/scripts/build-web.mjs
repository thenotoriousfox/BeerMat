// Gets mobile/www ready for Capacitor: copies the code it shares with the rest of PubQuiz into www/shared, and
// optionally bakes in the PubQuiz Online address.
//   node scripts/build-web.mjs [--online https://online.example]
import {copyFileSync, mkdirSync, writeFileSync} from 'node:fs';
import path from 'node:path';

const mobile = path.join(import.meta.dirname, '..'), repo = path.join(mobile, '..'), www = path.join(mobile, 'www');
mkdirSync(path.join(www, 'shared'), {recursive: true});
copyFileSync(path.join(repo, 'online', 'client.js'), path.join(www, 'shared', 'online-client.js'));
copyFileSync(path.join(repo, 'achievements.js'), path.join(www, 'shared', 'achievements.js'));
const at = process.argv.indexOf('--online');
if (at > 0) {
  const url = process.argv[at + 1] || '';
  if (url && !/^https:\/\/[^\s"'\\]+$/.test(url)) throw Error('--online needs an https:// address');
  writeFileSync(path.join(www, 'config.js'), `// Written by scripts/build-web.mjs.\nexport const onlineService = ${JSON.stringify(url)};\n`);
}
console.log('mobile/www ready' + (at > 0 ? ` (PubQuiz Online: ${process.argv[at + 1] || 'none'})` : ''));
