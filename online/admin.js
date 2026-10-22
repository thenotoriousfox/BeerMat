// Admin jobs for PubQuiz Online, run on the server itself (there is no admin sign-up over the API):
//   node online/admin.js make-admin <email>        that account may verify venues through the API
//   node online/admin.js verify <venue id> [off]   a checked, real venue: its results count on public leaderboards
//   node online/admin.js venues                    venues waiting to be checked
// ONLINE_DB chooses the database (online.sqlite).
import {DatabaseSync} from 'node:sqlite';

const db = new DatabaseSync(process.env.ONLINE_DB || 'online.sqlite');
const [command, target, flag] = process.argv.slice(2);
if (command === 'make-admin' && target) {
  const changed = db.prepare('UPDATE accounts SET admin=1 WHERE email=?').run(target.toLowerCase()).changes;
  console.log(changed ? `${target} is now an admin` : `No account for ${target}`);
} else if (command === 'verify' && target) {
  const changed = db.prepare('UPDATE venues SET verified=? WHERE id=?').run(flag === 'off' ? 0 : 1, target).changes;
  console.log(changed ? `Venue ${target} ${flag === 'off' ? 'no longer verified' : 'verified'}` : `No venue ${target}`);
} else if (command === 'venues') {
  for (const v of db.prepare('SELECT v.id,v.name,v.town,v.postcode,a.email,v.verified FROM venues v JOIN accounts a ON a.id=v.owner ORDER BY v.verified,v.created').all())
    console.log(`${v.verified ? '✓' : ' '} ${v.id}  ${v.name}, ${v.town} ${v.postcode}  (${v.email})`);
} else {
  console.log('Usage: node online/admin.js make-admin <email> | verify <venue id> [off] | venues');
  process.exitCode = 2;
}
db.close();
