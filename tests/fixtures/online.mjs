// A BeerMat Online for the native apps' tests, on a temporary database: prints {port} when ready, then takes one
// command per line on its input, answering each with a line:
//   link <email> <venue id>   makes that account the venue's operator (as BeerMat does by hand once it has checked)
//   pro <venue id>            the venue on BeerMat Pro, approved and placed on the map (Bristol)
//   event <venue id> <title>  a quiz night three days from now
// Stops when its input closes.  node tests/fixtures/online.mjs [--bind 0.0.0.0]
import {mkdtempSync, rmSync} from 'node:fs';
import {createInterface} from 'node:readline';
import path from 'node:path';
import os from 'node:os';
import {createService} from '../../online/service.js';

const dir = mkdtempSync(path.join(os.tmpdir(), 'beermat-online-'));
const service = createService({database: path.join(dir, 'online.sqlite')});
const bind = process.argv.includes('--bind') ? process.argv[process.argv.indexOf('--bind') + 1] : '127.0.0.1';
await new Promise(r => service.server.listen(0, bind, r));
service.importVenues({venues: [{id: 'red-lion-bristol', name: 'The Red Lion', town: 'Bristol'}]});
console.log(JSON.stringify({port: service.server.address().port}));
createInterface({input: process.stdin}).on('line', line => {
  const [command, ...words] = line.trim().split(/\s+/);
  if (command === 'link') service.db.prepare('UPDATE venues SET owner=(SELECT id FROM accounts WHERE email=?) WHERE id=?').run(words[0], words[1]);
  if (command === 'pro') service.db.prepare("UPDATE venues SET plan='pro', plan_until=NULL, approved=1, lat=51.4545, lon=-2.5879, postcode='BS1 4DJ', address='1 King St' WHERE id=?").run(words[0]);
  if (command === 'event') service.db.prepare('INSERT INTO events(id,venue,title,starts,updated) VALUES(?,?,?,?,?)').run('ev' + Date.now(), words[0], words.slice(1).join(' '), Date.now() + 3 * 86400000, Date.now());
  console.log(JSON.stringify({done: command}));
}).on('close', async () => {await new Promise(r => service.server.close(r)); rmSync(dir, {recursive: true, force: true}); process.exit(0);});
