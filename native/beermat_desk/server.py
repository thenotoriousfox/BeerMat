"""The quiz server, run as a child process: the same desktop/server-host.js the Electron app uses, so the database
checks, backups, port choice and laptop controls are unchanged. Messages go over plain lines (BEERMAT_CHANNEL=stdio):
"@beermat <json>" on its stdout, commands as JSON lines on its stdin. Closing stdin shuts it down, so the server never
outlives the desk."""
import json
import os
import shutil
import sys
from pathlib import Path

from PySide6.QtCore import QObject, QProcess, QProcessEnvironment, QTimer, Signal

# The repository (or, in a packaged build, the bundle's data folder, laid out the same way: server/, web/, desktop/,
# native/beermat_desk/qml/, runtime/ for Node).
ROOT = Path(sys._MEIPASS) if getattr(sys, 'frozen', False) else Path(__file__).resolve().parents[2]


def node_binary():
    """The Node.js runtime: BEERMAT_NODE, one bundled next to the app (packaged builds), or the one on the PATH."""
    bundled = ROOT / 'runtime' / ('node.exe' if os.name == 'nt' else 'bin/node')
    return os.environ.get('BEERMAT_NODE') or (str(bundled) if bundled.exists() else shutil.which('node'))


class QuizServer(QObject):
    ready = Signal(dict)       # {port, publicPort, database, prepared}
    failed = Signal(str)       # it couldn't start
    stopped = Signal(int)      # it exited after starting (a crash, unless we asked)
    message = Signal(dict)     # anything else it says (tickets, backups, quit)
    log = Signal(str)

    def __init__(self, data_dir, host_key, port=3000, laptop=True, parent=None):
        super().__init__(parent)
        self.data_dir, self.host_key, self.port, self.laptop = Path(data_dir), host_key, port, laptop
        self.info = None
        self._process = None
        self._buffer = b''
        self._stopping = False

    def start(self):
        node = node_binary()
        if not node:
            self.failed.emit('Node.js was not found. Install Node.js 22.13 or later, or set BEERMAT_NODE.')
            return
        self.info, self._buffer, self._stopping = None, b'', False
        env = QProcessEnvironment.systemEnvironment()
        for name, value in {'BEERMAT_CHANNEL': 'stdio', 'HOST_KEY': self.host_key, 'BEERMAT_DATA': str(self.data_dir), 'PORT': str(self.port),
                            **({} if self.laptop else {'BEERMAT_LAPTOP': '0'})}.items():
            env.insert(name, value)
        process = self._process = QProcess(self)
        process.setProcessEnvironment(env)
        process.setWorkingDirectory(str(ROOT))
        process.readyReadStandardOutput.connect(self._read)
        process.readyReadStandardError.connect(lambda: self.log.emit(bytes(process.readAllStandardError()).decode(errors='replace').rstrip()))
        process.finished.connect(self._finished)
        process.errorOccurred.connect(lambda e: self.failed.emit(f'The quiz server could not start ({e.name})') if self.info is None and e == QProcess.ProcessError.FailedToStart else None)
        self.data_dir.mkdir(parents=True, exist_ok=True)
        process.start(node, ['--disable-warning=ExperimentalWarning', str(ROOT / 'desktop' / 'server-host.js')])

    def send(self, message):
        if self._process and self._process.state() == QProcess.ProcessState.Running:
            self._process.write((json.dumps(message) + '\n').encode())

    def stop(self, stop_wifi=False, timeout_ms=10000):
        """Ask it to shut down; kill it if it doesn't. Returns once it has gone."""
        if not self._process or self._process.state() == QProcess.ProcessState.NotRunning:
            return
        self._stopping = True
        self.send({'type': 'shutdown', 'stopWifi': stop_wifi})
        self._process.closeWriteChannel()
        if not self._process.waitForFinished(120000 if stop_wifi else timeout_ms):
            self._process.kill()
            self._process.waitForFinished(3000)

    def _read(self):
        self._buffer += bytes(self._process.readAllStandardOutput())
        *lines, self._buffer = self._buffer.split(b'\n')
        for raw in lines:
            line = raw.decode(errors='replace')
            if not line.startswith('@beermat '):
                if line.strip():
                    self.log.emit(line)
                continue
            try:
                message = json.loads(line[9:])
            except ValueError:
                continue
            if message.get('type') == 'ready':
                self.info = message
                self.ready.emit(message)
            elif message.get('type') == 'failed':
                self.failed.emit(message.get('message', 'The quiz server could not start'))
            else:
                self.message.emit(message)

    def _finished(self, code, _status):
        if self.info is None and not self._stopping:
            self.failed.emit(f'The quiz server stopped while starting (exit {code}). See the logs.')
        elif not self._stopping:
            self.stopped.emit(code)
