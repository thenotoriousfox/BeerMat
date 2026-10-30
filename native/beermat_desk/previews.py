"""Pictures of a theme for the theme library, drawn without a screen: the theme on BeerMat Desk's TV (TvStage.qml, a
question at 1600×900) and on a phone in the app (PhonePreview.qml, 390×844 at 2x), as the desk's share dialog draws
them. BeerMat Online runs it for every theme added to the library (online/qt-preview.js):

    python3 -m beermat_desk.previews <themes folder> <theme id> <quiz title>

<themes folder>/<theme id> is the theme's folder. Prints {"tv": base64 JPEG, "app": base64 JPEG}."""
import base64
import json
import os
import sys
import time
from pathlib import Path

os.environ.setdefault('QT_QPA_PLATFORM', 'offscreen')
os.environ['QT_SCALE_FACTOR'] = '2'
from PySide6.QtCore import QBuffer, QByteArray, QIODevice, QObject, Property, QUrl   # noqa: E402
from PySide6.QtGui import QFontDatabase, QGuiApplication                                  # noqa: E402
from PySide6.QtQml import QQmlApplicationEngine                                           # noqa: E402
from PySide6.QtQuick import QQuickWindow                                                  # noqa: E402,F401  (grabWindow)

from beermat_desk import gradients, looks, svgmotion                                               # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
QML = Path(__file__).resolve().parent / 'qml'


class Looks(QObject):
    """The desk's lookPalettes and lookScenes, for this one theme."""

    def __init__(self, folder):
        super().__init__()
        self._palettes, self._scenes = looks.load(folder), looks.scenes(folder)

    @Property('QVariantMap', constant=True)
    def lookPalettes(self):
        return self._palettes

    @Property('QVariantMap', constant=True)
    def lookScenes(self):
        return self._scenes


def jpeg(image):
    data = QByteArray()
    buffer = QBuffer(data)
    buffer.open(QIODevice.WriteOnly)
    image.save(buffer, 'JPEG', 85)
    return base64.b64encode(bytes(data)).decode()


def draw(folder, theme, title):
    app = QGuiApplication.instance() or QGuiApplication(sys.argv[:1])
    for font in ('fredoka-regular.ttf', 'fredoka-medium.ttf', 'fredoka-semibold.ttf', 'fredoka-bold.ttf'):
        QFontDatabase.addApplicationFont(str(ROOT / 'brand' / font))
    engine = QQmlApplicationEngine()
    gradients.install(engine)
    svgmotion.install(engine)
    desk = Looks(folder)
    engine.rootContext().setContextProperty('desk', desk)
    engine.rootContext().setContextProperty('brand', QUrl.fromLocalFile(str(ROOT / 'brand') + '/'))
    engine.rootContext().setContextProperty('previewLook', theme)
    engine.rootContext().setContextProperty('quizTitle', title)
    engine.addImportPath(str(QML))
    engine.loadData(b'''import QtQuick
import QtQuick.Window
Item {
    readonly property var tv: tvWindow
    readonly property var phone: phoneWindow
    Window {
        // Half size at 2x: the picture is 1600x900, the TV drawn at its own size.
        id: tvWindow; width: 800; height: 450; visible: true
        TvStage {
            width: 1600; height: 900; scale: 0.5; transformOrigin: Item.TopLeft
            tv: ({settings: {title: quizTitle, leaderboardVisible: true, registrationOpen: true, joinSsid: "BeerMat", joinUrl: "http://10.42.0.1"},
                  view: "question", look: previewLook, offset: 0, serverTime: Date.now(), teams: [],
                  question: {id: 1, type: "choice", round: "Round 1", text: "Which planet is known as the Red Planet?", options: ["Venus", "Mars", "Jupiter", "Saturn"],
                             open: true, live: true, paused: false, seconds: 60, deadline: Date.now() + 42000, points: 1, revealed: false, revealing: false}})
        }
    }
    Window { id: phoneWindow; width: 390; height: 844; visible: true; color: "transparent"; PhonePreview { lookId: previewLook } }
}''', QUrl.fromLocalFile(str(QML / 'previews.qml')))
    if not engine.rootObjects():
        raise SystemExit('The preview didn’t load')
    root = engine.rootObjects()[0]
    tv_window, phone_window = root.property('tv'), root.property('phone')
    # Pictures load and the scenery settles.
    end = time.monotonic() + 2.5
    while time.monotonic() < end:
        app.processEvents()
        time.sleep(0.02)
    return {'tv': jpeg(tv_window.grabWindow()), 'app': jpeg(phone_window.grabWindow())}


if __name__ == '__main__':
    if len(sys.argv) != 4:
        raise SystemExit(__doc__)
    print(json.dumps(draw(Path(sys.argv[1]), sys.argv[2], sys.argv[3])))
