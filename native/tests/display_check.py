"""Manual check on real screens (not part of the automatic tests): starts the desk with its own data, opens the TV, and
prints which screen it filled; saves screenshots of the desk, the TV and the blanked TV in the folder given.

    python native/tests/display_check.py <folder>        # under XWayland or X11 the TV should fill the second screen
    QT_QPA_PLATFORM=wayland python native/tests/display_check.py <folder>   # pure Wayland: a window with the drag hint

For hot-plug, run it with --wait 60 and unplug and replug the TV's cable while it runs; it prints where the TV is
every 2 seconds (expected: a window on the desk's screen while unplugged, full screen on the TV again after)."""
import sys, time, tempfile, json
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from PySide6.QtCore import QObject, QUrl, QTimer
from PySide6.QtGui import QGuiApplication, QFontDatabase
from PySide6.QtQml import QQmlApplicationEngine
from PySide6.QtQuick import QQuickWindow
from PySide6.QtQuickControls2 import QQuickStyle
app = QGuiApplication(sys.argv); app.setOrganizationName('BeerMat-test')
QQuickStyle.setStyle('Basic'); QFontDatabase.addApplicationFont(str(Path(__file__).resolve().parents[2] / 'brand' / 'fredoka.woff2'))
from beermat_desk.desk import Desk
from beermat_desk.screens import Screens
from beermat_desk.server import ROOT
out = Path(sys.argv[1]); data = Path(tempfile.mkdtemp())
linger = int(sys.argv[sys.argv.index('--wait') + 1]) if '--wait' in sys.argv else 0
desk = Desk(data, 'real-display-check-key-0123', port=0, laptop=False); screens = Screens(app)
e = QQmlApplicationEngine(); c = e.rootContext()
c.setContextProperty('desk', desk); c.setContextProperty('screens', screens); c.setContextProperty('brand', QUrl.fromLocalFile(str(ROOT / 'brand') + '/'))
e.addImportPath(str(ROOT / 'native/beermat_desk/qml')); e.load(QUrl.fromLocalFile(str(ROOT / 'native/beermat_desk/qml/Main.qml')))
win = e.rootObjects()[0]; tv = win.findChild(QObject, 'tv')
def wait(cond, t=20):
    end = time.time() + t
    while time.time() < end:
        app.processEvents(); time.sleep(0.03)
        if cond(): return True
    return False
desk.start(); wait(lambda: desk.connected and desk.view.get('phase'))
report = {'platform': app.platformName(), 'screens': [s['name'] + (' (primary)' if s['primary'] else '') for s in screens.displays], 'target': screens.target, 'canPlace': screens.canPlace}
screens.setOpen(True); wait(lambda: tv.isVisible(), 5); wait(lambda: False, 2.5)
report.update(tvVisible=tv.isVisible(), tvScreen=tv.screen().name(), tvGeometry=list(tv.geometry().getRect()), tvVisibility=str(tv.visibility()), deskScreen=win.screen().name())
tv.grabWindow().save(str(out / f'real-{app.platformName()}-tv.png')); win.grabWindow().save(str(out / f'real-{app.platformName()}-desk.png'))
for _ in range(linger // 2):
    wait(lambda: False, 2); print(json.dumps({'screens': [s.name() for s in app.screens()], 'tvScreen': tv.screen().name(), 'visibility': str(tv.visibility()).split('.')[-1]}), flush=True)
# Swap: the TV goes to the desk's screen and the desk to the TV's, then back.
from PySide6.QtCore import QMetaObject
QMetaObject.invokeMethod(win, 'swapScreens'); wait(lambda: False, 2.5)
report['swapped'] = {'tvScreen': tv.screen().name(), 'deskScreen': win.screen().name(), 'tvVisibility': str(tv.visibility()).split('.')[-1],
                     'target': screens.target, 'chosen': screens.chosenName, 'tvGeometry': list(tv.geometry().getRect())}
QMetaObject.invokeMethod(win, 'swapScreens'); wait(lambda: False, 2.5)
report['swappedBack'] = {'tvScreen': tv.screen().name(), 'deskScreen': win.screen().name()}
screens.setBlank(True); wait(lambda: False, 0.8); tv.grabWindow().save(str(out / f'real-{app.platformName()}-tv-blank.png'))
screens.setOpen(False); wait(lambda: not tv.isVisible(), 3)
report['closedOk'] = not tv.isVisible()
print(json.dumps(report)); desk.stop(); app.quit()
