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
import sys
from pathlib import Path

from PySide6.QtCore import QStandardPaths, QUrl
from PySide6.QtNetwork import QLocalServer, QLocalSocket
from PySide6.QtGui import QFontDatabase, QGuiApplication, QIcon
from PySide6.QtQml import QQmlApplicationEngine
from PySide6.QtQuickControls2 import QQuickStyle

from .desk import Desk
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


def main(argv=None):
    parser = argparse.ArgumentParser(prog='beermat_desk', description='BeerMat Desk')
    parser.add_argument('--data')
    parser.add_argument('--port', type=int, default=3000)
    parser.add_argument('--no-laptop', action='store_true')
    args, qt_args = parser.parse_known_args(argv)

    # Wayland doesn't let a window choose its screen, which the TV window must; XWayland does. As the Electron app,
    # prefer X11 on a Wayland desktop (BEERMAT_WAYLAND=1 opts out; Qt falls back to Wayland without XWayland).
    if os.environ.get('WAYLAND_DISPLAY') and os.environ.get('BEERMAT_WAYLAND') != '1' and 'QT_QPA_PLATFORM' not in os.environ:
        os.environ['QT_QPA_PLATFORM'] = 'xcb;wayland'
        # OpenGL through GLX can fail under XWayland (seen with NVIDIA); EGL works there.
        os.environ.setdefault('QT_XCB_GL_INTEGRATION', 'xcb_egl')
    QGuiApplication.setApplicationName('BeerMat Desk')
    QGuiApplication.setOrganizationName('BeerMat')
    QGuiApplication.setDesktopFileName('beermat-desk')
    app = QGuiApplication([sys.argv[0], *qt_args])
    app.setWindowIcon(QIcon(str(ROOT / 'brand' / 'icon.svg')))
    QQuickStyle.setStyle('Basic')
    for font in ('fredoka.woff2',):
        QFontDatabase.addApplicationFont(str(ROOT / 'brand' / font))

    data_dir = Path(args.data) if args.data else Path(QStandardPaths.writableLocation(QStandardPaths.StandardLocation.AppDataLocation))
    log = start_logging(data_dir)
    windows = []
    instance = single_instance(data_dir, lambda: [w.raise_() or w.requestActivate() for w in windows])
    if instance is None:
        log.info('BeerMat Desk is already running for %s; brought it to the front', data_dir)
        return 0
    key, kept = load_key(data_dir)
    log.info('Quizmaster key kept in the %s', 'system keychain' if kept == 'keychain' else 'data folder (no keychain available)')
    desk = Desk(data_dir, key, port=args.port, laptop=not args.no_laptop)
    desk.keyKept = kept

    engine = QQmlApplicationEngine()
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
    desk.server.log.connect(lambda line: logging.getLogger('beermat.server').info(line))
    desk.toast.connect(lambda message, error: log.warning(message) if error else None)
    log.info('BeerMat Desk started; data in %s', data_dir)
    app.aboutToQuit.connect(desk.stop)
    # Ctrl+C in a terminal closes it properly, server and all.
    signal.signal(signal.SIGINT, lambda *_: app.quit())
    desk.start()
    return app.exec()


if __name__ == '__main__':
    sys.exit(main())
