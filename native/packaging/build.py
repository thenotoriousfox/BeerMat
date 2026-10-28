"""Builds the self-contained BeerMat Desk: Python, Qt (PySide6 Essentials) and Node.js bundled, so users install
nothing else. Run it on the system you're building for (PyInstaller doesn't cross-compile):

    python -m venv .venv && .venv/bin/pip install PySide6-Essentials==6.11.1 pyinstaller
    .venv/bin/python native/packaging/build.py              # Linux: dist/native/BeerMat-Desk-<v>-linux-x64.tar.gz (+ AppImage)
    .venv\\Scripts\\python native\\packaging\\build.py         # Windows: dist\\native\\BeerMat-Desk-<v>-win-x64.zip (+ installer)

Node.js comes from nodejs.org (checked against its published SHA-256) and is cached in native/packaging/cache.
The AppImage needs appimagetool on the PATH (or APPIMAGETOOL); the Windows installer needs Inno Setup's iscc.
"""
import hashlib
import json
import os
import platform
import shutil
import subprocess
import sys
import tarfile
import urllib.request
import zipfile
from pathlib import Path

NODE_VERSION = 'v24.22.0'   # an LTS with node:sqlite (the server needs 22.13+)
HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
CACHE, OUT = HERE / 'cache', ROOT / 'dist' / 'native'
VERSION = json.loads((ROOT / 'package.json').read_text())['version']
WINDOWS = os.name == 'nt'
ARCH = {'x86_64': 'x64', 'amd64': 'x64', 'aarch64': 'arm64', 'arm64': 'arm64'}[platform.machine().lower()]
TARGET = f'{"win" if WINDOWS else "linux"}-{ARCH}'

# What the quiz server and the desk read at run time (as the Electron build's "files", minus Electron).
DATA = ['package.json', 'server', 'web', 'shared', 'desktop/server-host.js', 'desktop/database.js', 'sounds', 'themes',
        'brand/mark.svg', 'brand/wordmark.svg', 'brand/icon.svg', 'brand/fredoka.woff2', 'brand/Fredoka-OFL.txt',
        'media/README.md', 'scripts/hotspot.py', 'scripts/hotspot-windows.ps1', 'native/beermat_desk/qml']
# Qt parts the desk doesn't use, left out to keep the download small.
EXCLUDE = ['PySide6.QtWebEngineCore', 'PySide6.QtWebEngineWidgets', 'PySide6.QtWebEngineQuick', 'PySide6.Qt3DCore', 'PySide6.QtCharts',
           'PySide6.QtDataVisualization', 'PySide6.QtPdf', 'PySide6.QtSql', 'PySide6.QtTest', 'PySide6.QtDesigner', 'tkinter']


def node_runtime():
    """Downloads and verifies the official Node.js build; returns the folder to bundle as runtime/."""
    name = f'node-{NODE_VERSION}-{TARGET}'
    archive = CACHE / (name + ('.zip' if WINDOWS else '.tar.xz'))
    CACHE.mkdir(parents=True, exist_ok=True)
    if not archive.exists():
        base = f'https://nodejs.org/dist/{NODE_VERSION}/'
        sums = urllib.request.urlopen(base + 'SHASUMS256.txt', timeout=30).read().decode()
        expected = next(line.split()[0] for line in sums.splitlines() if line.endswith(' ' + archive.name))
        print('Downloading', archive.name)
        data = urllib.request.urlopen(base + archive.name, timeout=300).read()
        if hashlib.sha256(data).hexdigest() != expected:
            sys.exit(f'{archive.name}: checksum mismatch')
        archive.write_bytes(data)
    folder = CACHE / name
    if not folder.exists():
        (zipfile.ZipFile(archive) if WINDOWS else tarfile.open(archive)).extractall(CACHE)
    runtime = CACHE / f'runtime-{TARGET}'
    shutil.rmtree(runtime, ignore_errors=True)
    if WINDOWS:
        runtime.mkdir(); shutil.copy2(folder / 'node.exe', runtime / 'node.exe')
    else:
        (runtime / 'bin').mkdir(parents=True); shutil.copy2(folder / 'bin' / 'node', runtime / 'bin' / 'node')
    shutil.copy2(folder / 'LICENSE', runtime / 'LICENSE')
    return runtime


def pyinstaller(runtime):
    sep = ';' if WINDOWS else ':'
    data = [f'--add-data={ROOT / d}{sep}{d if (ROOT / d).is_dir() else str(Path(d).parent)}' for d in DATA]
    icon = ROOT / 'build' / ('icon.ico' if WINDOWS else 'icon.png')
    args = [sys.executable, '-m', 'PyInstaller', '--noconfirm', '--clean', '--windowed', '--name', 'BeerMat-Desk',
            '--distpath', str(OUT / 'pyinstaller'), '--workpath', str(OUT / 'work'), '--specpath', str(OUT / 'work'),
            '--paths', str(ROOT / 'native'), f'--add-data={runtime}{sep}runtime', *data,
            *[f'--exclude-module={m}' for m in EXCLUDE], *([f'--icon={icon}'] if icon.exists() else []),
            '--hidden-import=PySide6.QtQuickControls2', str(HERE / 'entry.py')]
    subprocess.run(args, check=True)
    return OUT / 'pyinstaller' / 'BeerMat-Desk'


def linux(app):
    stem = f'BeerMat-Desk-{VERSION}-{TARGET}'
    with tarfile.open(OUT / f'{stem}.tar.gz', 'w:gz') as tar:
        tar.add(app, arcname=stem)
    print('Built', OUT / f'{stem}.tar.gz')
    tool = os.environ.get('APPIMAGETOOL') or shutil.which('appimagetool')
    if not tool:
        print('appimagetool not found: AppImage skipped')
        return
    appdir = OUT / 'BeerMat-Desk.AppDir'
    shutil.rmtree(appdir, ignore_errors=True)
    shutil.copytree(app, appdir / 'usr' / 'lib' / 'beermat-desk')
    (appdir / 'AppRun').write_text('#!/bin/sh\nexec "$(dirname "$(readlink -f "$0")")/usr/lib/beermat-desk/BeerMat-Desk" "$@"\n')
    (appdir / 'AppRun').chmod(0o755)
    (appdir / 'beermat-desk.desktop').write_text('[Desktop Entry]\nType=Application\nName=BeerMat Desk\nComment=Run a pub quiz\nExec=BeerMat-Desk\n'
                                                 'Icon=beermat-desk\nCategories=Game;\nStartupWMClass=BeerMat Desk\n')
    shutil.copy2(ROOT / 'build' / 'icon.png', appdir / 'beermat-desk.png')
    image = OUT / f'{stem}.AppImage'
    subprocess.run([tool, str(appdir), str(image)], check=True, env={**os.environ, 'ARCH': platform.machine()})
    print('Built', image)


def windows(app):
    stem = f'BeerMat-Desk-{VERSION}-{TARGET}'
    shutil.make_archive(str(OUT / stem), 'zip', app.parent, app.name)
    print('Built', OUT / f'{stem}.zip')
    iscc = shutil.which('iscc') or r'C:\Program Files (x86)\Inno Setup 6\ISCC.exe'
    if Path(iscc).exists() or shutil.which('iscc'):
        subprocess.run([iscc, f'/DAppVersion={VERSION}', f'/DSource={app}', f'/O{OUT}', str(HERE / 'beermat-desk.iss')], check=True)
    else:
        print('Inno Setup not found: installer skipped')


if __name__ == '__main__':
    app = pyinstaller(node_runtime())
    windows(app) if WINDOWS else linux(app)
