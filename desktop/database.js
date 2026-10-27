// Looking after the quiz database between runs: a checked copy each time the app starts (kept in backups/, newest
// ten), and recovery from the newest good copy if the file is damaged. The damaged file is kept beside it, never
// deleted. Restoring a backup the quizmaster picks goes through the same checks.
import {DatabaseSync} from 'node:sqlite';
import {existsSync, mkdirSync, readdirSync, renameSync, copyFileSync, unlinkSync, statSync} from 'node:fs';
import path from 'node:path';

const stamp = time => new Date(time).toISOString().replace(/[:.]/g, '-').slice(0, 19);
const sidecars = file => [file, file + '-wal', file + '-shm'];

// A BeerMat database that SQLite reads without errors.
export function checkDatabase(file) {
  let db;
  try {
    db = new DatabaseSync(file, {readOnly: true});
    if (db.prepare('PRAGMA quick_check').get()?.quick_check !== 'ok') return 'The file is damaged';
    if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='metadata'").get()) return 'This is not a BeerMat database';
    return null;
  } catch (e) {return e.code === 'ERR_SQLITE_ERROR' ? 'The file is damaged or not a database' : e.message;} finally {try {db?.close();} catch {}}
}

export function backupDatabase(file, folder, {now = Date.now, keep = 10, label = 'start'} = {}) {
  mkdirSync(folder, {recursive: true});
  const target = path.join(folder, `quiz-${stamp(now())}-${label}.sqlite`);
  if (existsSync(target)) unlinkSync(target);
  const db = new DatabaseSync(file);
  try {db.prepare('VACUUM INTO ?').run(target);} finally {db.close();}
  const old = listBackups(folder).slice(keep);
  for (const b of old) try {unlinkSync(b.file);} catch {}
  return target;
}

export const listBackups = folder => {
  try {
    return readdirSync(folder).filter(f => /^quiz-.*\.sqlite$/.test(f)).map(f => ({file: path.join(folder, f), time: statSync(path.join(folder, f)).mtimeMs}))
      .sort((a, b) => b.time - a.time || b.file.localeCompare(a.file));
  } catch {return [];}
};

// Before the quiz server opens the database. Returns what happened, for the log and for telling the quizmaster.
export function prepareDatabase(file, folder, {now = Date.now} = {}) {
  if (!existsSync(file)) return {state: 'new'};
  const problem = checkDatabase(file);
  if (!problem) return {state: 'ok', backup: backupDatabase(file, folder, {now})};
  const kept = `${file}.damaged-${stamp(now())}`;
  for (const f of sidecars(file)) if (existsSync(f)) renameSync(f, f.replace(file, kept));
  const good = listBackups(folder).find(b => !checkDatabase(b.file));
  if (good) copyFileSync(good.file, file);
  return {state: good ? 'recovered' : 'reset', problem, kept, from: good?.file || null};
}

// Replaces the quiz database with a chosen backup (the server must be stopped). The current one is backed up first.
export function restoreDatabase(source, file, folder, {now = Date.now} = {}) {
  const problem = checkDatabase(source);
  if (problem) throw Error(problem);
  if (existsSync(file) && !checkDatabase(file)) backupDatabase(file, folder, {now, label: 'before-restore'});
  for (const f of sidecars(file)) if (existsSync(f)) unlinkSync(f);
  copyFileSync(source, file);
}
