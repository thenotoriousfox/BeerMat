import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {parseSqRound, parseQuickQuestion} from '../sqimport.js';
import {validateQuestion} from '../model.js';

const round = body => `﻿d><?xml version="1.0" encoding="utf-8"?><round>${body}</round>`;
test('SpeedQuizzing round files map to PubQuiz formats', () => {
  const buzz = parseSqRound(round('<game>Buzzin</game><game_variation>Advanced</game_variation><title>Generated from SQQM</title><points_per_question>4</points_per_question><questions><question><q>Largest ocean? </q><long_answer>Pacific &amp; nothing else</long_answer></question></questions>'), 'Ocean night.sqb');
  assert.equal(buzz.title, 'Ocean night');
  assert.deepEqual(buzz.questions[0], {text: 'Largest ocean?', points: 4, answerNote: '', type: 'buzzer', variation: 'advanced', seconds: 60, answer: 'Pacific & nothing else', agreePoints: 2});
  const keypad = parseSqRound(round(`<game>Quizsentials</game><title>Keys</title><points_per_question>3</points_per_question><speed_bonus>true</speed_bonus><questions>
    <question><user_view>multi</user_view><q>Pick the even one</q><short_answer>B</short_answer><options><option>3</option><option>4</option></options></question>
    <question><user_view>letters</user_view><q>Capital of France</q><short_answer>p</short_answer><long_answer>Paris</long_answer></question>
    <question><user_view>numbers</user_view><q>Sides on a hexagon</q><short_answer>6</short_answer></question>
    <question><user_view>letters</user_view><picture>pic.jpg</picture><q>Who is pictured</q><short_answer>Q</short_answer></question></questions>`));
  assert.deepEqual(keypad.questions.map(q => [q.type, q.answer, q.speedBonus]), [['choice', '4', 3], ['letter', 'P', 3], ['number', '6', 3], ['letter', 'Q', 3]]);
  assert.equal(keypad.skipped.length, 1);
  const nearest = parseSqRound(round('<game>Nearest Wins</game><points_per_question>30</points_per_question><questions><question><q>Year of the moon landing</q><short_answer>1,969</short_answer></question></questions>'));
  assert.equal(nearest.questions[0].type, 'nearest'); assert.equal(nearest.questions[0].answer, '1969');
  assert.throws(() => parseSqRound('not xml'));
  const dir = mkdtempSync(path.join(os.tmpdir(), 'sq-'));
  try {for (const q of [...buzz.questions, ...keypad.questions, ...nearest.questions]) validateQuestion(q, dir);} finally {rmSync(dir, {recursive: true})}
});

test('Quick Question file names decode every documented form', () => {
  const q = (name, folder) => parseQuickQuestion(name, folder)?.question;
  assert.deepEqual(q('QQ_Best colour^^_Red_Blue_Green_B.txt'), {text: 'Best colour?', seconds: 30, points: 1, type: 'choice', options: ['Red', 'Blue', 'Green'], answer: 'Blue', answerNote: ''});
  assert.equal(q('QQ_Pick one_Up_Down_A_Because up is up.txt').answerNote, 'Because up is up');
  assert.deepEqual(q('QQ_Order these_One_Two_Three__.txt').items, ['One', 'Two', 'Three']);
  assert.deepEqual([q('QQ_A fruit_A_Apple.txt').type, q('QQ_A fruit_A_Apple.txt').answer], ['letter', 'A']);
  assert.equal(q('QQ_How many legs_8_8 legs.txt', 'QQFN Guesses').type, 'nearest');
  assert.equal(q('QQ_How many legs_8_8 legs.txt', 'QQFK Keypad').type, 'number');
  assert.deepEqual([q('QQ_Who sang it_Someone.txt', 'QQFC Classic').type, q('QQ_Who sang it_Someone.txt', 'QQFC Classic').variation], ['buzzer', 'classic']);
  assert.equal(q('QQ_Who sang it_Someone.txt').type, 'text');
  assert.deepEqual(q('QQV_Tea or coffee^^_Tea_Coffee.txt').options, ['Tea', 'Coffee']);
  assert.equal(q("QQ_Say ;;hi;; with ''quotes''_Yes.txt").text, 'Say :hi: with "quotes"');
  assert.deepEqual(parseQuickQuestion('QQ_Name this bird_Robin.jpg'), {question: {text: 'Name this bird', seconds: 30, points: 1, type: 'picture', answer: 'Robin'}, media: 'picture'});
  assert.equal(parseQuickQuestion('holiday.jpg'), null);
});
