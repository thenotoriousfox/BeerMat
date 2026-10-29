// The quiz library: a Pro venue's quiz laptop shares the quiz on its desk (pictures and sounds inside it) through a
// real BeerMat Online; nobody sees it until an admin approves it; then everyone sees what's in it (never the questions),
// Pro laptops download it (checked again) to load; three venues' reports hide it; BeerMat's own quizzes go straight in;
// a venue stopped from sharing loses its quizzes. shared/quiz-file.js's checks have their own test below.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync, mkdirSync, readFileSync} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createQuiz} from '../server/server.js';
import {createService} from '../online/service.js';
import {checkQuizFile} from '../shared/quiz-file.js';

const day = 86400000;
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const question = (text, extra = {}) => ({id: `q${Math.random().toString(36).slice(2, 8)}`, text, type: 'choice', seconds: 30, points: 1, options: ['Venus', 'Mars'], answer: 'Mars', ...extra});

test('quiz library: shared by Pro, approved by BeerMat, downloaded by Pro, hidden after three reports', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'quiz-lib-')), mails = [];
  let time = Date.now();
  const service = createService({database: path.join(dir, 'online.sqlite'), now: () => time, mail: async m => {mails.push(m);}, adminEmail: 'hello@beermat.test', publicUrl: 'https://online.test'});
  await new Promise(r => service.server.listen(0, '127.0.0.1', r));
  const online = `http://127.0.0.1:${service.server.address().port}`;
  const desk = async (name, plan) => {
    mkdirSync(path.join(dir, name), {recursive: true});
    const quiz = createQuiz({hostKey: 'a-secure-quiz-test-key', database: path.join(dir, name, 'quiz.sqlite'), mediaDir: path.join(dir, name, 'media'), packDir: dir, soundsDir: dir, plan, now: () => time});
    await new Promise(r => quiz.server.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${quiz.server.address().port}`;
    const host = (await (await fetch(base + '/api/login', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({key: 'a-secure-quiz-test-key'})})).json()).key;
    const call = async (route, body = {}) => {
      const response = await fetch(`${base}/api/host/${route}`, {method: 'POST', headers: {'Content-Type': 'application/json', Authorization: 'Bearer ' + host}, body: JSON.stringify(body)});
      return {status: response.status, ...await response.json()};
    };
    const upload = async (name, data) => (await (await fetch(`${base}/api/host/media?name=${name}`, {method: 'POST', headers: {'Content-Type': 'application/octet-stream', Authorization: 'Bearer ' + host}, body: data})).json()).media;
    await call('settings', {onlineService: online});
    return {quiz, call, upload, key: (await call('results')).venueKey};
  };
  const api = async (method, route, body, token) => {
    const response = await fetch(online + route, {method, headers: {'Content-Type': 'application/json', ...(token && {Authorization: 'Bearer ' + token})}, ...(body && {body: JSON.stringify(body)})});
    return {status: response.status, ...await response.json().catch(() => ({}))};
  };
  const [red, green, blue, gold] = await Promise.all([desk('red', 'pro'), desk('green', 'pro'), desk('blue'), desk('gold', 'pro')]);
  try {
    service.importVenues({venues: [{id: 'red-lion', name: 'The Red Lion', town: 'Bristol'}, {id: 'green-man', name: 'The Green Man', town: 'Bath'},
      {id: 'blue-bell', name: 'The Blue Bell', town: 'Bath'}, {id: 'gold-cup', name: 'The Gold Cup', town: 'Wells'}]});
    service.db.prepare("UPDATE venues SET plan='pro', plan_until=? WHERE id IN ('red-lion','green-man','gold-cup')").run(time + 30 * day);
    const register = (venue, key) => service.db.prepare('INSERT INTO venue_keys VALUES(?,?,?,?)').run(key.slice(-12), venue, key, time);
    register('red-lion', red.key); register('green-man', green.key); register('blue-bell', blue.key); register('gold-cup', gold.key);

    // The Red Lion writes a quiz with a picture round.
    const picture = await red.upload('flag.png', PNG);
    const saved = await red.call('library/save', {revision: 0, quiz: {title: 'Pub Classics', rounds: [
      {id: 'r1', title: 'General knowledge', questions: [question('Which planet is red?'), question('Which is closer to the Sun?')]},
      {id: 'r2', title: 'Flags', questions: [question('Whose flag is this?', {type: 'picture', media: picture, options: [], answer: 'Japan'})]}]}});
    assert.equal(saved.status, 200, JSON.stringify(saved));
    let listed = await red.call('quiz-library');
    assert.deepEqual([listed.pro, listed.quizzes, listed.current], [true, [], {title: 'Pub Classics', rounds: 2, questions: 3}]);

    // Sharing: Pro only, the box ticked.
    assert.match((await red.call('quiz-library/share', {rights: false})).error, /Tick the box/);
    assert.equal((await blue.call('quiz-library/share', {rights: true})).status, 403, 'Free can’t share');
    const shared = await red.call('quiz-library/share', {rights: true, description: 'Six easy rounds for a Tuesday.'});
    assert.equal(shared.status, 200, JSON.stringify(shared));
    assert.match(shared.id, /^q-[0-9a-f]{10}$/);
    assert.deepEqual([shared.title, shared.rounds, shared.questions, shared.review], ['Pub Classics', 2, 3, 'pending']);
    const id = shared.id;
    assert.match(mails.at(-1).subject, /Quiz waiting for a look: Pub Classics/);

    // Nobody sees it until BeerMat approves it; the laptop that shared it sees that it's waiting.
    assert.equal((await api('GET', '/v1/quizzes')).quizzes.length, 0);
    assert.deepEqual((await red.call('quiz-library')).shared.map(s => [s.title, s.status]), [['Pub Classics', 'pending']]);
    assert.equal((await green.call('quiz-library/download', {id})).status, 400, 'not downloadable while waiting');

    // The admin reads it in full (the picture inside it), turns it down with a note, then approves it.
    const admin = (await api('POST', '/v1/accounts', {email: 'admin@example.com', password: 'correct horse battery', displayName: 'Admin'})).token;
    service.db.prepare("UPDATE accounts SET admin=1 WHERE email='admin@example.com'").run();
    assert.equal((await api('GET', '/v1/admin/quizzes')).status, 401);
    const [row] = (await api('GET', '/v1/admin/quizzes', undefined, admin)).quizzes;
    assert.deepEqual([row.id, row.status, row.by, row.description], [id, 'pending', 'The Red Lion', 'Six easy rounds for a Tuesday.']);
    assert.equal((await api('GET', '/v1/admin/overview', undefined, admin)).pendingQuizzes, 1);
    const full = await api('GET', `/v1/admin/quizzes/${id}`, undefined, admin);
    assert.equal(full.quiz.rounds[1].questions[0].answer, 'Japan');
    assert.match(full.quiz.rounds[1].questions[0].media, /^data:image\/png;base64,/);
    await api('PATCH', `/v1/admin/quizzes/${id}`, {status: 'rejected', note: 'Round 2 needs more questions.'}, admin);
    assert.deepEqual((await red.call('quiz-library')).shared.map(s => [s.status, s.note]), [['rejected', 'Round 2 needs more questions.']]);
    await api('PATCH', `/v1/admin/quizzes/${id}`, {status: 'approved'}, admin);

    // Now anyone sees what's in it, but never the questions or answers.
    const [public1] = (await api('GET', '/v1/quizzes')).quizzes;
    assert.deepEqual([public1.title, public1.by, public1.rounds, public1.questions, public1.formats], ['Pub Classics', 'The Red Lion', 2, 3, ['Multiple choice', 'Picture']]);
    assert.deepEqual(public1.outline.map(r => [r.title, r.questions]), [['General knowledge', 2], ['Flags', 1]]);
    assert.doesNotMatch(JSON.stringify(public1), /Which planet|Japan|Mars/);
    assert.equal((await api('GET', '/v1/quizzes?q=classic')).quizzes.length, 1);
    assert.equal((await api('GET', '/v1/quizzes?q=tuesday')).quizzes.length, 1, 'found by its description');
    assert.equal((await api('GET', '/v1/quizzes?q=cricket')).quizzes.length, 0);
    listed = await blue.call('quiz-library');
    assert.deepEqual([listed.pro, listed.quizzes.map(q => q.id)], [false, [id]], 'Free laptops browse it');

    // Downloading: Pro only; saved in the data folder, checked, with its picture inside, ready for the desk to load.
    assert.equal((await blue.call('quiz-library/download', {id})).status, 403);
    const got = await green.call('quiz-library/download', {id});
    assert.equal(got.status, 200, JSON.stringify(got));
    assert.deepEqual([got.title, path.basename(got.path)], ['Pub Classics', `${id}.json`]);
    const file = JSON.parse(readFileSync(got.path, 'utf8'));
    assert.equal(checkQuizFile(file).questions, 3);
    assert.deepEqual(Buffer.from(file.rounds[1].questions[0].media.split(',')[1], 'base64'), PNG);
    assert.deepEqual((await green.call('quiz-library')).downloaded, [id]);
    // Loading it works as loading any quiz file (the desk uploads its pictures first, as Load quiz file does).
    const media = await green.upload('flag.png', PNG);
    file.rounds[1].questions[0].media = media;
    assert.equal((await green.call('new-event', {questions: 'load', quiz: file})).status, 200);
    assert.equal((await green.call('library')).rounds[1].questions[0].answer, 'Japan');

    // Three venues' reports hide it.
    assert.equal((await blue.call('quiz-library/report', {id, reason: 'x'})).status, 403, 'reporting is Pro, as downloading');
    for (const venue of [green, gold, green]) assert.equal((await venue.call('quiz-library/report', {id, reason: 'Answers are wrong.'})).status, 200);
    assert.equal((await api('GET', '/v1/quizzes')).quizzes.length, 1, 'two venues so far (one reported twice)');
    await red.call('quiz-library/report', {id, reason: 'Testing.'});
    assert.equal((await api('GET', '/v1/quizzes')).quizzes.length, 0, 'hidden after the third venue');
    assert.match(mails.at(-1).subject, /hidden after 3 reports/);
    assert.ok((await api('GET', '/v1/admin/reports', undefined, admin)).reports.some(r => r.kind === 'quiz' && r.targetName === 'Pub Classics'));
    await api('PATCH', `/v1/admin/quizzes/${id}`, {hidden: false}, admin);
    assert.equal((await api('GET', '/v1/quizzes')).quizzes.length, 1);

    // BeerMat's own, added by an admin: straight into the library; a broken quiz says why.
    const ours = await api('POST', '/v1/admin/quizzes', {quiz: {title: 'Halloween Special', rounds: [{id: 'h1', title: 'Spooky', questions: [question('Who wrote Dracula?', {options: ['Stoker', 'Shelley'], answer: 'Stoker'})]}]}, description: 'For 31 October.'}, admin);
    assert.equal(ours.status, 201, JSON.stringify(ours));
    assert.equal(ours.by, 'BeerMat');
    assert.deepEqual((await api('GET', '/v1/quizzes')).quizzes.map(q => q.title).sort(), ['Halloween Special', 'Pub Classics']);
    const broken = await api('POST', '/v1/admin/quizzes', {quiz: {title: 'Bad', rounds: [{id: 'b1', title: 'R', questions: [question('Q', {media: '/media/missing.png', type: 'picture'})]}]}}, admin);
    assert.deepEqual([broken.status, broken.error], [400, 'Every picture and sound must be inside the quiz file: save it with Download quiz (with its pictures and sounds)']);

    // The venue takes its quiz back; a venue stopped from sharing loses its quizzes.
    assert.equal((await green.call('quiz-library/remove', {id})).status, 400, 'only the venue that shared it');
    assert.equal((await red.call('quiz-library/remove', {id})).status, 200);
    assert.deepEqual((await api('GET', '/v1/quizzes')).quizzes.map(q => q.title), ['Halloween Special']);
    const again = await red.call('quiz-library/share', {rights: true});
    assert.equal(again.status, 200);
    await api('POST', '/v1/admin/venues/red-lion/library', {banned: true}, admin);
    assert.equal((await api('GET', `/v1/quizzes/${again.id}`)).status, 'removed');
    assert.equal((await red.call('quiz-library/share', {rights: true})).status, 403);
  } finally {
    for (const d of [red, green, blue, gold]) await d.quiz.close();
    await service.close(); rmSync(dir, {recursive: true, force: true});
  }
});

test('a shared quiz is checked file by file: pictures and sounds inside it, and what they say they are', () => {
  const quiz = (media, type = 'picture') => ({title: 'T', rounds: [{id: 'r', title: 'R', questions: [question('Q', {type, media, options: [], answer: 'A'})]}]});
  const png = 'data:image/png;base64,' + PNG.toString('base64');
  const ok = checkQuizFile(quiz(png));
  assert.deepEqual([ok.title, ok.rounds, ok.questions, ok.media, ok.formats], ['T', 1, 1, 1, ['Picture']]);
  assert.equal(ok.quiz.rounds[0].questions[0].media, png, 'the picture stays inside it');
  assert.deepEqual(checkQuizFile(ok.quiz).quiz, ok.quiz, 'checking it again changes nothing');
  for (const [bad, reason] of [
    [null, /Not a BeerMat quiz file/], [[], /Not a BeerMat quiz file/],
    [quiz('/media/flag.png'), /must be inside the quiz file/],
    [quiz('https://tracker.example/x.png'), /must be inside the quiz file/],
    [quiz('data:text/html;base64,PGgxPg=='), /text\/html files can’t go in a shared quiz/],
    [quiz('data:image/png;base64,' + Buffer.from('<script>').toString('base64')), /says it’s image\/png but isn’t/],
    [quiz('data:image/png;base64,' + Buffer.concat([PNG, Buffer.alloc(9 * 1024 * 1024)]).toString('base64')), /over 8 MB/],
    [{title: 'T', rounds: []}, /no questions/],
    [{title: '', rounds: []}, /title/],
    [{title: 'T', rounds: [{id: 'r', title: 'R', questions: [{text: 'Q', type: 'nope', seconds: 30}]}]}, /Unknown question type/],
  ]) assert.throws(() => checkQuizFile(bad), reason);
});
