# PubQuiz

Independent offline pub quiz system for a single CachyOS laptop. The laptop serves the quizmaster dashboard, phone clients, local picture/audio files and leaderboard. SQLite stores team identities, questions, answers, scores and manual adjustments. No cloud, installed phone app, account service, CDN or runtime npm dependency is needed.

## Start locally

Install Node.js 24 or later. Initial OS package installation needs internet; quiz nights do not.

```bash
./scripts/setup.sh                 # preview packages; changes nothing
./scripts/setup.sh --install       # explicit package installation
./scripts/start.sh                 # prompts for a private 12+ character host key
```

Open **http://localhost:3000/host**. Players can use **http://LAPTOP-IP:3000/** before hotspot integration. The projector page is `/display`. The default database is `quiz.sqlite` beside the server; `QUIZ_DB`, `PORT` and `BIND` can override defaults. Keep the key private. The service deliberately uses local HTTP for captive portal compatibility; use only a trusted local quiz network. The hotspot is open Wi-Fi, so recovery codes and host credentials are not encrypted on air. Do not expose it to public internet or reuse an important password.

## Dedicated CachyOS Wi-Fi

**Network changes require the laptop owner's approval. These commands have not been run against your laptop.** A Wi-Fi adapter supporting AP mode is required. A single radio will usually disconnect from its current Wi-Fi network while hosting; internet is unnecessary.

1. Find the interface with `nmcli device status` (often `wlan0` or `wlp...`). Run `python scripts/hotspot.py check --interface wlan0` to inspect AP capability.
2. Start PubQuiz as your normal user, keeping the terminal open. Test the dashboard first.
3. Preview: `python scripts/hotspot.py up --interface wlan0 --ssid PubQuiz`.
4. After local approval: `sudo python scripts/hotspot.py up --interface wlan0 --ssid PubQuiz --apply`.
5. Connect phones to **PubQuiz**, keep the connection when told “no internet”, and enter a team name.
6. Stop after the quiz: `sudo python scripts/hotspot.py down --interface wlan0 --apply`. Reconnect your previous Wi-Fi profile through NetworkManager if necessary.

The dedicated NetworkManager profile has a manual 10.42.0.1/24 address, IPv6 disabled and autoconnect off. An isolated transient dnsmasq instance supplies DHCP and wildcard DNS. An interface-scoped nftables table redirects HTTP port 80 to 3000 and blocks forwarding in both directions. It does not flush existing firewall rules or enable internet sharing. The `up` script refuses existing PubQuiz resources, validates configuration and attempts rollback on failure. An existing host firewall may still require an interface-specific allow rule for UDP 53/67 and TCP 53/3000; inspect it rather than disabling it. Port 80 conflicts, subnet conflicts and adapter limits must be checked locally.

If startup fails, inspect `journalctl -u pubquiz-dnsmasq` and `sudo nft list table inet pubquiz`. Recovery commands, **only for resources created by this script**, are `sudo systemctl stop pubquiz-dnsmasq.service`, `sudo nft delete table inet pubquiz`, and `sudo nmcli connection delete PubQuiz-offline`. Down does not restore the prior profile automatically. Do not run two quiz hotspots at once.

Network configuration references: [NetworkManager settings](https://networkmanager.pages.freedesktop.org/NetworkManager/NetworkManager/nm-settings-nmcli.html), [dnsmasq manual](https://thekelleys.org.uk/dnsmasq/docs/dnsmasq-man.html).

## Captive portal and recovery

DNS and plain HTTP captive probes open registration. Automatic opening depends on the phone OS and is not guaranteed. HTTPS sites cannot be transparently redirected without certificate errors. The reliable fallback is opening **http://10.42.0.1** in a normal browser (including the `http://`). For direct access without redirection use **http://10.42.0.1:3000**.

Each new team receives an unguessable recovery code. It is saved in browser storage and shown under “Team recovery code”. Copy it before leaving a captive mini-browser: the normal browser has separate storage. Use the code to resume from another browser/device; names alone never grant team access. All tabs holding a team's code represent that same team; first accepted answer wins. Keep the code private. If a code is lost, the quizmaster can issue a new recovery code for the same team; this revokes the old code and preserves answers, drafts and scores.

Phones send a heartbeat by polling every 1.5 seconds. The dashboard flags teams after 15 seconds without a request and clears the flag when requests resume. Sleeping phones, background tabs and captive windows can also trigger warnings; a warning means unreachable, not cheating. No notification permission or external ping is needed.

## Gameplay and quizmaster dashboard

The dashboard has four screens: **Run quiz**, **Build quiz**, **Mark answers** and **Teams & results**. Use form controls to author and persist named rounds, reorder questions, upload local media, and run the quiz without editing JSON. Text and choice questions support automatic marking and optional speed bonuses. Answer sheets support keyed and manual per-item marking; paper rounds support printed sheets and score adjustments. The quizmaster can pause/resume, close early, reveal answers, moderate/recover teams, hide scores and finish/resume an event.

Players reconnect automatically and retain the same identity, final answers and drafts. They can also recover from another browser using their private code. A quizmaster can rotate a lost code without losing the team's score. The server enforces deadlines, schemas, first-answer locking and host permissions. Scores for an open/paused question are withheld until closure or expiry.

See the [complete quizmaster guide](docs/QUIZMASTER.md) for authoring, live play, scoring, recovery and backups. A [small demo quiz](examples/demo-quiz.json) is included for rehearsal; it uses simple instruction questions so you can test without writing a quiz first.

## Optional internet check

`./scripts/connectivity.sh` makes no request by default. `./scripts/connectivity.sh --check` explicitly checks whether the **laptop** can reach an external HTTPS URL (requires curl). It cannot prove that players have disabled mobile data. There is no automatic mobile-data policing: a web page cannot reliably inspect another network interface on a phone.

## Persistence and tests

Stop the server before copying `quiz.sqlite` for a consistent backup (or use a SQLite-aware backup tool). Keep backups private: the database contains team recovery secrets. To start a new event, stop the server and use a new `QUIZ_DB` path. Existing teams/scores remain in the old event file. Export JSON excludes recovery secrets; it is a results archive, not an importable database backup. Host logins are memory-only, expire after 12 hours, and must be repeated after restart. The application automatically migrates databases from the earlier prototype.

```bash
npm test
python -m unittest discover -s tests -p 'test_*.py'
bash -n scripts/setup.sh scripts/start.sh scripts/connectivity.sh
python scripts/hotspot.py up --interface wlan0  # dry run
```

For real browser tests, install the pinned development tooling and a Chromium binary while online, then run:

```bash
npm ci
npx playwright install chromium
npm run test:browser
```

Browser tooling is development-only. The quiz server itself still has no runtime dependencies and never needs this download during a quiz. The browser suite launches an isolated temporary quiz server and tests authoring, player registration/reconnection/drafts, pause/resume, text/choices/sheets, marking, media decoding/playback, projector view, recovery rotation, paper scoring and finish. It fails on browser JavaScript errors or external page requests.

See [audit and test limits](docs/AUDIT.md). Before a real event, test on the actual laptop with at least one Android and one iPhone: automatic portal and fallback URL; mini-browser to full-browser recovery; Wi-Fi off/on; phone sleep; server restart; duplicate/late answers; picture and audio; ten or more concurrent teams; firewall compatibility; stop and restore normal Wi-Fi. Physical AP/radio and real phone acceptance remain pending; automated gameplay and plan tests do not establish that the hotspot works on your hardware.
