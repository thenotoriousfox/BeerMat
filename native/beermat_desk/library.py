"""The quiz library, edited on the desk: a working copy of the server's library (rounds and questions) that the
Quizzes workspace changes field by field and saves with /api/host/library/save. The server validates every question
(server/model.js validateQuestion) and answers with a sentence when something's missing, so the rules for each format
live there, not here. Fields the native editor doesn't show (Evil Mode, speed bonus, buzzer and bingo options, …) are
kept exactly as they are."""
import copy
import json
import secrets
from pathlib import Path

from PySide6.QtCore import Property, QObject, QUrl, Signal, Slot

# Formats a question can be, as the web desk names them.
TYPES = [('text', 'Typed answer'), ('choice', 'Multiple choice'), ('multi', 'Tick all that apply'), ('letter', 'Letter keypad'),
         ('number', 'Number'), ('nearest', 'Nearest wins'), ('sequence', 'Put in order'), ('pinpoint', 'Pinpoint'), ('wordsnake', 'Word snake'),
         ('tiles', 'Letter tiles'), ('vote', 'Vote'), ('buzzer', 'Buzzer'), ('bingo', 'Bingo'), ('musicbingo', 'Music bingo'), ('clips', 'Sound clips'),
         ('picture', 'Picture'), ('audio', 'Audio'), ('sheet', 'Answer sheet')]
# The fields the native editor shows; which ones apply depends on the format.
LIST_FIELDS = {'options', 'correct', 'items', 'itemAnswers', 'aliases'}
FIELDS_BY_TYPE = {
    'choice': ['options', 'answer'], 'vote': ['options'], 'multi': ['options', 'correct'], 'sequence': ['items'],
    'sheet': ['items', 'itemAnswers'], 'picture': ['media', 'answer', 'aliases'], 'audio': ['media', 'answer', 'aliases'],
    'pinpoint': ['media'], 'text': ['answer', 'aliases'], 'letter': ['answer'], 'number': ['answer'], 'nearest': ['answer'], 'tiles': ['answer'],
    'wordsnake': ['answer'], 'buzzer': ['answer'],
}


class Library(QObject):
    changed = Signal()
    toast = Signal(str, bool)

    def __init__(self, api, parent=None):
        super().__init__(parent)
        self.api = api
        self._server, self._draft, self._dirty = None, None, False
        self._selected = (-1, -1)

    # ---- the server's copy ----
    def received(self, library):
        """A fresh library from the server. Unsaved edits are kept (the save then reports the conflict)."""
        self._server = library
        if not self._dirty:
            self._draft = copy.deepcopy(library)
        self.changed.emit()

    # ---- what QML sees ----
    @Property(bool, notify=changed)
    def dirty(self):
        return self._dirty

    @Property(str, notify=changed)
    def title(self):
        return (self._draft or {}).get('title', '')

    @Property('QVariantList', constant=True)
    def types(self):
        return [{'value': v, 'text': t} for v, t in TYPES]

    @Property('QVariantList', notify=changed)
    def outline(self):
        """Rounds and their questions, flattened for a list: a round row, then its questions."""
        rows = []
        names = dict(TYPES)
        for r, rnd in enumerate((self._draft or {}).get('rounds', [])):
            rows.append({'kind': 'round', 'round': r, 'question': -1, 'text': rnd.get('title') or f'Round {r + 1}', 'count': len(rnd.get('questions', []))})
            for i, q in enumerate(rnd.get('questions', [])):
                rows.append({'kind': 'question', 'round': r, 'question': i, 'text': q.get('text') or q.get('title') or '(no question yet)',
                             'type': names.get(q.get('type'), q.get('type', '')), 'selected': (r, i) == self._selected,
                             'tieBreaker': bool(q.get('tieBreaker'))})
        return rows

    @Property('QVariantMap', notify=changed)
    def question(self):
        """The selected question as the editor shows it: list fields as lines of text."""
        q = self._current()
        if q is None:
            return {}
        shown = {k: ('\n'.join(map(str, q.get(k) or [])) if k in LIST_FIELDS else q.get(k)) for k in q}
        shown['fields'] = FIELDS_BY_TYPE.get(q.get('type'), [])
        shown['round'], shown['index'] = self._selected
        shown['roundTitle'] = self._draft['rounds'][self._selected[0]].get('title', '')
        shown['answer'] = '' if q.get('answer') is None else str(q.get('answer'))
        return shown

    def _current(self):
        r, i = self._selected
        try:
            return self._draft['rounds'][r]['questions'][i] if r >= 0 and i >= 0 else None
        except (KeyError, IndexError, TypeError):
            return None

    def _touch(self):
        self._dirty = True
        self.changed.emit()

    # ---- editing ----
    @Slot(int, int)
    def select(self, r, i):
        self._selected = (r, i)
        self.changed.emit()

    @Slot(str)
    def setTitle(self, title):
        if self._draft is not None and title != self._draft.get('title'):
            self._draft['title'] = title
            self._touch()

    @Slot(str, 'QVariant')
    def setField(self, field, value):
        q = self._current()
        if q is None:
            return
        if field in LIST_FIELDS:
            value = [line.strip() for line in str(value).split('\n') if line.strip()]
        elif field in ('points', 'seconds'):
            value = int(value)
        if value in ('', [], None) and field not in ('text',):
            q.pop(field, None)
        else:
            q[field] = value
        self._touch()

    @Slot(str)
    def setType(self, kind):
        q = self._current()
        if q is not None and q.get('type') != kind:
            q['type'] = kind
            self._touch()

    @Slot(int)
    def addQuestion(self, r):
        rounds = self._draft.setdefault('rounds', [])
        if not rounds:
            rounds.append({'id': 'r' + secrets.token_hex(4), 'title': 'Round 1', 'questions': []})
            r = 0
        questions = rounds[r].setdefault('questions', [])
        questions.append({'id': 'q' + secrets.token_hex(4), 'type': 'text', 'text': '', 'answer': '', 'points': 1, 'seconds': 30})
        self._selected = (r, len(questions) - 1)
        self._touch()

    @Slot()
    def duplicateQuestion(self):
        q = self._current()
        if q is None:
            return
        r, i = self._selected
        copy_ = copy.deepcopy(q)
        copy_['id'] = 'q' + secrets.token_hex(4)
        self._draft['rounds'][r]['questions'].insert(i + 1, copy_)
        self._selected = (r, i + 1)
        self._touch()

    @Slot()
    def deleteQuestion(self):
        r, i = self._selected
        if self._current() is None:
            return
        del self._draft['rounds'][r]['questions'][i]
        self._selected = (-1, -1)
        self._touch()

    @Slot(int)
    def moveQuestion(self, step):
        r, i = self._selected
        questions = (self._draft or {}).get('rounds', [{}])[r].get('questions', []) if r >= 0 else []
        j = i + step
        if self._current() is None or not 0 <= j < len(questions):
            return
        questions[i], questions[j] = questions[j], questions[i]
        self._selected = (r, j)
        self._touch()

    @Slot()
    def addRound(self):
        rounds = self._draft.setdefault('rounds', [])
        rounds.append({'id': 'r' + secrets.token_hex(4), 'title': f'Round {len(rounds) + 1}', 'questions': []})
        self._touch()

    @Slot(int, str)
    def renameRound(self, r, title):
        if title.strip() and self._draft['rounds'][r].get('title') != title:
            self._draft['rounds'][r]['title'] = title.strip()
            self._touch()

    @Slot(int)
    def deleteRound(self, r):
        del self._draft['rounds'][r]
        self._selected = (-1, -1)
        self._touch()

    # ---- saving ----
    @Slot()
    def save(self):
        """Saved only if nobody else changed the quiz meanwhile (revision); the server checks every question."""
        if not self._dirty:
            return

        def saved(library):
            self._dirty = False
            self.received(library)
            self.toast.emit('Quiz saved', False)

        self.api.host('library/save', {'revision': (self._server or {}).get('revision', 0), 'quiz': self._draft}, saved,
                      lambda e: self.toast.emit(f'Not saved: {e}', True))

    @Slot()
    def revert(self):
        self._dirty = False
        self._draft = copy.deepcopy(self._server)
        self._selected = (-1, -1)
        self.changed.emit()

    @Slot(QUrl)
    def export(self, url):
        """The quiz as a BeerMat quiz file (as the web desk's Download quiz; pictures and sounds stay on this laptop)."""
        path = Path(url.toLocalFile() if isinstance(url, QUrl) else str(url))
        quiz = {k: v for k, v in (self._server or {}).items() if k != 'revision'}
        try:
            path.write_text(json.dumps(quiz, indent=2, ensure_ascii=False), encoding='utf-8')
            self.toast.emit(f'Quiz saved to {path.name}', False)
        except OSError as e:
            self.toast.emit(f'Could not write {path.name}: {e}', True)
