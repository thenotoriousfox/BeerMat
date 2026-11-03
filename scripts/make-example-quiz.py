#!/usr/bin/env python3
"""Writes examples/example-quiz.json: the example quiz that comes with BeerMat, one question in every format, with its
pictures and sounds inside. Everything in it is BeerMat's own or public domain (sounds/CREDITS.md lists them):

- the flag is drawn here, and the world map is drawn here from Natural Earth's land outlines (public domain);
- the speeches are the Famous Moments BeerMat already ships (US government recordings);
- the music bingo tunes are public-domain melodies, played here by a small synthesiser.

    curl -fsSLO https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_land.geojson
    python3 scripts/make-example-quiz.py ne_50m_land.geojson

Needs Pillow and ffmpeg. The file it writes is committed; run it again only to change the quiz.
"""
import base64
import io
import json
import math
import struct
import subprocess
import sys
import tempfile
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
MOMENTS = ROOT / 'sounds' / 'buzzers' / 'Famous Moments'


def data_url(kind, data):
    return f'data:{kind};base64,' + base64.b64encode(data).decode()


def png(image):
    out = io.BytesIO()
    image.save(out, 'PNG', optimize=True)
    return data_url('image/png', out.getvalue())


def mp3(path):
    return data_url('audio/mpeg', Path(path).read_bytes())


# ---- pictures ------------------------------------------------------------------------------------------------------
def jamaica(width=900):
    """Jamaica's flag (1:2): a gold saltire, green above and below, black at the hoist and fly. Drawn at 2x, then halved."""
    w, h = width * 2, width
    image = Image.new('RGB', (w, h), (0, 155, 58))
    draw = ImageDraw.Draw(image)
    draw.polygon([(0, 0), (w / 2, h / 2), (0, h)], fill=(0, 0, 0))
    draw.polygon([(w, 0), (w / 2, h / 2), (w, h)], fill=(0, 0, 0))
    band = h / 6
    for a, b in (((0, 0), (w, h)), ((0, h), (w, 0))):
        dx, dy = b[0] - a[0], b[1] - a[1]
        length = math.hypot(dx, dy)
        nx, ny = -dy / length * band / 2, dx / length * band / 2
        draw.polygon([(a[0] + nx, a[1] + ny), (b[0] + nx, b[1] + ny), (b[0] - nx, b[1] - ny), (a[0] - nx, a[1] - ny)], fill=(254, 209, 0))
    return image.resize((width, width // 2), Image.LANCZOS)


# The map: equirectangular, cut to 84°N–58°S (no Antarctica), so a point's place on the picture is easy to work out.
NORTH, SOUTH, MAP_WIDTH = 84, -58, 1200
MAP_HEIGHT = round(MAP_WIDTH * (NORTH - SOUTH) / 360)


def on_map(lon, lat):
    return (lon + 180) / 360, (NORTH - lat) / (NORTH - SOUTH)


def world_map(land_file):
    scale = 2
    w, h = MAP_WIDTH * scale, MAP_HEIGHT * scale
    image = Image.new('RGB', (w, h), (24, 52, 92))
    draw = ImageDraw.Draw(image)
    for lon in range(-180, 181, 30):
        draw.line([(on_map(lon, 0)[0] * w, 0), (on_map(lon, 0)[0] * w, h)], fill=(34, 66, 110), width=scale)
    for lat in range(-30, 90, 30):
        y = on_map(0, lat)[1] * h
        draw.line([(0, y), (w, y)], fill=(34, 66, 110), width=scale)
    for feature in json.loads(Path(land_file).read_text())['features']:
        geometry = feature['geometry']
        polygons = [geometry['coordinates']] if geometry['type'] == 'Polygon' else geometry['coordinates']
        for polygon in polygons:
            outline = [(on_map(lon, lat)[0] * w, on_map(lon, lat)[1] * h) for lon, lat in polygon[0]]
            if len(outline) > 2:
                draw.polygon(outline, fill=(214, 196, 150), outline=(176, 156, 112))
    return image.resize((MAP_WIDTH, MAP_HEIGHT), Image.LANCZOS)


# ---- music bingo: public-domain tunes, played by a little synthesiser -------------------------------------------------
NOTES = {n: i for i, n in enumerate(['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'])}


def frequency(note):
    name, octave = note[:-1], int(note[-1])
    return 440 * 2 ** ((NOTES[name] + 12 * (octave + 1) - 69) / 12)


def tune(notes, bpm):
    """notes: 'C4:1 D4:0.5 ...' (beats; R is a rest). A soft, bell-like tone with a gentle fade on each note."""
    rate, out = 22050, []
    beat = 60 / bpm
    for token in notes.split():
        note, beats = token.split(':')
        seconds = float(beats) * beat
        count = int(seconds * rate)
        f = frequency(note) if note != 'R' else 0
        for i in range(count):
            t = i / rate
            envelope = min(1, t / 0.01) * math.exp(-2.2 * t) * min(1, (count - i) / (0.03 * rate))
            sample = sum(a * math.sin(2 * math.pi * f * k * t) for k, a in ((1, 1), (2, 0.35), (3, 0.12))) if f else 0
            out.append(int(max(-1, min(1, 0.45 * envelope * sample)) * 32767))
    out += [0] * int(0.6 * rate)
    wav = io.BytesIO()
    wav.write(b'RIFF' + struct.pack('<I', 36 + 2 * len(out)) + b'WAVEfmt ' + struct.pack('<IHHIIHH', 16, 1, 1, rate, rate * 2, 2, 16))
    wav.write(b'data' + struct.pack('<I', 2 * len(out)) + struct.pack(f'<{len(out)}h', *out))
    with tempfile.TemporaryDirectory() as folder:
        source, target = Path(folder) / 'tune.wav', Path(folder) / 'tune.mp3'
        source.write_bytes(wav.getvalue())
        subprocess.run(['ffmpeg', '-loglevel', 'error', '-i', str(source), '-ac', '1', '-b:a', '64k', str(target)], check=True)
        return data_url('audio/mpeg', target.read_bytes())


TUNES = [
    ('Twinkle, Twinkle, Little Star', 'C4:1 C4:1 G4:1 G4:1 A4:1 A4:1 G4:2 F4:1 F4:1 E4:1 E4:1 D4:1 D4:1 C4:2', 110),
    ('Ode to Joy', 'E4:1 E4:1 F4:1 G4:1 G4:1 F4:1 E4:1 D4:1 C4:1 C4:1 D4:1 E4:1 E4:1.5 D4:0.5 D4:2', 120),
    ('Mary Had a Little Lamb', 'E4:1 D4:1 C4:1 D4:1 E4:1 E4:1 E4:2 D4:1 D4:1 D4:2 E4:1 G4:1 G4:2', 120),
    ('Frère Jacques', 'C4:1 D4:1 E4:1 C4:1 C4:1 D4:1 E4:1 C4:1 E4:1 F4:1 G4:2 E4:1 F4:1 G4:2', 120),
    ('Jingle Bells', 'E4:1 E4:1 E4:2 E4:1 E4:1 E4:2 E4:1 G4:1 C4:1.5 D4:0.5 E4:4', 140),
    ('Happy Birthday to You', 'G4:0.75 G4:0.25 A4:1 G4:1 C5:1 B4:2 G4:0.75 G4:0.25 A4:1 G4:1 D5:1 C5:2', 100),
    ('London Bridge Is Falling Down', 'G4:1.5 A4:0.5 G4:1 F4:1 E4:1 F4:1 G4:2 D4:1 E4:1 F4:2 E4:1 F4:1 G4:2', 120),
    ('Old MacDonald Had a Farm', 'G4:1 G4:1 G4:1 D4:1 E4:1 E4:1 D4:2 B4:1 B4:1 A4:1 A4:1 G4:2', 120),
    ('Row, Row, Row Your Boat', 'C4:1.5 C4:1.5 C4:1 D4:0.5 E4:1.5 E4:1 D4:0.5 E4:1 F4:0.5 G4:3', 110),
    ('Brahms\' Lullaby', 'E4:0.5 E4:0.5 G4:2 E4:0.5 E4:0.5 G4:2 E4:0.5 G4:0.5 C5:1 B4:1.5 A4:0.5 A4:1 G4:1', 90),
    ('Für Elise', 'E5:0.5 D#5:0.5 E5:0.5 D#5:0.5 E5:0.5 B4:0.5 D5:0.5 C5:0.5 A4:1.5 C4:0.5 E4:0.5 A4:0.5 B4:1.5 E4:0.5 G#4:0.5 B4:0.5 C5:1.5', 130),
    ('When the Saints Go Marching In', 'C4:1 E4:1 F4:1 G4:4 C4:1 E4:1 F4:1 G4:4 C4:1 E4:1 F4:1 G4:2 E4:2 C4:2 E4:2 D4:4', 170),
    ('Auld Lang Syne', 'G4:1 C5:1.5 C5:0.5 C5:1 E5:1 D5:1.5 C5:0.5 D5:1 E5:0.5 D5:0.5 C5:1.5 C5:0.5 E5:1 G5:1 A5:3', 100),
    ('Greensleeves', 'A4:1 C5:2 D5:1 E5:1.5 F5:0.5 E5:1 D5:2 B4:1 G4:1.5 A4:0.5 B4:1 C5:2 A4:1 A4:1.5 G#4:0.5 A4:1 B4:2 G#4:1 E4:2', 150),
    ('Amazing Grace', 'G4:1 C5:2 E5:0.5 C5:0.5 E5:2 D5:1 C5:2 A4:1 G4:2 G4:1 C5:2 E5:0.5 C5:0.5 E5:2 D5:1 G5:3', 100),
]


def quiz(land_file):
    everest = on_map(86.925, 27.988)
    q = lambda n, **fields: {'id': f'example-q{n}', **fields}
    rounds = [
        ('Keypad warm-up', [
            q(1, type='choice', text='Which is the longest river in the United Kingdom?', seconds=20, points=2,
              options=['Thames', 'Severn', 'Trent', 'Tay'], answer='Severn', answerNote='The Severn runs about 220 miles (354 km).',
              fiftyFifty=True, fiftyPoints=1),
            q(2, type='multi', text='Which of these are planets in our Solar System? Tick all that apply.', seconds=30, points=2,
              options=['Mercury', 'Pluto', 'Neptune', 'Ceres', 'Venus', 'Titan'], correct=['Mercury', 'Neptune', 'Venus'],
              answerNote='Pluto and Ceres are dwarf planets; Titan is a moon of Saturn.'),
            q(3, type='letter', text='Potassium\'s chemical symbol is a single letter. Which?', seconds=15, points=1, answer='K',
              answerNote='K, from its Latin name, kalium.'),
            q(4, type='number', text='How many players does each side have on the pitch in rugby union?', seconds=20, points=1, answer='15'),
            q(5, type='sequence', text='Put these monarchs in order, earliest first.', seconds=30, points=2,
              items=['Elizabeth I', 'Charles II', 'Victoria', 'George VI']),
            q(6, type='vote', text='Vote: the best crisp flavour?', seconds=20, points=0,
              options=['Ready salted', 'Salt & vinegar', 'Cheese & onion', 'Prawn cocktail']),
            q('6b', type='choice', pair='trueFalse', text='True or false: the Great Wall of China can be seen from the Moon with the naked eye.',
              seconds=15, points=1, options=['True', 'False'], answer='False', answerNote='It is far too narrow: astronauts say even low orbit is hard.'),
        ]),
        ('Eyes and ears', [
            q(7, type='picture', text='Which country\'s flag is this?', seconds=30, points=1, media=png(jamaica()), reveal='tiles',
              answer='Jamaica'),
            q(8, type='audio', text='Who is speaking?', seconds=30, points=1, media=mp3(MOMENTS / 'Ich bin ein Berliner.mp3'),
              answer='John F. Kennedy', aliases=['JFK', 'Kennedy', 'John Kennedy', 'President Kennedy'],
              answerNote='"Ich bin ein Berliner": Berlin, 26 June 1963.'),
            q(9, type='pinpoint', text='Tap where Mount Everest is.', seconds=30, points=2, media=png(world_map(land_file)),
              target={'x': round(everest[0], 4), 'y': round(everest[1], 4), 'r': 0.03, 'aspect': round(MAP_HEIGHT / MAP_WIDTH, 4)},
              goWide=True, goWidePoints=1, answerNote='On the border of Nepal and China.'),
            q(10, type='text', text='Which element has the chemical symbol Fe?', seconds=30, points=2, answer='Iron', evil=True,
              answerNote='Risk It: a wrong answer loses 2 points. Fe is from ferrum.'),
        ]),
        ('Word games', [
            q(11, type='wordsnake', text='Trace the largest ocean on Earth.', seconds=45, points=2, answer='Pacific', goWide=True, goWidePoints=1),
            q(12, type='tiles', text='Rebuild the answer: who wrote Pride and Prejudice?', seconds=45, points=2, answer='Jane Austen'),
            q('13b', type='clues', text='Who am I? A point less with each clue.', seconds=60, points=4, clueSeconds=10,
              clues=['I was born on Christmas Day, 1642.', 'I was a professor at Cambridge and Master of the Royal Mint.', 'I wrote the Principia.',
                     'An apple is said to have fallen near me.'], answer='Isaac Newton', aliases=['Newton', 'Sir Isaac Newton']),
            q('13c', type='list', text='Name the countries of the United Kingdom.', seconds=60, points=1, slots=4,
              accepted=['England', 'Scotland', 'Wales | Cymru', 'Northern Ireland | N Ireland | NI']),
            q('13d', type='pairs', text='Match each capital to its country.', seconds=45, points=1,
              pairs=[['Canberra', 'Australia'], ['Ottawa', 'Canada'], ['Wellington', 'New Zealand'], ['Pretoria', 'South Africa']]),
            q('13e', type='sort', text='Fruit or vegetable? (As a botanist sees it.)', seconds=45, points=1,
              sorting=[['Tomato', 'Fruit'], ['Carrot', 'Vegetable'], ['Cucumber', 'Fruit'], ['Potato', 'Vegetable'], ['Pumpkin', 'Fruit'], ['Celery', 'Vegetable']]),
            q('13f', type='links', text='Find the three groups of three, and what links each.', seconds=90, points=1, linkPoints=1,
              linkGroups=[{'link': 'Planets', 'items': ['Mercury', 'Mars', 'Venus']}, {'link': 'Greek letters', 'items': ['Delta', 'Sigma', 'Omega']},
                          {'link': 'Chess pieces | Chessmen', 'items': ['Bishop', 'Knight', 'Rook']}]),
            q(13, type='nearest', text='How many bones are there in the adult human body?', seconds=30, points=3, answer='206', places=3),
        ]),
        ('On the buzzer', [
            q(14, type='buzzer', text='In which city is the Sagrada Família?', seconds=20, points=2, answer='Barcelona', variation='classic', penalty=1),
            q(15, type='clips', text='Tap during the clip of the first words spoken by a man standing on the Moon.', seconds=300, points=3,
              clips=[{'media': mp3(MOMENTS / f'{name}.mp3'), 'label': name} for name in
                     ['The Eagle has landed', 'Houston weve had a problem', 'One small step for man', 'We choose to go to the moon']],
              targetClip=2),
        ]),
        ('Eyes down', [
            q(16, type='bingo', text='Eyes down for a line!', seconds=1800, points=3, mode='line'),
            q(17, type='musicbingo', text='Music bingo: dab each tune on your ticket as you recognise it. First full line wins.', seconds=1800,
              points=3, mode='line', songs=[{'title': title, 'media': tune(notes, bpm)} for title, notes, bpm in TUNES]),
        ]),
        ('Paper round', [
            q(18, type='sheet', text='Five quick ones: fill in the sheet.', seconds=180, points=1,
              items=['Which is the only mammal that can truly fly?', 'What is the largest planet in the Solar System?',
                     'Who painted the Mona Lisa?', 'How many sides does a hexagon have?', 'What is the square root of 144?'],
              itemAnswers=['Bat', 'Jupiter', 'Leonardo da Vinci', '6', '12'],
              itemAliases=[['A bat', 'Bats'], [], ['Leonardo', 'Da Vinci'], ['Six'], ['Twelve']]),
        ]),
    ]
    return {'title': 'BeerMat Example Quiz',
            'rounds': [{'id': f'example-round-{i}', 'title': f'Round {i} · {title}', 'questions': questions} for i, (title, questions) in enumerate(rounds, 1)]}


if __name__ == '__main__':
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    out = ROOT / 'examples' / 'example-quiz.json'
    out.write_text(json.dumps(quiz(sys.argv[1]), ensure_ascii=False, indent=1) + '\n', encoding='utf-8')
    print(out, f'{out.stat().st_size // 1024} KB')
