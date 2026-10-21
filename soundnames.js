// Sound packs use SpeedQuizzing's Sounds folder layout: general/<name>.mp3 for each moment, buzzers/<pack>/*.mp3.
// Each moment lists the file names it accepts, first match wins. Shared by the server, the desk and the pack script.
// SpeedQuizzing's timer files are made for its 10-second countdowns: they belong to the final countdown, which the TV
// starts 10 seconds before time's up (their ring-out follows), never to the start of a question or to the music while
// answering.
// PubQuiz's own sounds use their own names (question_start, question_music, time_up).
export const slotFiles = {
  startRound: ['start_round'], questionStart: ['question_start'], timerMusic: ['question_music'],
  countdown: ['new_game_end_timer', 'alt_game_timer1', 'audio_question_timer'],
  timeUp: ['time_up', 'stopwatch_timer_end', 'five_second_end_timer', 'end_clunk'], endRound: ['end_round'],
  correct: ['correct', 'accept'], wrong: ['incorrect'], reveal: ['drum_roll'], bingoCall: ['bingo_call'], bingo: ['airhorn'],
  applause: ['your_applause', 'applause/1'],
};
// Buzzer packs with these words in their folder name are never used by default.
export const skippedBuzzerPacks = /offensive/i;
export const bingoCallsFile = 'Customisable Bingo Calls.txt';
