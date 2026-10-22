// Plain-text logs in the app's logs folder, one line per event, started afresh past 5 MB (the previous file is kept
// as .1). The quizmaster can open the folder from the menu and send it when something goes wrong.
import {appendFileSync, mkdirSync, renameSync, statSync} from 'node:fs';
import path from 'node:path';

export function createLog(file, {limit = 5 * 1024 * 1024, echo = false} = {}) {
  mkdirSync(path.dirname(file), {recursive: true});
  return (...parts) => {
    const line = `${new Date().toISOString()} ${parts.map(p => p instanceof Error ? p.stack || p.message : typeof p === 'string' ? p : JSON.stringify(p)).join(' ')}\n`;
    try {
      try {if (statSync(file).size > limit) renameSync(file, file + '.1');} catch {}
      appendFileSync(file, line);
    } catch {}
    if (echo) process.stdout.write(line);
  };
}
