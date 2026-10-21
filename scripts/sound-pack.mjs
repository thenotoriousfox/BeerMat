#!/usr/bin/env node
// Builds this laptop's sound pack from a SpeedQuizzing installation: its Sounds folder is copied as-is into soundpack/
// (same layout: general/, buzzers/<pack>/, Themes/), with its bingo calls file alongside. soundpack/ is not part of the
// git repository; PubQuiz uses it by default, ahead of the CC0 sounds it ships in sounds/.
//
//   node scripts/sound-pack.mjs ["~/SpeedQuizzing Documents"] [--out soundpack]
//
// Running it again replaces the pack. Sounds chosen on the quiz desk still override it.
import {copyFileSync, cpSync, existsSync, mkdtempSync, readdirSync, renameSync, rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {slotFiles, skippedBuzzerPacks, bingoCallsFile} from '../soundnames.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2), outAt = args.indexOf('--out');
const out = path.resolve(outAt >= 0 ? args.splice(outAt, 2)[1] : path.join(root, 'soundpack'));
const source = path.resolve(args[0] || process.env.SQ_DOCUMENTS || path.join(os.homedir(), 'SpeedQuizzing Documents'));
if (!existsSync(path.join(source, 'Sounds'))) {console.error(`No SpeedQuizzing sounds found in ${source}. Pass the "SpeedQuizzing Documents" folder.`); process.exit(1);}

// The spoken bingo caller (scripts/bingo-voice.mjs) isn't from SpeedQuizzing, so it is kept.
const voice = path.join(out, 'bingo_voice'), kept = existsSync(voice) && path.join(mkdtempSync(path.join(path.dirname(out), '.voice-')), 'bingo_voice');
if (kept) renameSync(voice, kept);
rmSync(out, {recursive: true, force: true});
cpSync(path.join(source, 'Sounds'), out, {recursive: true});
if (kept) {renameSync(kept, voice); rmSync(path.dirname(kept), {recursive: true, force: true});}
const calls = path.join(source, 'Bingo', bingoCallsFile);
if (existsSync(calls)) copyFileSync(calls, path.join(out, bingoCallsFile));

// Report what PubQuiz will pick up from it.
const effects = Object.values(slotFiles).filter(names => names.some(name => existsSync(path.join(out, 'general', name + '.mp3')))).length;
const packs = readdirSync(path.join(out, 'buzzers'), {withFileTypes: true}).filter(e => e.isDirectory() && !skippedBuzzerPacks.test(e.name))
  .map(e => ({name: e.name, sounds: readdirSync(path.join(out, 'buzzers', e.name)).filter(f => /\.(mp3|ogg|wav)$/i.test(f)).length})).filter(p => p.sounds);
const buzzers = packs.reduce((n, pack) => n + pack.sounds, 0);
console.log(`Sound pack ready in ${path.relative(root, out) || out}: ${effects} of ${Object.keys(slotFiles).length} sound effects, ${buzzers} buzzer sounds from ${packs.map(p => p.name).join(', ') || 'no packs'}${existsSync(calls) ? ', bingo calls' : ''}. Restart PubQuiz to use it.`);
