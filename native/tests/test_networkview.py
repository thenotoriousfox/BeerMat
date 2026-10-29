"""The desk's Network view with crafted laptop states, Linux and Windows (isolation on, checked, not on, a phone that got
out): each must draw without a QML error and say the right thing. The states are what server.js sends; nothing here
touches a real Wi-Fi card. BEERMAT_SHOTS=<dir> saves a screenshot of each."""
import os
import sys
import unittest
from pathlib import Path

os.environ.setdefault('QT_QPA_PLATFORM', 'offscreen')
os.environ.setdefault('BEERMAT_MUTE', '1')   # tests make the TV's sounds without playing them aloud
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from PySide6.QtCore import QObject, Property, Signal, Slot, qInstallMessageHandler, QtMsgType   # noqa: E402
from PySide6.QtGui import QGuiApplication                                                     # noqa: E402
from PySide6.QtQml import QQmlApplicationEngine                                               # noqa: E402
from PySide6.QtQuick import QQuickWindow                                                      # noqa: E402,F401  (window type)

from beermat_desk.server import ROOT                                                           # noqa: E402

app = QGuiApplication.instance() or QGuiApplication(sys.argv)
QML = ROOT / 'native' / 'beermat_desk' / 'qml'
problems = []
qInstallMessageHandler(lambda kind, _context, message: problems.append(message) if kind in (QtMsgType.QtWarningMsg, QtMsgType.QtCriticalMsg) and ('qml' in message.lower() or 'TypeError' in message) else None)


class FakeDesk(QObject):
    networkChanged = Signal()

    def __init__(self):
        super().__init__()
        self._network = {}
        self.loads = 0

    @Property('QVariantMap', notify=networkChanged)
    def network(self):
        return self._network

    def set(self, network):
        self._network = network
        self.networkChanged.emit()

    @Slot()
    def loadNetwork(self):
        self.loads += 1


def windows(isolation, **running):
    return {'port': 3000, 'joinMode': 'hotspot', 'joinSsid': 'Quiz', 'joinUrl': 'http://192.168.137.1:3000', 'addresses': [],
            'laptop': {'platform': 'windows', 'jobs': {}, 'wifi': {'available': True, 'platform': 'windows', 'needsPassword': True, 'wifiOn': True, 'address': '192.168.137.1',
                       'running': {'interface': 'Mobile Hotspot', 'ssid': 'Quiz', 'address': '192.168.137.1', 'adapter': 'Local Area Connection* 10', 'clients': 2,
                                   'reachable': True, 'isolation': isolation, **running}}}}


ON = {'configured': True, 'filters': 14, 'present': 14, 'phones': 0, 'reached': 0, 'verified': False,
      'text': 'BeerMat’s filters are on. Not checked yet: the first phone to join tries the internet and reports back.'}
CASES = {
    'linux': {'port': 3000, 'joinMode': 'hotspot', 'joinSsid': 'BeerMat', 'joinUrl': 'http://10.42.0.1', 'addresses': [],
              'laptop': {'platform': 'linux', 'jobs': {}, 'wifi': {'available': True, 'platform': 'linux', 'wifiOn': True, 'address': '10.42.0.1',
                         'running': {'interface': 'bm0', 'ssid': 'BeerMat', 'keepWifi': True, 'address': '10.42.0.1'}}}},
    'windows-on': windows(ON),
    'windows-checked': windows({**ON, 'phones': 3, 'verified': True, 'text': 'Checked: 3 phones on the quiz Wi-Fi tried the internet and could not reach it.'}),
    'windows-not-on': windows({'configured': False, 'filters': 14, 'present': 0, 'reached': 0, 'verified': False,
                               'text': 'Not guaranteed: The BeerMat isolation helper is no longer running. Phones on the quiz Wi-Fi may be able to use the internet.'}, reachable=False, clients=0),
    'windows-reached': windows({**ON, 'phones': 1, 'reached': 1, 'reachedBy': ['Owls'], 'text': '1 phone on the quiz Wi-Fi reached the internet (Owls).'}),
}


class NetworkViewTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.desk = FakeDesk()
        cls.engine = QQmlApplicationEngine()
        cls.engine.rootContext().setContextProperty('desk', cls.desk)
        cls.engine.addImportPath(str(QML))
        cls.engine.loadData(b'import QtQuick\nimport QtQuick.Window\nWindow { width: 1400; height: 900; visible: true; NetworkView { objectName: "view"; anchors.fill: parent; anchors.margins: 16 } }',
                            (QML / 'Probe.qml').as_uri())
        cls.window = cls.engine.rootObjects()[0]
        cls.view = cls.window.findChild(QObject, 'view')

    def show(self, name):
        problems.clear()
        self.desk.set(CASES[name])
        for _ in range(5):
            app.processEvents()
        if os.environ.get('BEERMAT_SHOTS'):
            self.window.grabWindow().save(str(Path(os.environ['BEERMAT_SHOTS']) / f'network-{name}.png'))
        self.assertEqual(problems, [], f'{name}: {problems}')
        # Repeater rows are only in the visual tree, so walk that.
        def items(item):
            yield item
            for child in item.childItems():
                yield from items(child)
        return ' | '.join(o.property('text') for o in items(self.view) if isinstance(o.property('text'), str) and o.property('visible'))

    def test_linux_has_no_isolation_lines(self):
        text = self.show('linux')
        self.assertIn('Phones join “BeerMat” and open 10.42.0.1', text)
        self.assertNotIn('isolation', text.lower())

    def test_windows_isolation_is_claimed_only_when_checked(self):
        text = self.show('windows-on')
        self.assertIn('open 192.168.137.1:3000', text)
        self.assertIn('2 devices connected', text)
        self.assertIn('✓  Internet isolation on: 14 filters on the hotspot adapter', text)
        self.assertIn('○  BeerMat’s filters are on. Not checked yet', text)
        self.assertIn('✓  Checked: 3 phones', self.show('windows-checked'))
        text = self.show('windows-not-on')
        self.assertIn('⚠  Internet isolation is NOT on', text)
        self.assertIn('⚠  BeerMat does not answer at http://192.168.137.1:3000', text)
        self.assertIn('⚠  Not guaranteed', text)
        self.assertIn('⚠  1 phone on the quiz Wi-Fi reached the internet (Owls).', self.show('windows-reached'))


if __name__ == '__main__':
    unittest.main()
