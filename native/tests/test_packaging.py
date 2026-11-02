"""The Linux build leaves out the libraries each computer has its own of (an old libxkbcommon crashed BeerMat on CachyOS)."""
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'packaging'))
import build  # noqa: E402


class SystemLibsTest(unittest.TestCase):
    def test_libxkbcommon_is_left_out_and_nothing_else(self):
        with tempfile.TemporaryDirectory() as folder:
            internal = Path(folder) / '_internal'
            internal.mkdir()
            names = ['libxkbcommon.so.0', 'libxkbcommon-x11.so.0', 'libxkbfile.so.1', 'libQt6XcbQpa.so.6']
            for name in names:
                (internal / name).write_bytes(b'')
            build.use_system_libs(Path(folder))
            self.assertEqual(sorted(p.name for p in internal.iterdir()), ['libQt6XcbQpa.so.6', 'libxkbfile.so.1'])


if __name__ == '__main__':
    unittest.main()
