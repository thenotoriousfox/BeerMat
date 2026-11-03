"""The desk plays clips in clip_order: a sound clips game's as listed; ordering audio clips (a put in order question
with a clip per item) in the order phones show the items, never the right one."""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from beermat_desk.live import clip_order  # noqa: E402


class ClipOrderTest(unittest.TestCase):
    def test_clips_game_as_listed_and_ordering_in_the_phones_order(self):
        self.assertEqual(clip_order({'type': 'clips', 'clips': [{}, {}, {}]}), [0, 1, 2])
        self.assertEqual(clip_order({'type': 'sequence', 'clips': [{}, {}, {}], 'order': [2, 0, 1]}), [2, 0, 1])
        self.assertEqual(clip_order({'type': 'sequence', 'items': ['a', 'b']}), [], 'no clips: nothing to play')
        self.assertEqual(clip_order({'type': 'text'}), [])


if __name__ == '__main__':
    unittest.main()
