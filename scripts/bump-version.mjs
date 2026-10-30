// The version bump a release needs: node scripts/bump-version.mjs <patch|minor|major> [notes]
// Sets package.json and package-lock.json to the next version, the Android app's versionCode (+1) and versionName, the
// iPhone app's version and build number (native/ios), and adds a "Release x.y.z" entry to docs/NATIVE-MIGRATION.md (the
// notes given, or else the titles of the pull requests merged since the last release). Prints the new version. The New
// release workflow runs it.
import {execFileSync} from 'node:child_process';
import {readFileSync, writeFileSync} from 'node:fs';

const [bump = 'patch', notesGiven = ''] = process.argv.slice(2);
const root = new URL('..', import.meta.url).pathname;
const read = file => readFileSync(root + file, 'utf8'), write = (file, text) => writeFileSync(root + file, text);

const pkg = JSON.parse(read('package.json')), old = pkg.version;
const [major, minor, patch] = old.split('.').map(Number);
const version = {major: `${major + 1}.0.0`, minor: `${major}.${minor + 1}.0`, patch: `${major}.${minor}.${patch + 1}`}[bump];
if (!version) throw new Error(`Bump patch, minor or major, not "${bump}"`);

pkg.version = version;
write('package.json', JSON.stringify(pkg, null, 2) + '\n');
const lock = JSON.parse(read('package-lock.json'));
lock.version = version; lock.packages[''].version = version;
write('package-lock.json', JSON.stringify(lock, null, 2) + '\n');

const gradlePath = 'native/android/app/build.gradle.kts';
let gradle = read(gradlePath);
const code = Number(gradle.match(/versionCode = (\d+)/)?.[1]);
if (!code || !gradle.includes(`versionName = "${old}"`)) throw new Error(`${gradlePath} isn't on ${old}`);
gradle = gradle.replace(/versionCode = \d+/, `versionCode = ${code + 1}`).replace(`versionName = "${old}"`, `versionName = "${version}"`);
write(gradlePath, gradle);
// The iPhone app: the same version, and the Android versionCode as its build number (as the Release workflow builds it).
for (const file of ['native/ios/make-project.py', 'native/ios/BeerMat.xcodeproj/project.pbxproj']) {
  const text = read(file);
  if (!/MARKETING_VERSION = [\d.]+;/.test(text)) throw new Error(`${file} has no MARKETING_VERSION`);
  write(file, text.replace(/MARKETING_VERSION = [\d.]+;/g, `MARKETING_VERSION = ${version};`)
    .replace(/CURRENT_PROJECT_VERSION = \d+;/g, `CURRENT_PROJECT_VERSION = ${code + 1};`));
}

// The pull requests merged since the last release: each merge commit's body is its title.
let notes = notesGiven.trim();
if (!notes) {
  const titles = execFileSync('git', ['log', '--merges', '--format=%b%x00', `v${old}..HEAD`], {cwd: root, encoding: 'utf8'})
    .split('\0').map(t => t.trim().split('\n')[0]).filter(t => t && !/^Release \d/.test(t));
  notes = titles.length ? titles.join('; ') : 'fixes';
}
notes = notes.replace(/[.\s]+$/, '') + '.';
// Wrapped at 120 like the rest of the doc, newest first above the previous release.
const lines = [], words = `* **Release ${version}**: ${notes}`.split(/\s+/);
for (const word of words) {
  const last = lines.length - 1;
  if (last >= 0 && (lines[last] + ' ' + word).length <= 120) lines[last] += ' ' + word;
  else lines.push((last >= 0 ? '  ' : '') + word);
}
const docPath = 'docs/NATIVE-MIGRATION.md', doc = read(docPath), previous = `* **Release ${old}**`;
if (!doc.includes(previous)) throw new Error(`${docPath} has no "${previous}" entry to go above`);
write(docPath, doc.replace(previous, lines.join('\n') + '\n' + previous));
console.log(version);
