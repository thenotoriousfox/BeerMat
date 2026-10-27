// Admin jobs for PubQuiz Online, run on the server itself (there is no admin sign-up over the API):
//   node online/admin.js make-admin <email>        that account may verify venues through the API
//   node online/admin.js verify <venue id> [off]   a checked, real venue: its results count on public leaderboards
//   node online/admin.js operator <venue id> <email|off>   that account runs the venue: edits its profile, publishes
//                                                  its quiz nights, registers its quiz laptops (venues are only added
//                                                  through the venue list, venues.json)
//   node online/admin.js venues                    every venue: ✓ verified, and its operator
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
} else if (command === 'operator' && target && flag) {
  const account = flag === 'off' ? null : db.prepare('SELECT id FROM accounts WHERE email=?').get(flag.toLowerCase());
  if (flag !== 'off' && !account) console.log(`No account for ${flag}: they sign up in the PubQuiz Player app or on the desk first`);
  else {
    const changed = db.prepare('UPDATE venues SET owner=? WHERE id=?').run(account?.id ?? null, target).changes;
    console.log(changed ? `Venue ${target} ${account ? `is run by ${flag}` : 'has no operator now'}` : `No venue ${target}`);
  }
} else if (command === 'venues') {
  for (const v of db.prepare('SELECT v.id,v.name,v.town,v.postcode,a.email,v.verified FROM venues v LEFT JOIN accounts a ON a.id=v.owner ORDER BY v.verified,v.name').all())
    console.log(`${v.verified ? '✓' : ' '} ${v.id}  ${v.name}, ${v.town} ${v.postcode}  (${v.email || 'no operator'})`);
} else {
  console.log('Usage: node online/admin.js make-admin <email> | verify <venue id> [off] | operator <venue id> <email|off> | venues');
  process.exitCode = 2;
}
db.close();
