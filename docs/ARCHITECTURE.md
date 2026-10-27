# How BeerMat fits together

BeerMat is one quiz engine with several ways in. A single laptop runs a whole quiz with no internet. The internet is
only used for the things that cannot work without it: playing over a public link, and the optional BeerMat Online
profiles and quiz listings.

```
                   ┌───────────────────────── one laptop (offline core) ─────────────────────────┐
  Quizmaster ──────┤ Desktop app (Electron)          Quiz server (Node, server/)                  │
                   │  desk window ── /host ─────────▶ quiz engine, scoring, SQLite, media, sounds │
  TV/projector ────┤  TV window ──── /display ───────▶ live updates (SSE, WebSocket)               │
                   │                                  network: quiz hotspot / venue LAN / tunnel   │
                   └─────────────────────────────────────────▲─────────────────────────────────────┘
                                                             │ http://10.42.0.1 · http://192.168.x.y:3000 · https://….trycloudflare.com
  Phones ── browser ─────────────────────────────────────────┤  the same player page (player.html)
         └─ BeerMat app (Capacitor) ── opens that page┘
                                │  optional, when online
                                ▼
                   BeerMat Online (online/service.js): accounts, results signed by quiz laptops,
                   statistics, achievements, venues, quiz listings
```

## The offline core

Everything needed to run a quiz, with no internet and no accounts:

| Part | Files |
|---|---|
| Quiz engine, scoring, every round format | `server/server.js`, `server/model.js` |
| Team registration, recovery, transfer | `server/server.js` |
| SQLite storage (migrations run on start) | `server/server.js` (`node:sqlite`, Node 22.13+) |
| Desk, TV and player pages | `web/` (`host.html/js`, `display.html`, `player.html`, `client.js`, `app.js`, `style.css`, `i18n.js`) |
| Local networking | `server/laptop.js` (quiz hotspot, online tunnel), `server/network.js` (venue LAN), `scripts/hotspot.py` (Linux), `scripts/hotspot-windows.ps1` (Windows) |
| Results kept after each quiz | `server/results.js` (per-team results), `shared/claims.js` (signing), `event_results` table |
| Desktop app | `desktop/` |

Players never need an account or an app: the player page works in any phone browser. Results are worked out by the
server from its own marking (`server/results.js`) and kept on the laptop across quizzes (desk: **Past quizzes**).

## Optional online services

| Service | Where | Needs |
|---|---|---|
| Online quizzes over a public link | `server/laptop.js` (Cloudflare quick tunnel) | internet on the laptop, `cloudflared` |
| Player accounts and profiles | `online/service.js` | a deployed BeerMat Online |
| Results in profiles, statistics, achievements | `online/service.js`, `shared/achievements.js` | the same |
| Venue pages, quiz listings, favourites, reminders | `online/service.js`, `mobile/www` | the same |
| Results shared by venues | desk **Past quizzes → BeerMat Online**, sync outbox | the same, switched on by the quizmaster |
| Future licensing | `server/edition.js` (a seam only; nothing enforced) | — |

Nothing in the offline core waits for, or fails because of, an online service. Shared results wait in an outbox on
the laptop (`sync_outbox`), and a player's results wait on the phone (`online/client.js`), until the service can be
reached; sending twice never counts twice.

## Identities

* **A team** exists for one quiz on one laptop. It is identified by a private recovery code, held in the phone's
  browser storage. Teams are not people.
* **A player account** lives in BeerMat Online only. It is never needed to play, and the quiz laptop never sees it.
* **Linking the two** is the player's choice, after the quiz: the player page asks the laptop for the team's result,
  signed with the laptop's own key (`claims.js`); the player hands that to their profile. The claim holds a one-way
  team reference (not the recovery code), the team name, position, points and counts. Several players in one team can
  each keep the same result.

## Trust

* A result's numbers come only from a quiz laptop's signature; a player cannot type or alter them.
* A laptop key counts once a venue operator has registered it to their venue in BeerMat Online. Results from an
  unregistered laptop are kept but do not count towards statistics or achievements.
* Public leaderboards use only venues the service has verified, and only players who opted in.

## Repository layout

```
server/                  quiz server (Node): engine, storage, networking, Spotify, results
web/                     desk, TV and player pages and their browser code, served by the quiz server
shared/                  code used by the quiz server, BeerMat Online and the app: claims, achievements, venue checks
desktop/                 Electron app: main process, quiz server process, screens, data safety
mobile/                  BeerMat app: www/ (the app's own screens), android/, ios/ (Capacitor)
online/                  BeerMat Online service, its client, admin jobs
scripts/                 Linux launcher and hotspot, Windows hotspot, bingo caller and test-quiz tools
tests/                   node --test suites, Playwright browser/desktop/mobile runs, Python hotspot tests
docs/                    guides (this file, QUIZMASTER, DESKTOP, MOBILE, ONLINE, TESTING, AUDIT)
brand/                   logos, icons and the Fredoka font, with the scripts that draw them
sounds/ themes/          shipped sound effects, buzzers and TV/phone themes
examples/                example quiz files
build/                   desktop app icons for the installers
media/                   question pictures and audio, local only (gitignored)
venues.json              nightly copy of BeerMat Online's venue list; the app's fallback (stays here: apps fetch this path)
```
