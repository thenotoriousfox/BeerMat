// Colour looks for the TV and phones (style.css, :root[data-look=…]). The quiz can use one, pick one at random for
// each question, or set one per question type. Shared by the server and the desk.
export const looks = [['stage', 'Purple stage'], ['ocean', 'Electric blue'], ['sunset', 'Sunset'], ['emerald', 'Emerald casino'], ['neon', 'Retro neon'], ['royal', 'Royal gold']];
// Groups of formats that share a look by default when looks follow the question type.
export const typeGroups = [['choice', 'multi', 'letter', 'number', 'sequence', 'vote'], ['text', 'picture', 'audio', 'sheet'], ['nearest', 'pinpoint', 'wordsnake', 'tiles'], ['buzzer', 'clips'], ['bingo', 'musicbingo']];
