// Sound packs are folders: general/<name>.mp3 for each moment, buzzers/<pack>/*.mp3, Themes/<name>/, bingo-calls.json.
// Each moment lists the file names it accepts, first match wins. Shared by the server and the desk.
// Timer files are made for 10-second countdowns: they belong to the final countdown, which the TV starts 10 seconds
// before time's up (their ring-out follows), never to the start of a question or to the music while answering.
// bingo_call is the "someone called bingo" sound, so it goes with a claim, not with each number.
export const slotFiles = {
  startRound: ['start_round'], questionStart: ['question_start'], timerMusic: ['question_music'],
  countdown: ['new_game_end_timer', 'alt_game_timer1', 'audio_question_timer'],
  timeUp: ['time_up', 'stopwatch_timer_end', 'five_second_end_timer', 'end_clunk'], endRound: ['end_round'],
  correct: ['correct', 'accept'], wrong: ['incorrect'], reveal: ['drum_roll'], bingoCall: ['bingo_number'], bingo: ['bingo_call', 'airhorn'],
  applause: ['your_applause', 'applause/1'],
};
// Buzzer packs with these words in their folder name are never used by default.
export const skippedBuzzerPacks = /offensive/i;
export const bingoCallsFile = 'bingo-calls.json';
// Calls that name a colour ("red number 5") colour that number's ball. A number whose call names none takes its
// nearest neighbour's colour (below first), so the colour bands stay whole. Null when no call names a colour.
export const ballColours = ['red', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink'];
export function callColours(calls) {
  const named = Array.from({length: 90}, (_, i) => ballColours.find(c => new RegExp(`\\b${c}\\b`, 'i').test(calls?.[i] || '')) ?? null);
  if (!named.some(Boolean)) return null;
  return named.map((c, i) => {
    for (let d = 1; !c && d < 90; d++) c = named[i - d] ?? named[i + d] ?? null;
    return c;
  });
}
