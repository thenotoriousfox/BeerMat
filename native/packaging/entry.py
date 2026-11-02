"""Entry point for packaged builds (PyInstaller): the same as `python -m beermat_desk`."""
import os
import sys

from beermat_desk.__main__ import main


def system_environment(env):
    """On Linux PyInstaller points LD_LIBRARY_PATH at the bundle's libraries, and everything the desk starts inherits
    it: the quiz server's gdbus (Spotify) and the browser for a link then load the bundle's older GLib and Qt and fail.
    The desk itself loaded its libraries already, so the computer's own setting goes back (PyInstaller kept it)."""
    if sys.platform.startswith('linux') and 'LD_LIBRARY_PATH' in env:
        original = env.pop('LD_LIBRARY_PATH_ORIG', None)
        if original is None:
            del env['LD_LIBRARY_PATH']
        else:
            env['LD_LIBRARY_PATH'] = original


if __name__ == '__main__':
    system_environment(os.environ)
    sys.exit(main())
