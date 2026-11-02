"""The Linux build: libraries each computer has its own of are left out (an old libxkbcommon crashed BeerMat on
CachyOS), and programs the desk starts use the computer's libraries, not the bundle's."""
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'packaging'))
import build  # noqa: E402
import entry  # noqa: E402


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


class SystemEnvironmentTest(unittest.TestCase):
    def test_programs_the_desk_starts_get_the_computers_own_libraries(self):
        """gdbus and the browser failed against the bundle's libraries (PyInstaller's LD_LIBRARY_PATH)."""
        env = {'LD_LIBRARY_PATH': '/tmp/.mount_BeerMa/usr/lib/beermat-desk/_internal', 'PATH': '/usr/bin'}
        entry.system_environment(env)
        self.assertEqual(env, {'PATH': '/usr/bin'})
        env = {'LD_LIBRARY_PATH': '/bundle/_internal', 'LD_LIBRARY_PATH_ORIG': '/opt/mine/lib'}
        entry.system_environment(env)
        self.assertEqual(env, {'LD_LIBRARY_PATH': '/opt/mine/lib'})


if __name__ == '__main__':
    unittest.main()
