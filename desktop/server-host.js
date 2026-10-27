// The quiz server inside the desktop app. It runs in its own process (Electron's utilityProcess, or a plain Node
// child in tests), apart from the windows: it alone opens the database and touches the network, and if it fails the
// app restarts it without losing the quiz. Settings come in through the environment; messages go both ways:
//   to the app:   {type: 'ready', port, publicPort, database}  {type: 'failed', message}  {type: 'ticket', id, ticket}
//                 {type: 'quit'} (Close BeerMat on the desk)  {type: 'backup', id, file | error}
//   from the app: {type: 'ticket', id}  {type: 'backup', id, folder}  {type: 'shutdown', stopWifi}
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createQuiz} from '../server/server.js';
import {createLaptop} from '../server/laptop.js';
import {prepareDatabase, backupDatabase} from './database.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const channel = process.parentPort
  ? {send: m => process.parentPort.postMessage(m), on: f => process.parentPort.on('message', e => f(e.data))}
  : {send: m => process.send?.(m), on: f => process.on('message', f)};
const env = process.env, data = env.BEERMAT_DATA;
const database = path.join(data, 'quiz.sqlite'), backups = path.join(data, 'backups');

// Phones on the quiz Wi-Fi are sent to the preferred port (3000); if something else already uses it, the next free one.
async function listen(server, ports, host) {
  for (const port of ports) {
    const ok = await new Promise(resolve => {
      const failed = e => {server.off('listening', done); resolve(e.code === 'EADDRINUSE' || e.code === 'EACCES' ? false : Promise.reject(e));};
      const done = () => {server.off('error', failed); resolve(true);};
      server.once('error', failed); server.once('listening', done);
      server.listen(port, host);
    });
    if (ok) return server.address().port;
  }
  throw Error(`Ports ${ports[0]}–${ports.at(-1)} are all in use`);
}

try {
  const prepared = prepareDatabase(database, backups);
  if (prepared.state !== 'ok' && prepared.state !== 'new') console.error(`Database ${prepared.state}: ${prepared.problem}; damaged file kept as ${prepared.kept}`);
  const packDir = path.join(data, 'soundpack');
  const laptop = ['linux', 'win32'].includes(process.platform) && env.BEERMAT_LAPTOP !== '0' ? createLaptop({root, packDir}) : null;
  const quiz = createQuiz({hostKey: env.HOST_KEY, database, mediaDir: path.join(data, 'media'), packDir, laptop, onQuit: () => channel.send({type: 'quit'})});
  const preferred = Number(env.PORT || 3000);
  const port = await listen(quiz.server, preferred ? [preferred, ...Array.from({length: 10}, (_, i) => preferred + 2 + i)] : [0], env.BIND || '0.0.0.0');
  const publicPort = await listen(quiz.publicServer, [0], '127.0.0.1');
  channel.on(async message => {
    if (message?.type === 'ticket') channel.send({type: 'ticket', id: message.id, ticket: quiz.newDeskTicket()});
    if (message?.type === 'backup') {
      try {channel.send({type: 'backup', id: message.id, file: backupDatabase(database, message.folder, {label: 'manual', keep: 1000})});}
      catch (e) {channel.send({type: 'backup', id: message.id, error: e.message});}
    }
    if (message?.type === 'shutdown') {
      // The quiz Wi-Fi comes down with the app (one more password prompt on Linux).
      if (message.stopWifi && laptop) try {if ((await laptop.wifi()).running) await new Promise(resolve => {try {laptop.stopWifi(resolve);} catch {resolve();}});} catch {}
      await quiz.close(); process.exit(0);
    }
  });
  channel.send({type: 'ready', port, publicPort, database, prepared});
  console.log(`BeerMat server ready on port ${port} (online tunnel port ${publicPort}); data in ${data}`);
} catch (e) {
  console.error(e);
  channel.send({type: 'failed', message: e.message});
  setTimeout(() => process.exit(1), 100);
}
