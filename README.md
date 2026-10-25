# PubQuiz

Independent offline pub quiz system for a single CachyOS laptop. The laptop serves the quizmaster dashboard, phone clients, local picture/audio files and leaderboard. SQLite stores team identities, questions, answers, scores and manual adjustments. No cloud, installed phone app, account service, CDN or runtime npm dependency is needed. (Optional exception: music rounds can play from the laptop's Spotify app for private quizzes, which needs internet on the laptop; see docs/QUIZMASTER.md.)

## Start locally

Install Node.js 22.13 or later (setup keeps a Node that is already installed). Initial OS package installation needs internet; quiz nights do not.

```bash
./scripts/setup.sh                 # preview packages; changes nothing
./scripts/setup.sh --install       # explicit package installation
./scripts/start.sh                 # prompts for a private 12+ character host key
```

**From the app menu (no terminal):** `./scripts/setup.sh --install` (or just `--app`) adds a **PubQuiz** icon to the app menu. It asks for the quizmaster key in a window, starts PubQuiz in the background and opens the quiz desk already unlocked; clicking it again while PubQuiz runs just reopens the desk. The desk's **Quiz night** panel starts and stops the quiz Wi-Fi (your laptop password is asked for each change; same `hotspot.py` as below, card picked automatically), copies your SpeedQuizzing sounds, records the bingo caller, and **Close PubQuiz** takes the Wi-Fi down and stops the server. While the quiz Wi-Fi is on, PubQuiz answers only on it and on the laptop. The log is in `~/.local/state/pubquiz/server.log`. **Go online** in the same panel makes a public link (a Cloudflare quick tunnel, `cloudflared`) for online quizzes, in person or remote: it reaches a second, laptop-only port (3001, `PUBLIC_PORT`) that serves the players' page and the TV (and the desk, only while **Desk on the online link** is on), with live updates over a WebSocket because quick tunnels hold server-sent events back. See docs/QUIZMASTER.md, "Online quizzes".

Open **http://localhost:3000/host**. Players can use **http://LAPTOP-IP:3000/** before hotspot integration. The projector/TV page is `/display`: it has a full-screen button and a join screen with Wi-Fi and address QR codes generated on the laptop. The default database is `quiz.sqlite` beside the server; `QUIZ_DB`, `PORT` and `BIND` can override defaults. Keep the key private. The service deliberately uses local HTTP for captive portal compatibility; use only a trusted local quiz network. The hotspot is open Wi-Fi, so recovery codes and host credentials are not encrypted on air. Do not expose it to public internet or reuse an important password.

## Dedicated CachyOS Wi-Fi

**Network changes require the laptop owner's approval. These commands have not been run against your laptop.** A Wi-Fi adapter supporting AP mode is required. A single radio will usually disconnect from its current Wi-Fi network while hosting; internet is unnecessary.

**One command for a quiz night:** `./scripts/quiz-night.sh` asks for the host key and your password, starts the **PubQuiz** Wi-Fi while the laptop stays on your normal Wi-Fi, runs PubQuiz on it, and takes the Wi-Fi down again when you press Ctrl+C. With two Wi-Fi cards (say a USB adapter joined to your home Wi-Fi) it hosts on the one that isn't connected and leaves the other alone; with one card it hosts beside your home Wi-Fi on that card (`--keep-wifi`, below). `--offline` lets the hotspot card leave your home Wi-Fi instead; `--ssid` and `--interface` change the network name and card. The steps below are the same thing by hand.

1. Find the interface with `nmcli device status` (often `wlan0` or `wlp...`). Run `python scripts/hotspot.py check --interface wlan0` to inspect AP capability. `python scripts/hotspot.py status` shows every card and which one `--interface auto` (the default) would host on: a free card that can host, otherwise the connected one, shared with its network (`--keep-wifi`, below) unless you add `--offline`.
2. Start PubQuiz as your normal user with `./scripts/start.sh --hotspot`, keeping the terminal open. `--hotspot` makes the server answer only on this laptop and the quiz Wi-Fi (10.42.0.1), not on any other network the laptop is connected to. Test the dashboard first.
3. Preview: `python scripts/hotspot.py up --interface wlan0 --ssid PubQuiz`.
4. After local approval: `sudo python scripts/hotspot.py up --interface wlan0 --ssid PubQuiz --apply`.
5. Connect phones to **PubQuiz**, keep the connection when told “no internet”, and enter a team name.
6. Stop after the quiz: `sudo python scripts/hotspot.py down --interface wlan0 --apply`. Reconnect your previous Wi-Fi profile through NetworkManager if necessary.

**Firewall:** if UFW is on, allow the quiz port on the Wi-Fi card: `sudo ufw allow in on wlan0 to any port 3000 proto tcp`. DHCP (67) and DNS (53) must also be allowed. Port 80 needs no rule; it is redirected to 3000 first.

**Staying on your normal Wi-Fi as well (`--keep-wifi`):** cards like the Intel AX200 can host while connected, but only on one shared channel and only on 2.4 GHz. Add `--keep-wifi` to `up` and `down`: the hotspot then runs on a virtual interface (`pq0`) on your home Wi-Fi's channel and the laptop stays online. NetworkManager cannot run that second interface on these cards (it starts every Wi-Fi interface as a client, which the card refuses beside an existing connection), so the script runs the hotspot with `wpa_supplicant` itself, already installed alongside NetworkManager, and keeps NetworkManager off `pq0`. If your home connection is on 5 GHz, the script stops and prints the two `nmcli` commands that lock it to 2.4 GHz. Expect the hotspot to share speed with your home connection; a cable or a second USB Wi-Fi adapter (any card that reports AP support) is more robust.

The dedicated NetworkManager profile has a manual 10.42.0.1/24 address, IPv6 disabled and autoconnect off. An isolated transient dnsmasq instance supplies DHCP and wildcard DNS. An interface-scoped nftables table redirects HTTP port 80 to 3000 and blocks forwarding in both directions. It does not flush existing firewall rules or enable internet sharing. The `up` script refuses existing PubQuiz resources, validates configuration and attempts rollback on failure. An existing host firewall may still require an interface-specific allow rule for UDP 53/67 and TCP 53/3000; inspect it rather than disabling it. Port 80 conflicts, subnet conflicts and adapter limits must be checked locally.

If startup fails, inspect `journalctl -u pubquiz-dnsmasq` and `sudo nft list table inet pubquiz`. Recovery commands, **only for resources created by this script**, are `sudo systemctl stop pubquiz-dnsmasq.service`, `sudo nft delete table inet pubquiz`, and `sudo nmcli connection delete PubQuiz-offline`. Down does not restore the prior profile automatically. Do not run two quiz hotspots at once.

Network configuration references: [NetworkManager settings](https://networkmanager.pages.freedesktop.org/NetworkManager/NetworkManager/nm-settings-nmcli.html), [dnsmasq manual](https://thekelleys.org.uk/dnsmasq/docs/dnsmasq-man.html).

## Captive portal and recovery

DNS and plain HTTP captive probes open registration. Automatic opening depends on the phone OS and is not guaranteed. HTTPS sites cannot be transparently redirected without certificate errors. The reliable fallback is opening **http://10.42.0.1** in a normal browser (including the `http://`). For direct access without redirection use **http://10.42.0.1:3000**.

Each new team receives an unguessable recovery code. It is saved in browser storage and shown under “Team recovery code”. Copy it before leaving a captive mini-browser: the normal browser has separate storage. Use the code to resume from another browser/device; names alone never grant team access. All tabs holding a team's code represent that same team; first accepted answer wins. Keep the code private. If a code is lost, the quizmaster can issue a new recovery code for the same team; this revokes the old code and preserves answers, drafts and scores.

Phones, the projector and the desk hold a live server-sent-event connection and update as soon as anything changes, with a 5-second refresh as a fallback. The dashboard flags teams after 15 seconds with no open connection and no request, and clears the flag when they return. Sleeping phones, background tabs and captive windows can also trigger warnings; a warning means unreachable, not cheating. No notification permission or external ping is needed.

## Gameplay and quizmaster dashboard

Round formats follow the usual pub-quiz handset games: multiple choice, multi-tap, letters, numbers, sequence, nearest wins, pinpoint (tap the picture, with go wide), word snake, Seven Squares-style tiles, buzz-in (classic and advanced with agree voting), sound clips, 90-ball bingo, music bingo, votes, typed answers with optional picture/audio, and answer sheets. The projector can also spin a wheel and celebrate the winner, keypads can be scrambled per team, rude team names are refused, teams add approved photos and pick a buzzer sound, phones and the TV speak English, French or Spanish, and the desk has single-key shortcuts a Stream Deck can send. SpeedQuizzing `.sqb`/`.sqq`/`.sqn` rounds and Quick Question files import into new rounds. The dashboard has four screens: **Run quiz**, **Build quiz**, **Mark answers** and **Teams & results**. Use form controls to author and persist named rounds, reorder questions, upload local media, and run the quiz without editing JSON. Text and choice questions support automatic marking and optional speed bonuses (only when *Fastest fingers first* is ticked), Evil Mode, and a reveal listing who scored, fastest first. The TV runs itself in Auto mode and always fits the screen. Answer sheets support keyed and manual per-item marking; paper rounds support printed sheets and score adjustments. The quizmaster can pause/resume, close early, reveal answers, moderate/recover teams, hide scores and finish/resume an event.

Players reconnect automatically and retain the same identity, final answers and drafts. They can also recover from another browser using their private code. A quizmaster can rotate a lost code without losing the team's score. The server enforces deadlines, schemas, first-answer locking and host permissions. Scores for an open/paused question are withheld until closure or expiry.

See the [complete quizmaster guide](docs/QUIZMASTER.md) for authoring, live play, scoring, recovery and backups. For a full rehearsal, load the test quiz into the running server (it asks for the quizmaster key):

```bash
node scripts/load-test-quiz.mjs            # or: node scripts/load-test-quiz.mjs http://localhost:3000
```

It adds six rounds (21 questions) that use every format and the main options (Evil Mode, fastest fingers first, go wide, both buzzers, bingo, sound clips, music bingo and an answer sheet), with generated pictures and sounds. Your own rounds are kept; running it again replaces only the test rounds. A [small demo quiz](examples/demo-quiz.json) is also included.

## Optional internet check

`./scripts/connectivity.sh` makes no request by default. `./scripts/connectivity.sh --check` explicitly checks whether the **laptop** can reach an external HTTPS URL (requires curl). It cannot prove that players have disabled mobile data. There is no automatic mobile-data policing: a web page cannot reliably inspect another network interface on a phone.

## Persistence and tests

Stop the server before copying `quiz.sqlite` for a consistent backup (or use a SQLite-aware backup tool). Keep backups private: the database contains team recovery secrets. To start a new event, stop the server and use a new `QUIZ_DB` path. Existing teams/scores remain in the old event file. Export JSON excludes recovery secrets; it is a results archive, not an importable database backup. Host logins are stored (as hashes) in the database, expire after 12 hours and survive a restart. The application automatically migrates databases from the earlier prototype.

```bash
npm test
python -m unittest discover -s tests -p 'test_*.py'
bash -n scripts/setup.sh scripts/start.sh scripts/quiz-night.sh scripts/connectivity.sh
python scripts/hotspot.py up --interface wlan0  # dry run
```

For real browser tests, install the pinned development tooling and a Chromium binary while online, then run:

```bash
npm ci
npx playwright install chromium
npm run test:browser
```

To use an already installed Chrome or Chromium instead of downloading one: `PUBQUIZ_BROWSER=/usr/bin/google-chrome-stable npm run test:browser`.

Browser tooling is development-only. The quiz server itself still has no runtime dependencies and never needs this download during a quiz. The browser suite launches an isolated temporary quiz server and tests authoring, player registration/reconnection/drafts, pause/resume, text/choices/sheets, letters, sequence, nearest wins, classic and advanced buzz-in with two phones, SpeedQuizzing import, multi-tap, pinpoint, bingo, the wheel, keyboard shortcuts, marking, media decoding/playback, projector view, recovery rotation, paper scoring and finish. It fails on browser JavaScript errors or external page requests.

See [audit and test limits](docs/AUDIT.md). Before a real event, test on the actual laptop with at least one Android and one iPhone: automatic portal and fallback URL; mini-browser to full-browser recovery; Wi-Fi off/on; phone sleep; server restart; duplicate/late answers; picture and audio; ten or more concurrent teams; firewall compatibility; stop and restore normal Wi-Fi. Physical AP/radio and real phone acceptance remain pending; automated gameplay and plan tests do not establish that the hotspot works on your hardware.
