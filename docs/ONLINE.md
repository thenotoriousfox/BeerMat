# PubQuiz Online

The optional internet service for **player profiles, statistics and achievements across venues, venue pages and quiz
listings**. Quizzes never depend on it. It is a complete, tested reference implementation (`online/service.js`,
Node 22 + SQLite). It runs at **https://130-162-161-81.sslip.io** (an Oracle Cloud Always Free VM in London, set
up by `online/deploy.sh`); the PubQuiz Player app is built to use it. This document is the design and how it is
deployed.

## API (JSON over HTTPS, `/v1`)

Authentication: `Authorization: Bearer <token>` from sign-up or sign-in. No cookies, so no CSRF; CORS is allowed
only for the app (`capacitor://localhost`, `http(s)://localhost`) and origins listed in `ALLOWED_ORIGINS`.

| Method and path | Who | What |
|---|---|---|
| `POST /v1/accounts` `{email, password, displayName}` | anyone | create an account (password ≥ 10 characters) |
| `POST /v1/sessions` `{email, password}` · `DELETE /v1/sessions` | anyone · signed in | sign in (10 tries a minute per address and per email) · sign out |
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
| `POST /v1/venues/:id/events` · `PATCH/DELETE /v1/events/:id` | operator | publish, change, cancel a quiz night |
| `GET /v1/venues/:id` · `GET /v1/events?q=…|lat=…&lon=…&radiusKm=…` | anyone | venue page · upcoming quizzes by town, postcode area or location |
| `POST /v1/venue-results` (signed summary) | a registered laptop | results shared by the quizmaster (off by default) |
| `GET /v1/leaderboards[?venue=]` | anyone | players who opted in, from verified venues |
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
`sudo -u pubquiz env ONLINE_DB=/var/lib/pubquiz-online/online.sqlite /opt/node/bin/node /opt/pubquiz-online/online/admin.js make-admin <email>`.
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
`venues.json` in this repository, checked by `venues.js` and committed only when something changed; a copy that has
lost more than half the venues is refused for a person to look at. It is a public backup and the app's fallback when
the service can't be reached. To load venues from such a file (a new server, or a restore):
`node online/admin.js import venues.json` (venues added since are kept).

**The map.** The player app's Find a quiz tab shows every venue on an OpenStreetMap map (Leaflet, shipped in the
app; tiles from tile.openstreetmap.org, with attribution). Gold pins (with a question mark) have a regular quiz night or a
published one coming up; slate ones don't. Day buttons (Any day, Mon–Sun) show only venues with a quiz that day, and
filter the search listings too. Tapping a pin opens the venue's page. Offline, the app shows the last list it saw, or failing that the venue list straight from GitHub (once
the repository is public). OpenStreetMap's tile servers are for light use: with many players, switch to a tile
provider's plan.

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

**Results are never trusted from players.** A claim is produced by the quiz laptop (`/api/team/result`) and signed
with its Ed25519 key (`claims.js`); the service checks the signature, the shape and the numbers. Statistics and
achievements (`achievements.js`) count only claims from laptops a venue has registered; public leaderboards only from
venues an admin has verified. Sending the same claim again, from a retry or a second phone, changes nothing.

**Identities stay apart.** A team is a quiz-night identity on the laptop; an account is an online identity. The
claim carries a one-way team reference (a hash of the event and team ids), never the team's recovery code. Several
accounts may keep the same team result (teams are groups of people).

## Privacy and UK GDPR

Built in:

* Guests: playing collects only the team name the players choose; nothing reaches PubQuiz Online.
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
small servers, and a nightly database backup in `/var/backups/pubquiz-online` (14 kept). Admin jobs run on the server:
`sudo -u pubquiz env ONLINE_DB=/var/lib/pubquiz-online/online.sqlite /opt/node/bin/node /opt/pubquiz-online/online/admin.js venues`.

The live server: Oracle Cloud, UK South (London), VM.Standard.E2.1.Micro (1 OCPU, 1 GB), Ubuntu 24.04, public IP
130.162.161.81, SSH as `ubuntu`. Ports 80 and 443 are open in its subnet's Default Security List. Its address is
tied to the IP: a new IP means a new sslip.io address, so the app would need rebuilding (or a domain).

What a deployment needs in general:

* Any host with Node 22.13+ (a small VPS or a container platform); no paid services are required.
  `PORT`, `BIND`, `ONLINE_DB`, `ALLOWED_ORIGINS` configure it: `node online/service.js`.
* HTTPS in front (Caddy or nginx with Let's Encrypt). Bind the service to `127.0.0.1` behind the proxy.
* Back up `online.sqlite` (for example `sqlite3 online.sqlite ".backup …"` nightly, kept off the server).
* Before opening to the public: email verification and password reset (needs an email provider; not implemented),
  rate limiting at the proxy as well (the built-in limits are per process), monitoring, and an abuse/report route for
  venue pages and pictures.
* Point the app at it: `node mobile/scripts/build-web.mjs --online https://your.domain`, and quizmasters at it on
  the desk (**Past quizzes → PubQuiz Online**).
* Future paid plans would hang off `edition.js` and the account record; nothing is charged or enforced today.

## Tests

`tests/online.test.js` runs the real service on a temporary database: accounts and limits, privacy, export and
erasure, signed results (tampering, duplicates, registered and unregistered laptops, team-mates), stats and badges,
leaderboard consent, venue results, event publishing and search, CORS and static file containment, and the client's
offline outbox and cached listings. `tests/results.test.js` covers the laptop side (signing, the outbox, retries).
