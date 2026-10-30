"""Writes LICENCES.txt into a built BeerMat Desk folder: every piece of other people's software in it, with its licence.

Worked out from what's actually in the folder, so it stays right as the bundle changes: Qt and PySide6 (LGPL 3) and
what the Qt wheels bring (FFmpeg, ICU), Python, Node.js (its LICENSE lists what Node itself includes), each Python
package in the bundle, PyInstaller's bootloader and, on Linux, each system library PyInstaller copied in, with the
copyright file of the package it came from. Full texts of the GNU licences go at the end.

    python native/packaging/licences.py <built app folder>
"""
import importlib.metadata as metadata
import re
import shutil
import subprocess
import sys
import sysconfig
from pathlib import Path

HERE = Path(__file__).resolve().parent
TEXTS = HERE / 'licences'
RULE = '=' * 100
QT_DISTS = {'pyside6', 'pyside6-essentials', 'pyside6-addons', 'shiboken6'}
# Libraries the Qt wheels bring, which have their own sections (PyInstaller puts them beside the system ones on Linux).
QT_LIBS = ('libQt6', 'libpyside6', 'libshiboken6', 'libpython', 'libav', 'libsw', 'libicu')
normal = lambda name: re.sub(r'[-_.]+', '-', name or '').lower()
BUILD_ONLY = {'pyinstaller', 'pyinstaller-hooks-contrib', 'altgraph', 'pip'}


def section(title, *parts):
    return '\n'.join([RULE, title, RULE, '', *[p.strip('\n') + '\n' for p in parts if p]])


def python_licence():
    for candidate in (Path(sys.base_prefix) / 'LICENSE.txt', Path(sysconfig.get_path('stdlib')) / 'LICENSE.txt'):
        if candidate.exists():
            return candidate.read_text(encoding='utf-8', errors='replace')
    sys.exit('Python LICENSE.txt not found')


def bundled(internal, dist):
    """Whether a Python distribution's code is in the bundle (PyInstaller copies modules, not their metadata)."""
    try:
        names = (dist.read_text('top_level.txt') or '').split()
    except Exception:
        names = []
    names += {f.parts[0] for f in dist.files or [] if len(f.parts) > 1 and not f.parts[0].endswith(('.dist-info', '.egg-info', '.data')) and f.parts[0] != '..'}
    names += [f.stem for f in dist.files or [] if len(f.parts) == 1 and f.suffix == '.py']
    return any((internal / n).is_dir() or (internal / f'{n}.py').exists() or (internal / f'{n}.pyc').exists() or any(internal.glob(f'{n}.*.so')) or any(internal.glob(f'{n}.*.pyd'))
               for n in set(names) if n and not n.startswith('_distutils_hack'))


def python_packages(internal):
    out, seen = [], set()
    for dist in sorted(metadata.distributions(), key=lambda d: normal(d.metadata['Name'])):
        name = dist.metadata['Name'] or ''
        if normal(name) in seen | QT_DISTS | BUILD_ONLY or not bundled(internal, dist):
            continue
        seen.add(normal(name))
        texts = [f for f in dist.files or [] if re.search(r'(LICEN[CS]E|COPYING|NOTICE)', f.name, re.I) and '.dist-info' in str(f)]
        body = '\n\n'.join(Path(dist.locate_file(f)).read_text(encoding='utf-8', errors='replace') for f in texts)
        licence = dist.metadata.get('License-Expression') or (dist.metadata.get('License') or '').splitlines()[0:1]
        licence = licence if isinstance(licence, str) else ''.join(licence)
        out.append(section(f'{name} {dist.version} (Python package){" — " + licence if licence else ""}',
                           body or f'Licence: {licence or "see " + (dist.metadata.get("Home-page") or "its project page")}'))
    return out


def owner(lib, found):
    """The system package a library came from, and its copyright text (Debian/Ubuntu, where releases are built; Arch for a local build)."""
    paths = [line.split(' => ')[1] for line in found.splitlines() if line.strip().startswith(lib.name + ' ') and ' => ' in line]
    for path in paths + [str(Path(p).resolve()) for p in paths]:
        if shutil.which('dpkg-query'):
            r = subprocess.run(['dpkg-query', '-S', path], capture_output=True, text=True)
            if r.returncode == 0:
                pkg = r.stdout.split(':')[0].strip()
                copyright = Path('/usr/share/doc') / pkg / 'copyright'
                return pkg, copyright.read_text(encoding='utf-8', errors='replace') if copyright.exists() else ''
        if shutil.which('pacman'):
            r = subprocess.run(['pacman', '-Qqo', path], capture_output=True, text=True)
            if r.returncode == 0:
                pkg = r.stdout.strip()
                info = subprocess.run(['pacman', '-Qi', pkg], capture_output=True, text=True).stdout
                licence = next((l.split(':', 1)[1].strip() for l in info.splitlines() if l.startswith('Licenses')), '')
                texts = sorted((Path('/usr/share/licenses') / pkg).glob('*')) if (Path('/usr/share/licenses') / pkg).is_dir() else []
                return pkg, '\n\n'.join([f'Licence: {licence}'] + [t.read_text(encoding='utf-8', errors='replace') for t in texts if t.is_file()])
    return None, ''


def system_libraries(internal):
    """Linux: shared libraries PyInstaller copied from the build machine (not Python's, Qt's or a package's own)."""
    libs = sorted(p for p in internal.glob('*.so*') if p.is_file() and not p.name.startswith(QT_LIBS) and '.cpython-' not in p.name)
    packages, unknown, found = {}, [], subprocess.run(['ldconfig', '-p'], capture_output=True, text=True).stdout
    for lib in libs:
        pkg, text = owner(lib, found)
        if pkg:
            packages.setdefault(pkg, [text, []])[1].append(lib.name)
        else:
            unknown.append(lib.name)
    out = [section(f'{pkg} (system package): {", ".join(names)}', text or 'Licence: see the package\'s copyright file.') for pkg, (text, names) in sorted(packages.items())]
    if unknown:
        print('LICENCES.txt: no package found for', ', '.join(unknown), file=sys.stderr)
        out.append(section('Other system libraries', 'From the build system; their package could not be found: ' + ', '.join(unknown)))
    return out


def write(app, version):
    app = Path(app)
    internal = app / '_internal'
    qt_libs = internal / 'PySide6' / 'Qt' / 'lib' if (internal / 'PySide6' / 'Qt' / 'lib').exists() else internal / 'PySide6'
    has = lambda pattern: any(qt_libs.glob(pattern)) or any(internal.glob(pattern))
    pyside = next((d for d in metadata.distributions() if normal(d.metadata['Name']) in ('pyside6-essentials', 'pyside6')), None)
    qt_version = pyside.version if pyside else ''
    node = internal / 'runtime' / 'LICENSE'
    parts = [
        f'BeerMat Desk {version}\n\nBeerMat is BeerMat\'s own software: https://beermatquiz.co.uk/terms. It is built with the software below, '
        'each under its own licence, given in full here. Its sounds are public domain and its font is Fredoka '
        '(SIL Open Font License, _internal/brand/Fredoka-OFL.txt); https://beermatquiz.co.uk/credits lists them.\n',
        section(f'Qt and Qt for Python (PySide6, Shiboken6) {qt_version} — GNU LGPL v3',
                'BeerMat Desk uses the Qt libraries and Qt for Python, which are covered by the GNU Lesser General Public '
                'License version 3 (below, with the GNU GPL version 3 it builds on). They are unmodified, in _internal/PySide6 '
                'and _internal/shiboken6, and can be replaced with another build of the same version.\n'
                f'Source: https://download.qt.io/official_releases/QtForPython/ (pyside-setup-everywhere-src-{qt_version}) and '
                'https://code.qt.io/. Qt\'s own third-party parts and their licences: https://doc.qt.io/qt-6/licenses-used-in-qt.html'),
    ]
    if has('libavcodec*') or has('avcodec*.dll'):
        parts.append(section('FFmpeg (with Qt Multimedia) — GNU LGPL v2.1 or later',
                             'The FFmpeg libraries (avcodec, avformat, avutil, swresample, swscale) come with Qt Multimedia, unmodified. '
                             'Source: https://ffmpeg.org/download.html and https://download.qt.io/. Licence text below.'))
    if has('libicu*') or has('icu*.dll'):
        parts.append(section('ICU (with Qt) — Unicode License v3', (TEXTS / 'unicode.txt').read_text(encoding='utf-8')))
    parts.append(section(f'Python {sys.version.split()[0]} — PSF License', python_licence()))
    if node.exists():
        parts.append(section('Node.js — MIT (and the licences of what Node.js includes)', node.read_text(encoding='utf-8', errors='replace')))
    parts.append(section('PyInstaller bootloader — GNU GPL v2 or later, with the PyInstaller bootloader exception',
                         'The program that starts BeerMat Desk is PyInstaller\'s bootloader. Its licence\'s exception allows it to be '
                         'distributed with any program, under that program\'s own terms. https://pyinstaller.org/en/stable/license.html'))
    parts += python_packages(internal)
    if sys.platform.startswith('linux'):
        parts += system_libraries(internal)
    elif sys.platform == 'win32':
        parts.append(section('Microsoft Visual C++ runtime', 'vcruntime and msvcp DLLs, redistributed under Microsoft\'s Visual Studio redistribution terms.'))
    parts += [section('GNU Lesser General Public License version 3', (TEXTS / 'lgpl-3.0.txt').read_text()),
              section('GNU General Public License version 3', (TEXTS / 'gpl-3.0.txt').read_text()),
              section('GNU Lesser General Public License version 2.1', (TEXTS / 'lgpl-2.1.txt').read_text())]
    (app / 'LICENCES.txt').write_text('\n'.join(parts), encoding='utf-8', newline='\r\n' if sys.platform == 'win32' else '\n')
    return app / 'LICENCES.txt'


if __name__ == '__main__':
    import json
    print(write(sys.argv[1], json.loads((HERE.parents[1] / 'package.json').read_text())['version']))
