# BeerMat Online

The optional internet service for **player profiles, statistics and achievements across venues, venue pages and quiz
listings**. Quizzes never depend on it. It is a complete, tested reference implementation (`online/service.js`,
Node 22 + SQLite). It runs at **https://online.beermatquiz.co.uk** (an Oracle Cloud Always Free VM in London, set
up by `online/deploy.sh ubuntu@130.162.161.81 online.beermatquiz.co.uk`); the BeerMat app is built to use it. This document is the design and how it is
deployed.

## API (JSON over HTTPS, `/v1`)

Authentication: `Authorization: Bearer <token>` from sign-up or sign-in. No cookies, so no CSRF; CORS is allowed
only for the app (`capacitor://localhost`, `http(s)://localhost`) and origins listed in `ALLOWED_ORIGINS`.

| Method and path | Who | What |
|---|---|---|
| `POST /v1/accounts` `{email, password, displayName}` | anyone | create an account (password ≥ 10 characters) |
| `POST /v1/sessions` `{email, password}` · `DELETE /v1/sessions` | anyone · signed in | sign in (10 tries a minute per address and per email) · sign out |
| `POST /v1/verify` `{token}` · `POST /v1/me/verify` | anyone with the link · signed in | confirm the email address from the emailed link (a week, once) · send the link again |
| `POST /v1/password-reset` `{email}` · `POST /v1/password-reset/confirm` `{token, password}` | anyone | email a reset link (the same answer for unknown addresses) · set the new password (an hour, once; every device is signed out) |
| `POST /v1/reports` `{kind: "venue", target, reason}` | anyone | report a problem with a venue page (app: venue page → Report a problem) |
| `POST /v1/reports` `{kind: "profile", target, reason}` | anyone | report a player's name or picture on a leaderboard; `target` is the player's `ref` from `/v1/leaderboards` |
| `GET /v1/admin/reports[?all=1]` · `PATCH /v1/admin/reports/:id` `{resolved}` | admin | the admin console's Reports tab |
| `GET/PATCH /v1/me` | signed in | profile: display name, usual team name, picture (≤ 200 KB JPEG/PNG/WebP), privacy |
| `GET /v1/me/export` · `DELETE /v1/me` | signed in | everything held (access request) · erase the account and everything linked to it |
| `POST /v1/me/results` `{claim}` (+ `Idempotency-Key`) | signed in | keep a laptop-signed team result; the same one again is a no-op |
| `GET /v1/me/results` · `DELETE /v1/me/results/:event/:team` | signed in | kept results · forget one |
| `GET /v1/me/stats` | signed in | statistics and badges (registered venues only) |
| `GET/PUT/DELETE /v1/me/favourites[/:venue]` | signed in | saved venues |
| `GET /v1/venues` | anyone | every venue, for the app's map: public details and its next quiz night |
| `PATCH /v1/venues/:id` · `GET /v1/me/venues` | operator | edit the venue's profile (name, town, postcode, address, website, regular quiz nights, location) · the venues you run |
| `POST /v1/venues` · `DELETE /v1/venues/:id` · `POST /v1/venues/:id/operator` `{email}` | admin | add or remove a venue outside the venue list · link it to its operator's account (`{email: null}` unlinks) |
| `POST /v1/venues/:id/keys` `{publicKey}` | operator | register a quiz laptop (its key is on the desk under Past quizzes) |
| `PATCH /v1/admin/venues/:id` `{plan, planUntil}` | admin | set a venue's plan (see Plans) |
| `POST /v1/licence` (a request signed by the laptop) | a registered quiz laptop | a signed licence for its venue's plan |
| `POST /v1/venues/:id/events` · `PATCH/DELETE /v1/events/:id` | operator | publish, change, cancel a quiz night |
| `GET /v1/venues/:id` · `GET /v1/events?q=…|lat=…&lon=…&radiusKm=…` | anyone | venue page · upcoming quizzes by town, postcode area or location |
| `POST /v1/venue-results` (signed summary) | a registered laptop | results shared by the quizmaster (off by default) |
| `GET /v1/leaderboards[?venue=]` | anyone | players who opted in, from verified venues; each has a `ref` for reporting them, which doesn't reveal their account |
| `POST /v1/venues/:id/verify` | admin | mark a venue as checked |
| `GET /v1/admin/overview` · `GET /v1/admin/venues` · `GET /v1/admin/accounts?q=` | admin | the admin console's pages |
| `PATCH /v1/admin/accounts/:id` `{admin, removePhoto}` · `DELETE /v1/admin/accounts/:id` | admin | admin rights, remove a picture, delete an account |
| `GET /v1/venues.json` | anyone | every venue in `venues.json`'s format (the nightly copy) |

## Venues and the admin console

Venues don't add themselves: admins add them in the **admin console**, `https://<service>/admin` (sign in with an
admin account). It has three pages:

* **Overview**: venues (verified, with an operator, on the map), quizzes in the next week, accounts (new this week,
  admins), results kept, laptops registered and quizzes shared; when the server started, the database size and the
  last nightly backup (shown in amber when it is over 36 hours old).
* **Venues**: find and filter (not verified, no operator, not on the map, no quiz nights); add a venue; open one to
  edit its details, map position (📍 from its postcode) and regular quiz nights, mark it verified, link or unlink its
  operator's account, remove a quiz laptop, cancel a coming quiz night, see the results it has shared, or delete it.
* **Accounts**: find by email or name; make or remove admins (never yourself), remove a profile picture, delete an
  account (a venue it ran stays, without an operator).

The first admin is made on the server: they sign up (in the app, the web app or a desk's Venue tab), then
`sudo -u beermat env ONLINE_DB=/var/lib/beermat-online/online.sqlite /opt/node/bin/node /opt/beermat-online/online/admin.js make-admin <email>`.
After that, admins make other admins in the console.

A venue's id is made from its name and town (`the-red-lion-bristol`) and never changes. Its regular quiz nights (a day,
`monday`–`sunday`, and a 24-hour start time, at most one a day) publish themselves as quiz nights four weeks ahead (UK
time; topped up hourly and whenever the nights change), and players filter the map and listings by day. On the desk
the operator can cancel any single week, which stays cancelled; a quiz they publish themselves on the same day takes
that day's place; editing one week's details makes it their own; changing the regular nights moves the future ones
with them.

**Operators.** An admin links a venue to the account of whoever runs it (console, or
`node online/admin.js operator <venue id> <email>`). The operator then uses the desk's **Venue** tab: edit the venue's
profile, register the quiz laptop, publish and cancel quiz nights. They can't add, remove or take over other venues.

**`venues.json`.** Every night `.github/workflows/venues-backup.yml` copies the venues (`GET /v1/venues.json`) into
`venues.json` in this repository, checked by `shared/venues.js` and committed only when something changed; a copy that has
lost more than half the venues is refused for a person to look at. It is a public backup and the app's fallback when
the service can't be reached. To load venues from such a file (a new server, or a restore):
`node online/admin.js import venues.json` (venues added since are kept).

**The map.** The player app's Find a quiz tab shows every venue on an OpenStreetMap map (Leaflet, shipped in the
app; tiles from tile.openstreetmap.org, with attribution). Gold pins (with a question mark) have a regular quiz night or a
published one coming up; slate ones don't. Day buttons (Any day, Mon–Sun) show only venues with a quiz that day, and
filter the search listings too. Tapping a pin opens the venue's page. Offline, the app shows the last list it saw, or failing that the venue list straight from GitHub (once
the repository is public). OpenStreetMap's tile servers are for light use: with many players, switch to a tile
provider's plan.

## Plans: BeerMat Free and Pro

Players never pay. A venue has a plan, **free** or **pro** (with an end date, or none); laptops follow their venue's.

| | BeerMat Free | BeerMat Pro |
|---|---|---|
| Make, save, import and export quizzes, every round format | ✓ no limits | ✓ |
| Rehearse with simulated teams; real phones join only to test the connection | ✓ | ✓ |
| Host a live quiz with real teams playing | — | ✓ (up to 250 teams, the laptop's technical ceiling) |
| Spotify music rounds | — | ✓ |
| Shared buzzer library: see what's in it | ✓ | ✓ |
| Shared buzzer library: play, add, share and report clips | — | ✓ |
| On the map, in quiz listings and with a public venue page (app and website) | — | ✓ |
| Every round format, the TV, phones, hotspot, online quizzes, results | ✓ | ✓ |

* **The map is Pro only**: `/v1/venues`, `/v1/events`, public venue pages and favourites include only venues whose plan
  is Pro now, so a lapsed subscription drops off by itself. The operator and admins still see a Free venue, to get it
  ready. `venues.json` keeps every venue (it's also the import list) and marks Pro ones `"onMap": true`; the app's and
  the website's fallbacks show only those.
* **Setting a plan**: admin console → Venues → open a venue → **Plan** (Free, or Pro until a date, or with no end).
  `PATCH /v1/admin/venues/:id {plan, planUntil}`. Payments will set the same fields; nothing is charged yet.
* **Licences**: the laptop sends `POST /v1/licence` a request signed with its venue key (`kind: beermat.licence-request`,
  the time within 10 minutes), so it needs no sign-in, only to be registered with its venue. The service answers with a
  licence signed by its own key: plan, venue, this laptop's venue key, `paidUntil` and `expires`. A licence lasts until
  the plan ends (at most 31 days ahead, so it gets renewed) plus 14 days' grace for laptops that are rarely online.
* **On the laptop** (`shared/licence.js`): the licence is checked offline against the public key in the app, and only
  counts for the laptop it names. The desk's **Settings → Plan → Check my plan** fetches one; after that the laptop
  renews it by itself every 6 hours when online. Without a valid licence it is on Free.
* **The signing key** is kept off the repository: `~/.local/share/beermat/licence-key.txt` on the developer's machine
  and `/etc/beermat-online/licence-key.txt` on the server (`online/deploy.sh` copies it). Losing it means a new key
  pair and an app update with the new public key; anyone holding it can make Pro licences.
* The desktop app is plain JavaScript, so a determined user can edit it to host live without Pro. The licence keeps honest
  venues honest; what only the service provides (listings, verified leaderboards, shared results) can't be faked.

## The shared buzzer library

Venues on Pro share short buzzer clips with each other from the desk (**Settings → Sounds → Shared buzzer library**).

* **Seeing it is public**: `GET /v1/buzzers?q=` lists names and lengths (never who shared a clip), so a Free desk sees
  what Pro would give it.
* **Everything else is Pro, by laptop**: each call carries a request signed with the laptop's venue key, like a licence
  request, so it needs no sign-in: `kind` `beermat.buzzer-upload` (`POST /v1/buzzers`, with `name`, the audio's
  `sha256`, `rights: true` and the base64 audio beside the request), `beermat.buzzer-get` (`POST /v1/buzzers/:id/audio`),
  `beermat.buzzer-report` (`POST /v1/buzzers/:id/report`, with `reason`) and `beermat.buzzer-remove`
  (`POST /v1/buzzers/:id/remove`, the sharing venue only, whatever its plan now). The time must be within 10 minutes and
  the laptop's venue on Pro. A venue shares up to 30 clips a day.
* **Clips**: up to 2 MB in; ffmpeg on the server keeps 10 seconds at most, trims the silence, evens the loudness and
  stores a mono MP3 in the database. A clip the desk adds is saved on the laptop, so it plays offline.
* **Hosting, not choosing**: clips go up straight away; whoever shares one confirms they have the right to (the terms
  say so too). BeerMat doesn't check clips first. One report per venue per clip; when three venues have reported one it
  is hidden and `ADMIN_EMAIL` is told. In the admin console (**Buzzers**) an admin plays, hides, shows or removes a clip
  (either deals with its reports) and can stop a venue sharing, which removes every clip it shared. A copyright
  complaint to hello@ means removing the clip straight away.
* **BeerMat's own clips**: an admin adds clips from the console (`POST /v1/admin/buzzers {name, audio}`); they're
  anonymous like every other clip. Only add ones BeerMat has the right to share (CC0, public domain, its own), since
  choosing them makes BeerMat their publisher.

## Data model

| Table | Holds |
|---|---|
| `accounts` | id, email, password (scrypt), display name, usual team name, picture, privacy flags, admin flag |
| `sessions` | SHA-256 of each session token, account, expiry (30 days) |
| `venues`, `venue_keys` | operator (optional), name, town, postcode, address, website, quiz night, optional location, verified flag, whether it came from the venue list and which fields its operator changed; registered laptop keys |
| `events` | venue, title, start time, format, entry, details, cancelled |
| `results` | account, event, team reference, laptop key, the signed claim, date: one row per account/event/team |
| `venue_results` | signed summaries shared by registered laptops, one per laptop/event |
| `favourites` | account, venue |
| `shared_buzzers` | name, the venue and laptop key that shared it, the MP3, its length, when, hidden, removed (a removed clip keeps its row, without the audio) |

**Results are never trusted from players.** A claim is produced by the quiz laptop (`/api/team/result`) and signed
with its Ed25519 key (`shared/claims.js`); the service checks the signature, the shape and the numbers. Statistics and
achievements (`shared/achievements.js`) count only claims from laptops a venue has registered; public leaderboards only from
venues an admin has verified. Sending the same claim again, from a retry or a second phone, changes nothing.

**Identities stay apart.** A team is a quiz-night identity on the laptop; an account is an online identity. The
claim carries a one-way team reference (a hash of the event and team ids), never the team's recovery code. Several
accounts may keep the same team result (teams are groups of people).

## Privacy and UK GDPR

Built in:

* Guests: playing collects only the team name the players choose; nothing reaches BeerMat Online.
* Data minimisation: no phone numbers, birthdays or addresses; locations sent for a search are rounded on the phone
  and not stored.
* Everything public is opt-in and off by default: appearing on leaderboards, showing a picture, showing history.
* Consent at sign-up states what is kept and for how long (until the account is deleted).
* Access and portability: `GET /v1/me/export`; erasure: `DELETE /v1/me` (removes sessions, results, favourites,
  the account's venues and their shared results).
* Venue-shared results (team names, positions, points) are off by default on the desk and are sent only once the
  quizmaster switches sharing on.

Still needed before going live (organisational, not code):

* A privacy notice naming the controller, the lawful bases (contract for the account; consent for public display and
  pictures; legitimate interests for venue listings), retention, and how to complain to the ICO.
* ICO registration (data protection fee) for the operator.
* A data protection impact assessment is advisable (public leaderboards, pictures, location search).
* Age: the service is not aimed at children; add an age statement (13+ for UK GDPR consent) to sign-up and the store
  listings.
* Team names on venue-shared results can be personal data; quizmasters should tell the room when sharing is on.
* Retention for inactive accounts (for example, delete after 3 years without sign-in) and for `venue_results`.

## Deploying

`online/deploy.sh ubuntu@<server ip> [domain]` sets up a fresh Ubuntu server from this repository, and running it
again updates the service (the database is kept): Node.js 24, the service under systemd on 127.0.0.1:8080, Caddy
with Let's Encrypt HTTPS in front (on `<ip>.sslip.io` when there is no domain), ports 80/443 opened, 2 GB swap on
small servers, and a nightly database backup in `/var/backups/beermat-online` (14 kept). Copy those backups off the
server with `online/pull-backups.sh ubuntu@<server ip>` (to `~/BeerMatBackups`; `--daily` adds a systemd user timer
that does it every day). Admin jobs run on the server:
`sudo -u beermat env ONLINE_DB=/var/lib/beermat-online/online.sqlite /opt/node/bin/node /opt/beermat-online/online/admin.js venues`.

The live server: Oracle Cloud, UK South (London), VM.Standard.E2.1.Micro (1 OCPU, 1 GB), Ubuntu 24.04, public IP
130.162.161.81, SSH as `ubuntu`. Ports 80 and 443 are open in its subnet's Default Security List. The domain
`beermatquiz.co.uk` is at Cloudflare. The service's record is `A online 130.162.161.81`, DNS only (not proxied: Caddy
gets its own certificate); the domain itself is the website (`site/`, a Cloudflare Worker). The old address, https://130-162-161-81.sslip.io, still works for apps built before
the domain (v0.5.0 and earlier); a new IP only needs the A record changed.

What a deployment needs in general:

* Any host with Node 22.13+ (a small VPS or a container platform); no paid services are required.
  `PORT`, `BIND`, `ONLINE_DB`, `ALLOWED_ORIGINS` configure it: `node online/service.js`. On the live server
  `ALLOWED_ORIGINS=https://beermatquiz.co.uk,https://www.beermatquiz.co.uk` (in `/etc/beermat-online/env`) lets the
  website's Find a quiz page read `/v1/venues`.
* HTTPS in front (Caddy or nginx with Let's Encrypt). Bind the service to `127.0.0.1` behind the proxy.
* Back up `online.sqlite` (for example `sqlite3 online.sqlite ".backup …"` nightly, kept off the server).
* **Email** (confirming addresses, password reset) goes through [Resend](https://resend.com): put `RESEND_API_KEY=…`
  and `MAIL_FROM="BeerMat <noreply@your.domain>"` (a domain verified with Resend) in `/etc/beermat-online/env` on the
  server and restart the service. `PUBLIC_URL` (set by deploy.sh) is where the emailed links point: `/verify` and
  `/reset`, pages served by the service (`online/pages/`). Without email, sign-up still works, accounts stay
  unconfirmed, and password reset says it isn't set up.
* Before opening to the public: rate limiting at the proxy as well (the built-in limits are per process) and
  monitoring (an uptime check on `/health`).
* Point the app at it: `node mobile/scripts/build-web.mjs --online https://your.domain`, and quizmasters at it on
  the desk (**Past quizzes → BeerMat Online**).
* `LICENCE_KEY_FILE`: the Ed25519 key that signs BeerMat Pro licences (see Plans). Without it the service runs but
  `POST /v1/licence` answers 503.

## Tests

`tests/online.test.js` runs the real service on a temporary database: accounts and limits, privacy, export and
erasure, signed results (tampering, duplicates, registered and unregistered laptops, team-mates), stats and badges,
leaderboard consent, venue results, event publishing and search, CORS and static file containment, and the client's
offline outbox and cached listings. `tests/results.test.js` covers the laptop side (signing, the outbox, retries).
