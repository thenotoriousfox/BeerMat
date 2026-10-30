"""BeerMat Desk, the native quizmaster desk (Qt 6 / QML), started with:  python -m beermat_desk  (from native/).

  --data <folder>   where the quiz lives (default: this user's BeerMat Desk data folder). The layout is the Electron
                    app's, so pointing it at that folder (~/.config/BeerMat, %APPDATA%\\BeerMat) opens the same quiz.
  --port <n>        the quiz server's preferred port (default 3000)
  --no-laptop       leave the laptop's Wi-Fi alone (tests, or another machine runs the quiz Wi-Fi)
"""
import argparse
import hashlib
import logging
import logging.handlers
import os
import signal
import subprocess
import sys
import time
from pathlib import Path

from PySide6.QtCore import QStandardPaths, Qt, QTimer, QUrl
from PySide6.QtNetwork import QLocalServer, QLocalSocket
from PySide6.QtGui import QColor, QFontDatabase, QGuiApplication, QIcon
from PySide6.QtQml import QQmlApplicationEngine
from PySide6.QtQuick import QQuickWindow
from PySide6.QtQuickControls2 import QQuickStyle

from .desk import Desk
from . import gradients, svgmotion
from .keystore import load_key
from .screens import Screens
from .server import ROOT

# The QML sits at native/beermat_desk/qml in the repository and in packaged builds (qr.mjs reaches ../../../web).
HERE = ROOT / 'native' / 'beermat_desk'


def start_logging(data_dir):
    """The desk's and the quiz server's lines, in <data>/logs/desk.log (5 × 1 MB), and on the terminal."""
    folder = Path(data_dir) / 'logs'
    folder.mkdir(parents=True, exist_ok=True)
    handler = logging.handlers.RotatingFileHandler(folder / 'desk.log', maxBytes=1_000_000, backupCount=5, encoding='utf-8')
    handler.setFormatter(logging.Formatter('%(asctime)s %(name)s %(levelname)s %(message)s'))
    logging.basicConfig(level=logging.INFO, handlers=[handler, logging.StreamHandler()])
    return logging.getLogger('beermat')


def single_instance(data_dir, raise_window):
    """One desk per data folder: a second start asks the first to come to the front, then exits."""
    name = 'beermat-desk-' + hashlib.sha256(str(Path(data_dir).resolve()).encode()).hexdigest()[:16]
    probe = QLocalSocket()
    probe.connectToServer(name)
    if probe.waitForConnected(300):
        probe.write(b'raise\n')
        probe.waitForBytesWritten(300)
        return None
    QLocalServer.removeServer(name)
    server = QLocalServer()
    server.newConnection.connect(lambda: (server.nextPendingConnection(), raise_window()))
    server.listen(name)
    return server


EGL_BLACK = 3   # gl_probe()'s exit code: the window came out all black


def drew_nothing(image):
    """True for an all-black frame: OpenGL drew nothing (the probe's window is red, the desk's never black)."""
    if image.isNull():
        return False
    step = max(1, min(image.width(), image.height()) // 40)
    return all(image.pixel(x, y) & 0xffffff == 0 for y in range(0, image.height(), step) for x in range(0, image.width(), step))


def gl_probe():
    """Run as  beermat_desk --gl-probe  in its own process: shows an invisible 1x1 window, renders it and reads it back.
    Only an on-screen window shows the fault (hidden and offscreen rendering come out right), and it takes ~0.2 s."""
    app = QGuiApplication(sys.argv[:1])
    window = QQuickWindow()
    window.setColor(QColor('#ff0000'))
    window.setFlags(Qt.WindowType.Tool | Qt.WindowType.FramelessWindowHint | Qt.WindowType.WindowDoesNotAcceptFocus
                    | Qt.WindowType.WindowTransparentForInput)
    window.setOpacity(0)
    window.resize(1, 1)
    window.show()
    deadline = time.monotonic() + 3
    while not window.isExposed() and time.monotonic() < deadline:
        app.processEvents()
    if not window.isExposed():
        return 2
    return EGL_BLACK if drew_nothing(window.grabWindow()) else 0


def egl_draws():
    """Whether OpenGL through EGL draws under XWayland, asked of a separate process (the GL integration is fixed once
    Qt starts). Unless the probe positively saw a black window, EGL it is, as before."""
    command = [sys.executable, '--gl-probe'] if getattr(sys, 'frozen', False) else [sys.executable, '-m', 'beermat_desk', '--gl-probe']
    try:
        probe = subprocess.run(command, env={**os.environ, 'QT_QPA_PLATFORM': 'xcb', 'QT_XCB_GL_INTEGRATION': 'xcb_egl'},
                               stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=10)
    except (OSError, subprocess.TimeoutExpired):
        return True
    return probe.returncode != EGL_BLACK


def main(argv=None):
    parser = argparse.ArgumentParser(prog='beermat_desk', description='BeerMat Desk')
    parser.add_argument('--data')
    parser.add_argument('--port', type=int, default=3000)
    parser.add_argument('--no-laptop', action='store_true')
    parser.add_argument('--gl-probe', action='store_true', help=argparse.SUPPRESS)
    args, qt_args = parser.parse_known_args(argv)
    if args.gl_probe:
        return gl_probe()

    # Wayland doesn't let a window choose its screen, which the TV window must; XWayland does. As the Electron app,
    # prefer X11 on a Wayland desktop (BEERMAT_WAYLAND=1 opts out; Qt falls back to Wayland without XWayland).
    glx = False
    if os.environ.get('WAYLAND_DISPLAY') and os.environ.get('BEERMAT_WAYLAND') != '1' and 'QT_QPA_PLATFORM' not in os.environ:
        os.environ['QT_QPA_PLATFORM'] = 'xcb;wayland'
        # OpenGL through GLX can fail under XWayland (seen with NVIDIA); EGL usually works there. Some drivers draw
        # nothing through EGL instead (NVIDIA 615.78), so a probe checks first and GLX is the fallback.
        if 'QT_XCB_GL_INTEGRATION' not in os.environ:
            glx = not egl_draws()
            os.environ['QT_XCB_GL_INTEGRATION'] = 'xcb_glx' if glx else 'xcb_egl'
    QGuiApplication.setApplicationName('BeerMat Desk')
    QGuiApplication.setOrganizationName('BeerMat')
    QGuiApplication.setDesktopFileName('beermat-desk')
    app = QGuiApplication([sys.argv[0], *qt_args])
    app.setWindowIcon(QIcon(str(ROOT / 'brand' / 'icon.svg')))
    QQuickStyle.setStyle('Basic')
    # Fredoka's static weights too: Qt only takes the variable font's lightest (brand/make-brand.py).
    for font in ('fredoka.woff2', 'fredoka-regular.ttf', 'fredoka-medium.ttf', 'fredoka-semibold.ttf', 'fredoka-bold.ttf'):
        QFontDatabase.addApplicationFont(str(ROOT / 'brand' / font))

    data_dir = Path(args.data) if args.data else Path(QStandardPaths.writableLocation(QStandardPaths.StandardLocation.AppDataLocation))
    log = start_logging(data_dir)
    windows = []
    # Opening BeerMat again while it runs brings the desk back, even if its window was closed or minimised.
    instance = single_instance(data_dir, lambda: [(w.showNormal() if w.visibility() == w.Visibility.Minimized else w.show(), w.raise_(), w.requestActivate()) for w in windows])
    if instance is None:
        log.info('BeerMat Desk is already running for %s; brought it to the front', data_dir)
        return 0
    key, kept = load_key(data_dir)
    log.info('Quizmaster key kept in the %s', 'system keychain' if kept == 'keychain' else 'data folder (no keychain available)')
    desk = Desk(data_dir, key, port=args.port, laptop=not args.no_laptop)
    desk.keyKept = kept

    engine = QQmlApplicationEngine()
    gradients.install(engine)
    svgmotion.install(engine)
    screens = Screens(app)
    engine.rootContext().setContextProperty('desk', desk)
    engine.rootContext().setContextProperty('screens', screens)
    engine.rootContext().setContextProperty('brand', QUrl.fromLocalFile(str(ROOT / 'brand') + '/'))
    engine.addImportPath(str(HERE / 'qml'))
    engine.load(QUrl.fromLocalFile(str(HERE / 'qml' / 'Main.qml')))
    if not engine.rootObjects():
        log.error('The desk interface failed to load')
        return 1
    windows.extend(engine.rootObjects())
    if glx:
        log.warning('OpenGL through EGL drew nothing here; using GLX')
    desk.server.log.connect(lambda line: logging.getLogger('beermat.server').info(line))
    desk.toast.connect(lambda message, error: log.warning(message) if error else None)
    log.info('BeerMat Desk started; data in %s', data_dir)
    app.aboutToQuit.connect(desk.stop)
    # Ctrl+C in a terminal, or being asked to stop (a logout, kill), closes it properly, server and all. Python only
    # runs signal handlers between its own lines, and Qt's event loop isn't one: a timer lets it look in now and then.
    for sig in (signal.SIGINT, signal.SIGTERM):
        signal.signal(sig, lambda *_: app.exit(0))   # exit, not quit: see Main.qml's onClosing
    wake = QTimer(app, interval=300)
    wake.timeout.connect(lambda: None)
    wake.start()
    desk.start()
    screens.start()
    return app.exec()


if __name__ == '__main__':
    sys.exit(main())
