# Prototype audit (2026-10-19)

Audited all six files on main before implementation. Repository metadata confirmed private. No AGENTS.md was present in the upstream tree.

* Teams, answers and scores were memory-only: restart lost everything.
* Reconnection retained no identity and team name uniqueness prevented rejoining.
* Repeated team:join on one socket left stale connected teams.
* New players received no current question; reconnecting hosts did not authenticate again.
* Answers had no question ID, server deadline, empty-answer guard or schema for choices.
* No SQLite, captive DNS/DHCP, AP integration, media, sheets, import/export or tests.
* Positive: host key was required, host actions checked authentication, UI used textContent rather than HTML for user text.

Implementation retains Node and browser clients but replaces volatile socket state with SQLite and authenticated HTTP polling. Node 24 built-ins provide HTTP, SQLite, cryptography and tests without npm dependencies or CDN assets. Polling also works in constrained captive portal browsers and naturally resumes after missed requests.

# Validation boundary

API integration tests run against a real loopback HTTP server and a temporary SQLite database, including restart. Network scripts are tested as plans with mocked subprocesses. This environment has no NetworkManager, dnsmasq, nftables or Wi-Fi device, so AP activation, DHCP leases, firewall interactions and Android/iOS captive detection have NOT been live-tested. No user laptop configuration was changed. Use the acceptance checklist in README before a public quiz.
