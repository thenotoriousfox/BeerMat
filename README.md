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

Each new team receives an unguessable recovery code. It is saved in browser storage and shown under “Team recovery code”. Copy it before leaving a captive mini-browser: the normal browser has separate storage. Use the code to resume from another browser/device; names alone never grant team access. All tabs holding a team's code represent that same team; first accepted answer wins. Keep the code private. Lost codes require retaining the original browser storage or creating a differently named team; this version has no host identity-reset interface.

Phones send a heartbeat by polling every two seconds. The dashboard flags teams after 15 seconds without a request and clears the flag when requests resume. Sleeping phones, background tabs and captive windows can also trigger warnings; a warning means unreachable, not cheating. No notification permission or external ping is needed.

## Running rounds

Unlock the dashboard, edit the question JSON, then **Open question**. Load a JSON array to queue an entire quiz. Selecting a queued question loads its editor; opening remains an explicit action. Close a question early with **Close question**. The server rejects answers at or after the deadline, outdated question IDs, invalid choices, oversized/empty answers and duplicate submissions. A restart preserves the original deadline; time spent stopped still counts. Keep the laptop system clock accurate during a quiz.

Examples:

```json
[
 {"text":"Capital of Wales?","type":"text","seconds":30,"points":1,"answer":"Cardiff"},
 {"text":"Choose the prime","type":"choice","seconds":15,"points":2,"options":["8","11","12"],"answer":"11"},
 {"text":"Identify this landmark","type":"picture","seconds":45,"points":1,"media":"/media/landmark.jpg","answer":"Example"},
 {"text":"Name the song","type":"audio","seconds":60,"points":1,"media":"/media/song.mp3","answer":"Example"},
 {"text":"Written round","type":"sheet","seconds":600,"points":10,"items":["Question one","Question two"]}
]
```

Put your own local images/audio in `media/` before opening media questions. Audio has a play button because mobile browsers restrict autoplay. The host can use a player browser for venue audio playback; each phone can also play the clip. No streaming service is used. Only files deliberately placed in media/ are served. Do not put answer keys there.

Text/choice/picture/audio answers use Unicode normalization and case-insensitive exact matching; accents, punctuation and spelling are otherwise significant. The host can override after closing. “Set 0” and “Set N” replace an answer's score, making repeated marking safe. Sheet questions accept one final list; mark each sheet as a whole with the configured maximum or zero, or use the score correction form for partial credit. For physical paper answer sheets, run the round verbally and enter totals through the paper score form, with a reason. Manual adjustments are additive: do not click twice unintentionally. Export results from the dashboard for marking history and backups. Scores are visible live, including automatically awarded points before the question closes.

## Optional internet check

`./scripts/connectivity.sh` makes no request by default. `./scripts/connectivity.sh --check` explicitly checks whether the **laptop** can reach an external HTTPS URL (requires curl). It cannot prove that players have disabled mobile data. There is no automatic mobile-data policing: a web page cannot reliably inspect another network interface on a phone.

## Persistence and tests

Stop the server before copying `quiz.sqlite` for a consistent backup (or use a SQLite-aware backup tool). Keep backups private: the database contains team recovery secrets. To start a new event, stop the server and use a new `QUIZ_DB` path. Existing teams/scores remain in the old event file. Export JSON excludes recovery secrets; it is a results archive, not an importable database backup. Host logins are memory-only and must be repeated after restart.

```bash
npm test
python -m unittest discover -s tests -p 'test_*.py'
bash -n scripts/*.sh
python scripts/hotspot.py up --interface wlan0  # dry run
```

See [audit and test limits](docs/AUDIT.md). Before a real event, test on the actual laptop with at least one Android and one iPhone: automatic portal and fallback URL; mini-browser to full-browser recovery; Wi-Fi off/on; phone sleep; server restart; duplicate/late answers; picture and audio; ten or more concurrent teams; firewall compatibility; stop and restore normal Wi-Fi. Physical AP/radio and phone acceptance remain pending; automated plan tests do not establish that they work on your hardware.
