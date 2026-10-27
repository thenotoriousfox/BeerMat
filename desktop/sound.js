// TV sound: the TV window and the desk's Spotify player send their sound to the TV's own output (HDMI or DisplayPort)
// while the desk's sounds stay on the laptop. Each page picks its output itself (setSinkId), so nothing in the system's
// sound settings changes. Outputs are remembered by name, as device ids differ from page to page.

// "auto" uses the TV's output whenever the TV is full screen on its own screen; "laptop" never moves the sound.
export function pickOutput(outputs, choice = 'auto', tvOnScreen = false) {
  if (choice === 'laptop') return null;
  if (choice !== 'auto') return outputs.includes(choice) ? choice : null;
  return tvOnScreen ? outputs.find(name => /HDMI|DisplayPort|\bDP\b/i.test(name)) ?? null : null;
}

// Run in a page (or Spotify's player frame): from now on every sound it plays goes to the named output, or back to the
// default with null. The first run hooks audio and video elements and Web Audio, so sounds made later follow too.
export function sinkScript(name) {
  return `(async name => {
    const w = window;
    if (!w.__beermatSink) {
      const state = w.__beermatSink = {id: '', contexts: new Set()};
      const play = HTMLMediaElement.prototype.play;
      HTMLMediaElement.prototype.play = function (...args) {
        if (this.sinkId === state.id || !this.setSinkId) return play.apply(this, args);
        return this.setSinkId(state.id).catch(() => {}).then(() => play.apply(this, args));
      };
      for (const key of ['AudioContext', 'webkitAudioContext']) {
        const Base = w[key]; if (!Base) continue;
        w[key] = class extends Base {constructor(...args) {super(...args); state.contexts.add(this); if (state.id && this.setSinkId) this.setSinkId(state.id).catch(() => {});}};
      }
    }
    const state = w.__beermatSink;
    const outputs = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'audiooutput');
    const id = name === null ? '' : outputs.find(d => d.label === name)?.deviceId;
    if (id === undefined) return false;
    state.id = id;
    for (const el of document.querySelectorAll('audio, video')) if (el.sinkId !== id) el.setSinkId(id).catch(() => {});
    for (const ctx of state.contexts) if (ctx.state !== 'closed' && ctx.setSinkId) ctx.setSinkId(id).catch(() => {});
    return true;
  })(${JSON.stringify(name)})`;
}

// The names of the sound outputs a page can see (the system's default pseudo-devices left out).
export const listScript = `navigator.mediaDevices.enumerateDevices().then(ds => ds.filter(d => d.kind === 'audiooutput' && d.label && !['default', 'communications'].includes(d.deviceId)).map(d => d.label))`;
