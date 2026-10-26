// The TV (audience) window: full screen on the chosen second screen, or a normal window to preview it when there is
// only one screen. Follows screens being plugged in and out, can be moved, swapped with the desk and blanked.
// Electron's screen module and window factory are passed in, so this runs in tests with stand-ins.
import {plan, swapped, describe} from './displays.js';

// Blanking hides the page and mutes it, without reloading: the quiz carries on underneath.
const BLANK_CSS = 'html.pubquiz-blank, html.pubquiz-blank body { background: #000 !important; } html.pubquiz-blank body > * { visibility: hidden !important; }';

export function createScreens({screen, openAudience, deskWindow = () => null, prefs, savePrefs, log = () => {}, changed = () => {}}) {
  let tv = null, blanked = false, current = {desk: null, audience: null, windowed: true};
  const alive = w => !!w && !w.isDestroyed();
  const layout = () => plan(screen.getAllDisplays(), screen.getPrimaryDisplay().id, prefs());

  function place() {
    current = layout();
    if (!current.desk) return changed();
    const desk = deskWindow();
    if (alive(desk) && current.desk && !contains(current.desk.bounds, desk.getBounds())) {desk.setBounds(current.desk.workArea || current.desk.bounds); desk.maximize?.();}
    if (!alive(tv)) {changed(); return;}
    if (current.audience) {
      // Leave full screen before moving, or some systems keep it on the old screen.
      if (tv.isFullScreen()) tv.setFullScreen(false);
      tv.setBounds(current.audience.bounds);
      tv.setFullScreen(true);
    } else if (tv.isFullScreen()) {
      // Its screen went away: carry on as a preview window on the desk's screen rather than vanish.
      tv.setFullScreen(false);
      const b = current.desk.bounds;
      tv.setBounds({x: b.x + Math.round(b.width * .55), y: b.y + 40, width: Math.round(b.width * .4), height: Math.round(b.width * .4 * 9 / 16)});
    }
    changed();
  }
  const contains = (outer, inner) => inner.x >= outer.x && inner.y >= outer.y && inner.x < outer.x + outer.width && inner.y < outer.y + outer.height;

  function open() {
    if (alive(tv)) {tv.show(); place(); return;}
    current = layout();
    tv = openAudience({fullscreen: !!current.audience, bounds: current.audience?.bounds || null});
    tv.on('closed', () => {tv = null; blanked = false; changed();});
    tv.webContents.on('did-finish-load', () => {tv.webContents.insertCSS(BLANK_CSS); if (blanked) setBlank(true);});
    place();
  }
  function setBlank(on) {
    blanked = !!on;
    if (!alive(tv)) return;
    tv.webContents.executeJavaScript(`document.documentElement.classList.toggle('pubquiz-blank', ${blanked})`).catch(() => {});
    tv.webContents.setAudioMuted(blanked);
    changed();
  }
  const onDisplays = event => () => {
    log(`Screens changed (${event}): ${screen.getAllDisplays().map(d => describe(d).label).join(', ')}`);
    // A TV switched on later, or plugged back in, gets the audience display straight away.
    if (event === 'display-added' && !alive(tv) && prefs().autoOpen !== false && layout().audience) return open();
    place();
  };
  for (const event of ['display-added', 'display-removed', 'display-metrics-changed']) screen.on(event, onDisplays(event));

  return {
    // Called once the desk is up: the TV opens by itself when there is a second screen.
    start() {if (prefs().autoOpen !== false && layout().audience) open(); else changed();},
    open,
    close() {if (alive(tv)) tv.close();},
    setBlank,
    toggleBlank() {setBlank(!blanked);},
    // null: back to automatic (an external screen).
    chooseAudience(id) {
      const target = id === null ? null : screen.getAllDisplays().find(d => d.id === id);
      if (id !== null && !target) throw Error('That screen is no longer connected');
      const desk = current.desk && target && target.id === current.desk.id ? null : prefs().desk;
      savePrefs({audience: target ? describe(target) : null, desk});
      if (alive(tv)) place(); else if (target) open(); else changed();
    },
    swap() {
      const next = swapped(layout());
      if (!next) throw Error('Swapping needs two screens');
      savePrefs(next); place();
    },
    setAutoOpen(on) {savePrefs({autoOpen: !!on}); changed();},
    tv: () => alive(tv) ? tv : null,
    info() {
      const displays = screen.getAllDisplays(), primary = screen.getPrimaryDisplay().id, l = layout();
      return {displays: displays.map(d => ({...describe(d), primary: d.id === primary, width: d.bounds.width, height: d.bounds.height, desk: d.id === l.desk?.id, audience: d.id === l.audience?.id})),
        open: alive(tv), fullscreen: alive(tv) && tv.isFullScreen(), blanked, windowed: l.windowed, autoOpen: prefs().autoOpen !== false};
    },
  };
}
