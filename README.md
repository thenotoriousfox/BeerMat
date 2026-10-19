# PubQuiz

Offline-first quiz system for one CachyOS laptop, with browser-based team clients and a quizmaster dashboard.

## Prototype setup

Requires Node.js and npm.

```bash
npm install
HOST_KEY='change-this-password' npm start
```

Quizmaster: http://localhost:3000/host

Players: http://<laptop-LAN-IP>:3000/

This is an early prototype. It does not yet implement hotspot setup, captive portal, persistent SQLite storage, or production-grade reconnection. Do not expose the host service to the public internet.

## Roadmap

1. Stabilise quiz sessions, reconnect tokens, scoring, and tests.
2. Add SQLite session persistence and quiz import.
3. Add CachyOS NetworkManager hotspot and captive-portal onboarding.
4. Add picture/audio rounds and projector view.
5. Test on real Android and iOS devices offline.
