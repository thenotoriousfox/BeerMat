# Prototype audit (2026-10-19)

Audited all six files on main before implementation. Repository metadata confirmed private. No AGENTS.md was present in the upstream tree.

* Teams, answers and scores were memory-only: restart lost everything.
* Reconnection retained no identity and team name uniqueness prevented rejoining.
* Repeated team:join on one socket left stale connected teams.
* New players received no current question; reconnecting hosts did not authenticate again.
* Answers had no question ID, server deadline, empty-answer guard or schema for choices.
* No SQLite, captive DNS/DHCP, AP integration, media, sheets, import/export or tests.
* Positive: host key was required, host actions checked authentication, UI used textContent rather than HTML for user text.

Implementation retains Node and browser clients but replaces volatile socket state with SQLite and authenticated HTTP polling. Node 24 built-ins provide HTTP, SQLite, cryptography and tests without runtime npm dependencies or CDN assets. Polling also works in constrained captive portal browsers and naturally resumes after missed requests.

# Validation boundary

API integration tests run against a real loopback HTTP server and a temporary SQLite database, including restart. Network scripts are tested as plans with mocked subprocesses. This environment has no NetworkManager, dnsmasq, nftables or Wi-Fi device, so AP activation, DHCP leases, firewall interactions and Android/iOS captive detection have NOT been live-tested. No user laptop configuration was changed. Use the acceptance checklist in README before a public quiz.

# Completed application validation

The form-based quiz desk now covers saved quiz/round authoring and question order, media upload/preview, start/next, pause/resume, close/reveal, projector modes, marking history, per-item sheet marks, paper adjustments, team moderation and recovery-code rotation. The server migrates earlier SQLite databases automatically. Registration locks, finish/resume, leaderboard visibility, accepted text alternatives and optional speed bonuses are persistent.

Validated locally:

- 10 Node integration tests, including saved-library revision conflicts, guarded question transitions, pause/restart, withheld live scores/keys, explicit reveal, sheet drafts and marks, recovery revocation, moderation, idempotent adjustments, marking absent answers, media signature checks/range requests and legacy-database migration.
- Four Python hotspot-plan tests, plus shell/JavaScript syntax and whitespace checks.
- A real Chromium 153 browser rehearsal, using desktop quizmaster/projector windows and a mobile-sized touch player context: authored all five formats through forms, uploaded/decoded a picture, uploaded/played WAV audio, joined through an OS probe URL, restored a draft on reload, simulated lost network/reconnection, paused/resumed, submitted text/choice/sheet answers, changed sheet marks, rotated/recovered team credentials, recorded a paper score, finished the quiz and restarted the server. Printable sheet content was checked with the native print call intercepted. No browser JavaScript errors or external page requests were observed.

`npm run test:browser` reproduces the browser suite with a locally installed Playwright browser. The test harness also accepts `PUBQUIZ_PLAYWRIGHT` (module path) and `PUBQUIZ_BROWSER` (Chromium executable path) for restricted development runners; these are not runtime requirements.

Real Android/iOS captive windows, Wi-Fi hardware, AP setup, OS firewall interactions, physical audio output and actual paper printing still require the laptop/device acceptance check. These are distinct from the completed application-code tests. GitHub Actions is outside this iteration's scope at the user's instruction.
