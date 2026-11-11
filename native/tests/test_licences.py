"""LICENCES.txt (native/packaging/licences.py): Qt under the LGPL with its texts, what the Qt wheels bring in its own
sections rather than as system libraries, Node's licence, cloudflared's, and Python's."""
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'packaging'))
import licences   # noqa: E402


class LicencesTest(unittest.TestCase):
    def test_a_bundle(self):
        with tempfile.TemporaryDirectory() as folder:
            app = Path(folder) / 'BeerMat-Desk'
            internal = app / '_internal'
            (internal / 'runtime').mkdir(parents=True)
            (internal / 'runtime' / 'LICENSE').write_text('Node.js is licensed for use as follows: MIT')
            (internal / 'runtime' / 'cloudflared').write_bytes(b'')
            for lib in ('libQt6Core.so.6', 'libavcodec.so.61', 'libicuuc.so.73', 'shiboken6.cpython-313-x86_64-linux-gnu.so'):
                (internal / lib).write_bytes(b'')
            text = licences.write(app, '9.9.9').read_text(encoding='utf-8')
        self.assertTrue(text.startswith('BeerMat Desk 9.9.9'))
        for heading in ('Qt and Qt for Python', 'FFmpeg (with Qt Multimedia)', 'ICU (with Qt)', 'PSF License', 'Node.js — MIT', 'cloudflared (Cloudflare) — Apache License 2.0',
                        'PyInstaller bootloader', 'GNU Lesser General Public License version 3', 'GNU General Public License version 3',
                        'GNU Lesser General Public License version 2.1'):
            self.assertIn(heading, text)
        self.assertIn('Node.js is licensed for use as follows', text)
        self.assertIn('Version 3, 29 June 2007', text)
        # The Qt wheels' libraries have their own sections: none is listed as an unknown system library.
        self.assertNotIn('Other system libraries', text)


if __name__ == '__main__':
    unittest.main()
