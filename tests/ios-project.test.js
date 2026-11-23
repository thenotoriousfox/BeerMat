// The iPhone app's Xcode project lists its Swift files by hand (native/ios/make-project.py writes it). A Swift file
// added to the app or to BeerMatKit without running make-project.py builds with `swift test` but not in Xcode, and
// only the Release workflow on macOS finds out (1.1.0's RelayServer.swift).
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import path from 'node:path';

const ios = path.join(import.meta.dirname, '..', 'native', 'ios');

test('every iPhone app and BeerMatKit Swift file is in the Xcode project', () => {
  const project = readFileSync(path.join(ios, 'BeerMat.xcodeproj', 'project.pbxproj'), 'utf8');
  const dirs = ['BeerMat', 'BeerMatKit/Sources/BeerMatKit'];
  const missing = dirs.flatMap(d => readdirSync(path.join(ios, d)).filter(n => n.endsWith('.swift'))
    .filter(n => !project.includes(`/* ${n} in Sources */`)).map(n => `${d}/${n}`));
  assert.deepEqual(missing, [], 'run python3 native/ios/make-project.py');
});
