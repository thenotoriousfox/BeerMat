# BeerMat client protocol (version 1)

What every BeerMat client relies on: the browser player (`web/player.html` + `client.js`), the TV page
(`display.html`), the desk (web `host.js` and the native desk in `native/`), and the native phone apps in progress.
The quiz server (`server/server.js`) is the only authority: it times, validates, scores and decides who may play.
Clients show its state and send what the player or quizmaster did; none of them works out a score or a deadline.

The protocol version is `1`. It goes up only for a change that would break an existing client; new fields alone
don't change it, so clients must ignore fields they don't know. Every state (`/api/state`, `/api/host/state`,
`/api/hello`) carries `protocol`.

## Transport

* Plain HTTP on the quiz laptop (`http://10.42.0.1:3000` on the quiz Wi-Fi, `http://<lan-ip>:3000` on a venue LAN), or
  HTTPS through the online link (Cloudflare quick tunnel). No internet is needed for local play: clients must not
  require it, and must allow cleartext to local addresses (Android `usesCleartextTraffic`, iOS
  `NSAllowsLocalNetworking`).
* Requests are `POST` with a JSON body (`Content-Type: application/json`) unless noted. Answers are JSON.
* Errors: a non-2xx status with `{"error": "<a sentence for the player>"}`. Clients show that sentence as is.
  `401` unknown or missing code, `403` not allowed now (rehearsal, waiting room, disabled team), `409` a conflict
  (name taken, registration closed, question moved on), `400` bad input, `429` too fast.
* Authentication: `Authorization: Bearer <secret>` (a team's recovery code, or a desk session key).

## Discovery

`GET /api/hello` (no authentication):

```json
{"app": "BeerMat", "protocol": 1, "build": "a1b2c3d4", "title": "Quiz night", "rehearsal": false, "registrationOpen": true}
```

How a client finds the server:

1. **QR code** on the TV: a URL (`http://10.42.0.1:3000/` or the LAN/online address), optionally preceded by a Wi-Fi
   QR (`WIFI:T:WPA;S:<ssid>;P:<password>;;`, or `WIFI:T:nopass;S:<ssid>;;`; see `web/qr.js`) for the quiz hotspot. Native apps join the Wi-Fi with the platform API
   (Android `WifiNetworkSuggestion`/`WifiNetworkSpecifier`, iOS `NEHotspotConfiguration`) and then the URL.
2. **Typed address** (the TV shows it).
3. **Recent quizzes** remembered on the phone.

A client calls `/api/hello` first and refuses anything that isn't `app: "BeerMat"` with a protocol it supports.
`build` changes whenever the server restarts with new code; the web pages reload on a change, native clients just
refetch state.

## Live updates

`GET /api/events?key=<secret>` is a server-sent event stream. Each event's `data` is a version number; the client
then fetches its whole state again (`/api/state` or `/api/host/state`). There are no partial updates to merge, so a
missed event costs nothing: clients also refetch on reconnect, on returning to the foreground, and every 15 s.
A WebSocket on the same path sends the same numbers (used online, where the tunnel holds SSE back). An open stream
counts as the team being *connected*.

## Joining and identity

`POST /api/join` `{"name": "The Quizzly Bears"}` → `{"id", "secret", "waiting", "rehearsal"?}`

* Name 2–40 characters, unique (case-insensitive), not blocked. Errors are sentences, as above.
* `secret` is the team's **recovery code**: the only credential. Keep it in secure storage (Android Keystore-backed
  `EncryptedSharedPreferences` / DataStore, iOS Keychain), keyed by server address and `event`. Show it to the team
  so another phone can take over (`POST /api/transfer` with a 4-digit code the desk issues, at most 10 tries a minute).
* `waiting: true`: the waiting room is on; state says so until the quizmaster admits the team.
* `rehearsal: true`: see below.
* Returning teams (PIN from an earlier quiz) and recovery are handled by the same pages; `/api/device` and
  `/api/device/continue` let a phone that played in the Wi-Fi sign-in window carry on in its normal browser.

## Player state

`POST /api/state` (Bearer secret) →

```jsonc
{
  "protocol": 1, "serverTime": 1761650000000, "build": "…", "event": "…",   // event changes for each new quiz
  "rehearsal": false,                     // the session is a rehearsal (TV badge)
  "settings": {…}, "look": {…}, "sounds": {…}, "view": "question",
  "team": {"id", "name", "sound", "photo", "photoStatus", "waiting"},
  "question": {…} | null,                 // the public question, below
  "answer": {"value", "points"?, "marks"?} | null,   // points only once marking is final
  "draft": … , "teams": [ {name, score, rank, …} ], "timer": …, "wheel": …
}
```

The **question** (`publicQuestion`) never carries the answer before the reveal:
`id, type, round, text, options?, items?, order?, grid?, tiles?, media?, points, seconds, deadline, remaining, open,
live, paused, revealed, revealing, buzz?, bingo?, clipGame?`, and after the reveal the solution fields. Newer, optional:

- `fiftyFifty`, `fiftyPoints` on `choice`: the team may take a 50/50 (`/api/fifty`); afterwards `fiftyRemoved` lists the choices to hide.
- `clipGame.played`: the clips heard so far (1-based, like `playing`), for a quizmaster playing one again.
- `held: true`: the quizmaster hasn't sent the question yet (Send Question). A team's copy then has an empty `text`,
  no `options`, `items`, `media` or grid, and `paused` is true; show "listen to the quizmaster" and build the inputs
  once a state without `held` arrives (same `id`).
- `text: ""` with `hideText` set: the wording stays off phones (and the TV) until the reveal.
- `fixedSix: true` on `choice`: show six buttons A–F, letters only. A letter past the last option is sent as `"#E"` or
  `"#F"` (a wrong answer); the others send their option as usual.
- `onTheFly: true` on `choice`: the options are only letters; show letter buttons.
- `reveal: "blur" | "tiles"`: the picture shows itself over the question's time (blurred, or under twelve tiles that
  go in the order of the web pages' `seededOrder(12, "tiles:" + id)`); sharp, or uncovered, once answers close.
- `reactionTable: {song, now: [{name, ms}], leaders: [{name, songs}]}` on music bingo with the reaction table.

**Timing**: `deadline` is server time. A client's countdown is `deadline - serverTime` measured at receipt, then
run on the local monotonic clock; it is only a display. The server decides lateness.

## Answering (one value per format)

`POST /api/answer` `{"question": <id>, "value": …}`; `POST /api/draft` the same, saved but not submitted.

| Format (`type`) | `value` |
|---|---|
| `text`, `picture`, `audio` | string |
| `choice`, `vote` | one of `options` (string) |
| `multi` | array of `options` strings |
| `letter` | one letter |
| `number`, `nearest` | number as string |
| `sequence` | array of item indexes in the chosen order (items are shown in `order`) |
| `tiles` | array of tile indexes |
| `wordsnake` | array of grid cell indexes along the path |
| `pinpoint` | `[[x, y]]`, each 0–1 across the picture |
| `sheet` | array of strings, one per item |
| `buzzer` | no value: `POST /api/buzz`, then `/api/agree` when offered |
| `bingo`, `musicbingo` | `POST /api/bingo` to claim |
| `clips` | `POST /api/tap` |

Also: `/api/react` `{question, title}` or `{question, pass: true}` (music bingo's reaction table: the team dabbed a
song on its ticket, one go per song played), `/api/gowide` (word trail's hint), `/api/fifty` `{question}` (multiple choice's 50/50; the team's state then has `fiftyRemoved`: the choices to hide), `/api/away` `{question, state}` (the player left the app mid-question; the desk
sees it), `/api/team/var` (`{question}`: VAR Check, the team appeals its marking of the question just revealed; the team's state has `myVar` `{left, status, points, canAsk}`, null when `settings.varCheck` is `off`; `left` is null for no limit; the TV's state has `varCheck` `{id, team, status, points, decided}` for a few seconds once ruled), `/api/team/name` (`{name}`: the team renames itself; join's checks), `/api/team/sound`, `/api/team/photo` (JPEG body), `/api/team/result` (signed result after a live quiz),
`GET /api/leaderboard`.

The server checks every answer against the question and its timing; clients only shape the value.

A client may add `X-Beermat-Rtt: <ms>` to `/api/state`: how long its previous request took. The desk's signal monitor
shows it. `/api/join` takes an optional `table` (1–500) when `askTable` is on (in `/api/hello` and the state's `settings`).

The Android and iOS apps handle all of these: a held question, letters-only choice, the picture reveal, the reaction
table, the table number at join and the round-trip header.

## Looks

Every state carries `look`: the id of the theme the quiz shows now (`stage` is BeerMat's own; it can change with each
question). A native app dresses itself in it as the TV and the browser do:

`GET /api/looks/<id>` (no authentication) → `{id, name, colours, phone}`:

* `colours`: the look's colour tokens as `look.css` names them (`--bg`, `--bg-2`, `--surface-solid`, `--text`,
  `--muted`, `--gold`, `--gold-hi`, `--pink`, `--cyan`, `--violet`, `--good`, `--bad`, `--on-accent`, `--line`), each
  `#rgb`, `#rrggbb`, `#rrggbbaa` or `rgb(a)(…)`. Tokens a look doesn't set keep the app's own; answer colours never
  change. Empty for `stage`.
* `phone`: `null`, or `{background: {gradient: [[at, colour], …]}, scene: [{image, x, bottom, width, height, opacity}]}`:
  a top-to-bottom background and pictures (`.png`, `.webp` or `.jpg` addresses on the quiz server) on a stage 390
  wide, scaled to the screen's width and placed from its bottom, behind the quiz.

Fetch it when `look` changes, not with every state. 404 means the look isn't on this laptop: keep the app's own.

## Handing a team to the browser

A native app that doesn't draw a round format opens the server's player page as `<server>/#team=<recovery code>`.
The page stores the code as its team, removes the fragment from the address, and plays on. The fragment never reaches
the server or its logs. Only a 48-character hex code is accepted (`tests/handover.browser.mjs`).

## Rehearsals and plans

The server decides whether the session is **live** (BeerMat Pro) or a **rehearsal** (always on Free, optional on
Pro). Clients never decide it and never check the plan.

* In a rehearsal a real phone that joins becomes a **test device**: the join answers `rehearsal: true`, and its
  `/api/state` is

  ```json
  {"protocol": 1, "question": null, "teams": [], "team": {"id", "name", "waiting": false},
   "rehearsal": {"device": true, "connected": true, "title": "…"}}
  ```

  Every other player route answers `403` ("This is a rehearsal: your phone is connected, but playing is switched
  off."). Clients show a branded *connected* screen: the connection works, playing is off.
* Simulated teams join with a one-time token only the server's own simulator has; nothing a phone sends can make it
  one.
* When the quizmaster goes live, the rehearsal is cleared (a new `event`): test devices must join again as teams.

## Desk API

`POST /api/login` `{"ticket"}` (native/Electron, one-time) or `{"key"}` (browser) → `{"key": <session>}`; then
`/api/host/*` with that session as Bearer and an `Origin` of the server itself. `/api/host/state` is the whole desk
state (`plan`, `rehearsal: {mode, canGoLive, options, sims, devices, log}`, `question` with private fields, `answers`,
`teams`, `board`, `timer`, …). Actions are the routes listed in `docs/NATIVE-MIGRATION.md` §2; each mutating call
that targets the current question carries `expectedQuestion` so a double press can't skip one.

### The phone deck

A phone hosting the quiz (Run the night in the Android app) uses the same `/api/host/*` routes, from the quiz Wi-Fi or
the venue's (the only host session allowed off the quiz Wi-Fi). `GET /api/deck/hello` → `{app, title, venueKey, code}`
(`code`: whether the desk is showing one). `POST /api/deck/login` `{name, ticket}` or `{name, code}` → `{key, title}`:
a ticket comes from BeerMat Online (`POST /v1/deck-tickets {venueKey}`, for the venue's own account or an admin; signed
with the licence key, bound to that laptop, five minutes); a code is six digits from the desk (`deck-code`), once, five
minutes. `/api/host/state` adds `nextStep` (what the desk's Next does), `decks` (phones signed in: `{id, name, since,
how}`), `deskConnected` and `deckCommand`. Clips, songs, bingo calls and audio play from the laptop, so a phone asks the
desk: `deck-command {action: callNumber|playClips|playClip|stopClips|playAudio|pauseAudio, value}` (409 with no desk
open); the Qt desk (its `/api/events?…&desk=1` stream) carries it out. The desk takes a phone off with `deck/disconnect
{id}`.

The same in a phone's browser, with no app: the laptop serves `/deck` (and `/deck.js`) on the quiz Wi-Fi and the venue's,
signing in with the desk's code; the desks show its address as a QR code beside the code.

## Compatibility rules

1. Add fields; don't rename or remove them. Bump `protocol` if you must.
2. Gameplay rules live in `server/` only. A client feature that needs a rule needs a server field.
3. Every protocol change gets a test in `tests/protocol.test.js` (and the player/desk tests it touches).
