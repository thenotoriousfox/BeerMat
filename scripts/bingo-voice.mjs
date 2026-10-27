#!/usr/bin/env node
// Records a spoken bingo caller with Piper (offline text-to-speech): one MP3 per number, bingo_voice/<n>.mp3, saying
// that number's call. The TV plays it each time the number is called.
//
//   node scripts/bingo-voice.mjs              calls from soundpack/bingo-calls.json → soundpack/bingo_voice/
//   node scripts/bingo-voice.mjs --builtin    BeerMat's own calls → sounds/bingo_voice/ (shipped with BeerMat)
//
// Numbers without a call in the file use BeerMat's own call. Options: --pack <sound pack folder>, --out <dir>, --python <Piper's python>,
// --model <voice .onnx>. Defaults: ~/.local/opt/piper/bin/python and the public-domain en_GB "cori" voice in
// ~/.local/share/piper. Run it again after changing the calls file; restart BeerMat to use the new recordings.
import {execFileSync} from 'node:child_process';
import {existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {bingoCallsFile} from '../web/soundnames.js';
import {bingoCall} from '../web/app.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2), option = (name, fallback) => {const i = args.indexOf(name); return i >= 0 ? args[i + 1] : fallback;};
const builtin = args.includes('--builtin'), pack = path.resolve(option('--pack', path.join(root, 'soundpack')));
const out = path.resolve(option('--out', builtin ? path.join(root, 'sounds', 'bingo_voice') : path.join(pack, 'bingo_voice')));
const python = option('--python', path.join(os.homedir(), '.local/opt/piper/bin/python'));
const model = option('--model', path.join(os.homedir(), '.local/share/piper/en_GB-cori-high.onnx'));
for (const [what, file] of [['Piper', python], ['voice', model]]) if (!existsSync(file)) {console.error(`${what} not found at ${file}. See docs/QUIZMASTER.md, "A spoken bingo caller".`); process.exit(1);}

// The same calls the TV shows: the pack's file where it has one, BeerMat's own otherwise. A call that doesn't say its
// number gets it added, as a caller would ("Kelly's eye, number one").
let fileCalls = {};
if (!builtin) try {fileCalls = JSON.parse(readFileSync(path.join(pack, bingoCallsFile), 'utf8').replace(/^﻿/, ''));} catch {}
const text = n => {
  const call = (Array.isArray(fileCalls) ? fileCalls[n - 1] : fileCalls[n])?.trim() || bingoCall(n);
  return new RegExp(`\\b${n}\\b`).test(call) ? call : `${call}, number ${n}`;
};
const lines = Array.from({length: 90}, (_, i) => [i + 1, text(i + 1)]);

const work = mkdtempSync(path.join(os.tmpdir(), 'bingo-voice-'));
try {
  // One Piper process for all 90, so the voice loads once.
  execFileSync(python, ['-c', `
import json, sys, wave
from piper import PiperVoice
voice = PiperVoice.load(sys.argv[1])
for n, text in json.load(sys.stdin):
    with wave.open(f"{sys.argv[2]}/{n}.wav", "wb") as w:
        voice.synthesize_wav(text, w)
`, model, work], {input: JSON.stringify(lines), stdio: ['pipe', 'inherit', 'inherit']});
  mkdirSync(out, {recursive: true});
  // Mono MP3s at an even loudness, with the silence trimmed from both ends.
  const trim = 'silenceremove=start_periods=1:start_threshold=-50dB,areverse,silenceremove=start_periods=1:start_threshold=-50dB,areverse';
  for (const [n] of lines) execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', path.join(work, `${n}.wav`), '-af', `${trim},loudnorm=I=-16:TP=-1.5`, '-ac', '1', '-ar', '44100', '-b:a', '64k', path.join(out, `${n}.mp3`)]);
} finally {rmSync(work, {recursive: true, force: true});}
console.log(`Bingo caller ready in ${path.relative(root, out) || out}: 90 calls, e.g. 22: "${text(22)}". Restart BeerMat to use it.`);
