"""Entry point for packaged builds (PyInstaller): the same as `python -m beermat_desk`."""
import sys

from beermat_desk.__main__ import main

if __name__ == '__main__':
    sys.exit(main())
