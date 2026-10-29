"""The quizmaster key: it unlocks the desk (here and from a browser), so it's kept in the system's keychain when there
is one (Windows Credential Manager, the Secret Service on Linux: KWallet or GNOME Keyring), through the `keyring`
library that packaged builds bundle; otherwise in a file only this user can read, as before. An existing key file is
moved into the keychain the first time it's available. The key can always be regenerated, so nothing is lost if the
keychain is cleared."""
import os
import secrets
from pathlib import Path

SERVICE = 'BeerMat Desk'


def _keyring():
    try:
        import keyring
        from keyring.backends import fail
        return None if isinstance(keyring.get_keyring(), fail.Keyring) else keyring
    except Exception:
        return None


def _write_file(file, key):
    file.parent.mkdir(parents=True, exist_ok=True)
    temporary = file.with_suffix('.tmp')
    temporary.write_text(key)
    os.chmod(temporary, 0o600)
    temporary.replace(file)


def load_key(data_dir, backend='default'):
    """The key for this data folder, and where it's kept ('keychain' or 'file')."""
    backend = _keyring() if backend == 'default' else backend
    file = Path(data_dir) / 'host-key'
    account = str(Path(data_dir).resolve())
    old = file.read_text().strip() if file.exists() else ''
    old = old if old and not old.startswith('enc:') else ''   # 'enc:' is the Electron app's own encrypted copy
    if backend is not None:
        try:
            key = backend.get_password(SERVICE, account)
            if not key:
                key = old or secrets.token_urlsafe(18)
                backend.set_password(SERVICE, account, key)
            if file.exists() and old:
                file.unlink()          # moved into the keychain
            return key, 'keychain'
        except Exception:
            pass                       # a locked or broken keychain: the file still works
    key = old or secrets.token_urlsafe(18)
    if not old:
        _write_file(file, key)
    return key, 'file'
