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
live, paused, revealed, revealing, buzz?, bingo?, clipGame?`, and after the reveal the solution fields.

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

Also: `/api/gowide` (word snake help), `/api/away` `{question, state}` (the player left the app mid-question; the desk
sees it), `/api/team/sound`, `/api/team/photo` (JPEG body), `/api/team/result` (signed result after a live quiz),
`GET /api/leaderboard`.

The server checks every answer against the question and its timing; clients only shape the value.

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

## Compatibility rules

1. Add fields; don't rename or remove them. Bump `protocol` if you must.
2. Gameplay rules live in `server/` only. A client feature that needs a rule needs a server field.
3. Every protocol change gets a test in `tests/protocol.test.js` (and the player/desk tests it touches).
