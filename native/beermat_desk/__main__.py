"""BeerMat Desk, the native quizmaster desk (Qt 6 / QML), started with:  python -m beermat_desk  (from native/).

  --data <folder>   where the quiz lives (default: this user's BeerMat Desk data folder). The layout is the Electron
                    app's, so pointing it at that folder (~/.config/BeerMat, %APPDATA%\\BeerMat) opens the same quiz.
  --port <n>        the quiz server's preferred port (default 3000)
  --no-laptop       leave the laptop's Wi-Fi alone (tests, or another machine runs the quiz Wi-Fi)
"""
import argparse
import os
import secrets
import signal
import sys
from pathlib import Path

from PySide6.QtCore import QStandardPaths, QUrl
from PySide6.QtGui import QFontDatabase, QGuiApplication, QIcon
from PySide6.QtQml import QQmlApplicationEngine
from PySide6.QtQuickControls2 import QQuickStyle

from .desk import Desk
from .server import ROOT

HERE = Path(__file__).resolve().parent


def host_key(data_dir):
    """The quizmaster key: it also unlocks the desk from a browser, so it's long, random and readable only by this user.
    (The Electron app encrypts its copy with the system keychain; the packaged native desk will use keyring for that.)"""
    file = Path(data_dir) / 'host-key'
    if file.exists():
        text = file.read_text().strip()
        if text and not text.startswith('enc:'):
            return text
    key = secrets.token_urlsafe(18)
    file.parent.mkdir(parents=True, exist_ok=True)
    temporary = file.with_suffix('.tmp')
    temporary.write_text(key)
    os.chmod(temporary, 0o600)
    temporary.replace(file)
    return key


def main(argv=None):
    parser = argparse.ArgumentParser(prog='beermat_desk', description='BeerMat Desk')
    parser.add_argument('--data')
    parser.add_argument('--port', type=int, default=3000)
    parser.add_argument('--no-laptop', action='store_true')
    args, qt_args = parser.parse_known_args(argv)

    QGuiApplication.setApplicationName('BeerMat Desk')
    QGuiApplication.setOrganizationName('BeerMat')
    QGuiApplication.setDesktopFileName('beermat-desk')
    app = QGuiApplication([sys.argv[0], *qt_args])
    app.setWindowIcon(QIcon(str(ROOT / 'brand' / 'icon.svg')))
    QQuickStyle.setStyle('Basic')
    for font in ('fredoka.woff2',):
        QFontDatabase.addApplicationFont(str(ROOT / 'brand' / font))

    data_dir = Path(args.data) if args.data else Path(QStandardPaths.writableLocation(QStandardPaths.StandardLocation.AppDataLocation))
    desk = Desk(data_dir, host_key(data_dir), port=args.port, laptop=not args.no_laptop)

    engine = QQmlApplicationEngine()
    engine.rootContext().setContextProperty('desk', desk)
    engine.rootContext().setContextProperty('brand', QUrl.fromLocalFile(str(ROOT / 'brand') + '/'))
    engine.addImportPath(str(HERE / 'qml'))
    engine.load(QUrl.fromLocalFile(str(HERE / 'qml' / 'Main.qml')))
    if not engine.rootObjects():
        return 1
    app.aboutToQuit.connect(desk.stop)
    # Ctrl+C in a terminal closes it properly, server and all.
    signal.signal(signal.SIGINT, lambda *_: app.quit())
    desk.start()
    return app.exec()


if __name__ == '__main__':
    sys.exit(main())
