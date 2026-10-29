# BeerMat Desk (native)

The quizmaster desk as a native Qt 6 / QML app, in Python with PySide6. **A prototype**: it runs a quiz's questions,
not yet everything the Electron desk does. See `docs/NATIVE-DESK.md` for the plan and what's left.

It starts the existing quiz server (`desktop/server-host.js`, needs Node.js 22.13+ on the PATH or `BEERMAT_NODE`) and
talks to it through the same desk API as the web desk. Phones and the TV use their usual web pages.

```sh
python3 -m venv .venv && .venv/bin/pip install PySide6
cd native
../.venv/bin/python -m beermat_desk                 # its own data folder
../.venv/bin/python -m beermat_desk --data ~/.config/BeerMat --no-laptop   # the Electron app's quiz (close that app first)
../.venv/bin/python -m unittest discover -s tests   # end to end, no screen needed (BEERMAT_SHOTS=<dir> saves screenshots)
```

Keys: **N** next, **C** close answers, **P** pause/resume, **R** reveal, **Ctrl+O** load a quiz file, **Ctrl+1…6** workspaces.

One desk runs per data folder (a second start brings the first to the front). Logs: `<data>/logs/desk.log`.

| File | What it does |
|---|---|
| `beermat_desk/server.py` | Starts and watches the quiz server; messages as `@beermat <json>` lines |
| `beermat_desk/api.py` | The desk API over `QNetworkAccessManager`, and live updates from `/api/events` |
| `beermat_desk/desk.py` | Turns the server's state into what the screen shows, and the buttons into API calls |
| `beermat_desk/qml/Main.qml` | The shell: workspace rail, status bar, dialogs, keys |
| `beermat_desk/qml/LiveWorkspace.qml` | Live control: question, teams, up next, live buttons |
| `beermat_desk/qml/RehearsalWorkspace.qml` | Rehearsal: options, simulated teams and their actions, test phones, log, go live |
| `beermat_desk/qml/SettingsWorkspace.qml` | Plan, backups, data and logs folders, quizmaster key, shortcuts |
| `beermat_desk/qml/PendingWorkspace.qml` | Workspaces not yet native: says so and opens the web desk |
| `beermat_desk/qml/Desk/` | Design-system components (theme tokens, panel, pill, button) |
| `tests/test_desk.py` | The real server and window, offscreen: load, join, answer, open, close, reveal, crash, close |

## Packaged builds

`native/packaging/build.py` bundles Python, Qt (PySide6 Essentials) and Node.js (official build, SHA-256 checked) with
PyInstaller, so users install nothing. Run it on the system you build for; see the script's header. Linux gives a
portable `.tar.gz` (and an AppImage when `appimagetool` is installed); Windows gives a `.zip` and, with Inno Setup, a
per-user installer (`beermat-desk.iss`: Start menu, optional desktop shortcut, clean uninstall that keeps quizzes).
