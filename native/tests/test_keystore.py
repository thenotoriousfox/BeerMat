"""The quizmaster key: in the keychain when there is one (an existing key file moves into it), in an owner-only file
otherwise, and the same key every time for the same data folder."""
import os
import stat
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from beermat_desk.keystore import load_key   # noqa: E402


class Keychain:
    def __init__(self, broken=False):
        self.items, self.broken = {}, broken

    def get_password(self, service, account):
        if self.broken:
            raise RuntimeError('locked')
        return self.items.get((service, account))

    def set_password(self, service, account, value):
        self.items[(service, account)] = value


class KeystoreTest(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.data = Path(self.dir.name)

    def tearDown(self):
        self.dir.cleanup()

    def test_file_when_there_is_no_keychain(self):
        key, kept = load_key(self.data, backend=None)
        self.assertEqual(kept, 'file')
        self.assertEqual(stat.S_IMODE(os.stat(self.data / 'host-key').st_mode), 0o600)
        self.assertEqual(load_key(self.data, backend=None)[0], key)

    def test_keychain_and_moving_an_old_file_into_it(self):
        old, _ = load_key(self.data, backend=None)
        chain = Keychain()
        key, kept = load_key(self.data, backend=chain)
        self.assertEqual((key, kept), (old, 'keychain'))
        self.assertFalse((self.data / 'host-key').exists(), 'the file is gone once the key is in the keychain')
        self.assertEqual(load_key(self.data, backend=chain)[0], old)

    def test_a_locked_keychain_falls_back_to_the_file(self):
        key, kept = load_key(self.data, backend=Keychain(broken=True))
        self.assertEqual(kept, 'file')
        self.assertEqual(load_key(self.data, backend=None)[0], key)

    def test_the_electron_apps_encrypted_copy_is_left_alone(self):
        (self.data / 'host-key').write_text('enc:opaque')
        key, kept = load_key(self.data, backend=Keychain())
        self.assertEqual(kept, 'keychain')
        self.assertEqual((self.data / 'host-key').read_text(), 'enc:opaque')
        self.assertNotEqual(key, 'enc:opaque')


if __name__ == '__main__':
    unittest.main()
