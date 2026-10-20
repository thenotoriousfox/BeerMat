// Sound packs use SpeedQuizzing's Sounds folder layout: general/<name>.mp3 for each moment, buzzers/<pack>/*.mp3.
// Each moment lists the file names it accepts, first match wins. Shared by the server, the desk and the pack script.
export const slotFiles = {
  startRound: ['start_round'], questionStart: ['start_timer', 'audio_question'], timerMusic: ['audio_question_timer', 'alt_game_timer1'],
  timeUp: ['new_game_end_timer', 'stopwatch_timer_end', 'five_second_end_timer', 'end_clunk'], endRound: ['end_round'],
  correct: ['correct', 'accept'], wrong: ['incorrect'], reveal: ['drum_roll'], bingoCall: ['bingo_call'], bingo: ['airhorn'], wheel: ['wheel'],
  applause: ['your_applause', 'applause/1'],
};
// Buzzer packs with these words in their folder name are never used by default.
export const skippedBuzzerPacks = /offensive/i;
export const bingoCallsFile = 'Customisable Bingo Calls.txt';
