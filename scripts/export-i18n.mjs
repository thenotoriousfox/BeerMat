#!/usr/bin/env node
// Writes the phone and TV translations (web/i18n.js, the single source) into the native apps:
//   native/android/app/src/main/assets/i18n.json and native/ios/BeerMat/i18n.json
// as {"English text": ["Français", "Español"], …}. Run after changing web/i18n.js; the apps' tests check they match.
import {writeFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {translations} from '../web/i18n.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const json = JSON.stringify(translations, null, 1) + '\n';
for (const file of ['native/android/app/src/main/assets/i18n.json', 'native/ios/BeerMat/i18n.json']) writeFileSync(path.join(root, file), json);
console.log(`${Object.keys(translations).length} phrases written to the Android and iPhone apps`);
