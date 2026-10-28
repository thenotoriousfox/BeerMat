"""Which screen is the TV, as desktop/screens.js does for Electron: automatically the first screen that isn't the
desk's (the primary), or the one the quizmaster chose; full screen there, or a preview window when there's only one
screen. Screens coming and going are followed: the TV moves back to a window when its screen is unplugged and returns
when it's plugged in again (if the quizmaster wants it to open by itself).

Wayland doesn't let an app put a window on a chosen screen. The desk runs through XWayland where it can (see
__main__.py); on pure Wayland it opens the TV window and asks the quizmaster to drag it to the TV and press F11."""
from PySide6.QtCore import Property, QObject, QSettings, Signal, Slot
from PySide6.QtGui import QGuiApplication


class Screens(QObject):
    changed = Signal()

    def __init__(self, parent=None):
        super().__init__(parent)
        self._prefs = QSettings()
        self._open = False
        self._blanked = False
        app = QGuiApplication.instance()
        app.screenAdded.connect(self._screen_added)
        app.screenRemoved.connect(lambda _: self._update())
        app.primaryScreenChanged.connect(lambda _: self._update())

    # ---- what QML sees ----
    @Property('QVariantList', notify=changed)
    def displays(self):
        primary = QGuiApplication.primaryScreen()
        return [{'index': i, 'name': s.name(), 'label': s.model() or s.manufacturer() or s.name(), 'width': s.size().width(), 'height': s.size().height(),
                 'primary': s is primary, 'audience': i == self.target} for i, s in enumerate(QGuiApplication.screens())]

    @Property(int, notify=changed)
    def target(self):
        """The TV's screen index, or -1 for a preview window on the desk's screen."""
        screens, primary = QGuiApplication.screens(), QGuiApplication.primaryScreen()
        chosen = self._prefs.value('audience', '', str)
        if chosen:
            for i, s in enumerate(screens):
                if s.name() == chosen:
                    return i
        others = [i for i, s in enumerate(screens) if s is not primary]
        return others[0] if others else -1

    @Property(bool, notify=changed)
    def fullScreen(self):
        return self.target >= 0

    @Property(bool, notify=changed)
    def open(self):
        return self._open

    @Property(bool, notify=changed)
    def blanked(self):
        return self._blanked

    @Property(bool, notify=changed)
    def autoOpen(self):
        return self._prefs.value('autoOpen', True, bool)

    @Property(bool, constant=True)
    def canPlace(self):
        """False on pure Wayland, where the quizmaster places the TV window by hand."""
        return QGuiApplication.platformName() != 'wayland'

    @Property(str, notify=changed)
    def chosenName(self):
        return self._prefs.value('audience', '', str)

    # ---- what the quizmaster does ----
    @Slot()
    def toggle(self):
        self._open = not self._open
        if not self._open:
            self._blanked = False
        self.changed.emit()

    @Slot(bool)
    def setOpen(self, on):
        if on != self._open:
            self.toggle()

    @Slot(bool)
    def setBlank(self, on):
        self._blanked = on and self._open
        self.changed.emit()

    @Slot(str)
    def choose(self, name):
        """A screen by name, or '' for automatic."""
        self._prefs.setValue('audience', name)
        self.changed.emit()

    @Slot(str, result=str)
    def swap(self, desk_screen):
        """The TV goes to the desk's screen; returns the screen the TV was on, for the desk window to move to."""
        screens = QGuiApplication.screens()
        old = screens[self.target].name() if self.target >= 0 else ''
        if len(screens) < 2 or not old or old == desk_screen:
            return ''
        self._prefs.setValue('audience', desk_screen)
        self.changed.emit()
        return old

    @Slot(bool)
    def setAutoOpen(self, on):
        self._prefs.setValue('autoOpen', on)
        self.changed.emit()

    def _screen_added(self, _):
        if self.autoOpen and not self._open and len(QGuiApplication.screens()) > 1:
            self._open = True
        self._update()

    def _update(self):
        self.changed.emit()
