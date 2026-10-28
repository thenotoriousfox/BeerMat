// A BeerMat Online for the native desk's tests, on a temporary database: prints {port} when ready, then takes one
// command per line on its input: "link <email> <venue id>" makes that account the venue's operator (as BeerMat does
// by hand once it has checked). Stops when its input closes.
import {mkdtempSync, rmSync} from 'node:fs';
import {createInterface} from 'node:readline';
import path from 'node:path';
import os from 'node:os';
import {createService} from '../../online/service.js';

const dir = mkdtempSync(path.join(os.tmpdir(), 'beermat-online-'));
const service = createService({database: path.join(dir, 'online.sqlite')});
await new Promise(r => service.server.listen(0, '127.0.0.1', r));
service.importVenues({venues: [{id: 'red-lion-bristol', name: 'The Red Lion', town: 'Bristol'}]});
console.log(JSON.stringify({port: service.server.address().port}));
createInterface({input: process.stdin}).on('line', line => {
  const [command, email, venue] = line.trim().split(/\s+/);
  if (command === 'link') service.db.prepare('UPDATE venues SET owner=(SELECT id FROM accounts WHERE email=?) WHERE id=?').run(email, venue);
  console.log(JSON.stringify({done: command}));
}).on('close', async () => {await new Promise(r => service.server.close(r)); rmSync(dir, {recursive: true, force: true}); process.exit(0);});
