# PubQuiz Online

The optional internet service for **player profiles, statistics and achievements across venues, venue pages and quiz
listings**. Quizzes never depend on it. It is a complete, tested reference implementation (`online/service.js`,
Node 22 + SQLite); **it is not deployed anywhere**. This document is the design and what a deployment needs.

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
| `POST /v1/venues` · `PATCH/DELETE /v1/venues/:id` · `GET /v1/me/venues` | signed in (operator) | venue pages |
| `POST /v1/venues/:id/keys` `{publicKey}` | operator | register a quiz laptop (its key is on the desk under Past quizzes) |
| `POST /v1/venues/:id/events` · `PATCH/DELETE /v1/events/:id` | operator | publish, change, cancel a quiz night |
| `GET /v1/venues/:id` · `GET /v1/events?q=…|lat=…&lon=…&radiusKm=…` | anyone | venue page · upcoming quizzes by town, postcode area or location |
| `POST /v1/venue-results` (signed summary) | a registered laptop | results shared by the quizmaster (off by default) |
| `GET /v1/leaderboards[?venue=]` | anyone | players who opted in, from verified venues |
| `POST /v1/venues/:id/verify` | admin | mark a venue as checked (`node online/admin.js` for admins) |

## Data model

| Table | Holds |
|---|---|
| `accounts` | id, email, password (scrypt), display name, usual team name, picture, privacy flags, admin flag |
| `sessions` | SHA-256 of each session token, account, expiry (30 days) |
| `venues`, `venue_keys` | operator, name, town, postcode, address, website, optional location, verified flag; registered laptop keys |
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

## Deploying (requirements; nothing is running yet)

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
