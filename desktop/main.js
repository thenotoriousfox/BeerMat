// PubQuiz for Windows and Linux: runs the quiz server, shows the quiz desk in its own window and the TV display full
// screen on a second screen. No terminal, browser or Node.js install needed.
//
// Processes: this main process (windows, menus, files) holds no quiz data; the quiz server runs in a utility process
// (server-host.js) and is restarted if it fails; the desk and TV pages run sandboxed, with context isolation, and
// reach the app only through the few calls in preload.cjs, accepted only from the desk page itself.
import electron, {app, BrowserWindow, screen, ipcMain, dialog, Menu, shell, utilityProcess, safeStorage, session, clipboard} from 'electron';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {createPrefs, hostKey} from './store.js';
import {createLog} from './log.js';
import {createScreens} from './screens.js';
import {restoreDatabase} from './database.js';

const here = path.dirname(fileURLToPath(import.meta.url));
// Tests (and a portable copy) can keep everything in one folder.
if (process.env.PUBQUIZ_USER_DATA) app.setPath('userData', process.env.PUBQUIZ_USER_DATA);
// Wayland does not let a window choose its screen, which the TV window must; XWayland does. The display system is
// chosen before this file runs, so on a Wayland desktop the app starts itself again on X11 (PUBQUIZ_WAYLAND=1 opts out).
const toX11 = process.platform === 'linux' && process.env.DISPLAY && (process.env.WAYLAND_DISPLAY || process.env.XDG_SESSION_TYPE === 'wayland') && process.env.PUBQUIZ_WAYLAND !== '1' && !process.argv.some(a => a.startsWith('--ozone-platform'));
if (toX11) {app.relaunch({args: [...process.argv.slice(1), '--ozone-platform=x11']}); app.exit(0);}
else if (!app.requestSingleInstanceLock()) app.quit();
else run();

function run() {
  const data = app.getPath('userData'), test = process.env.PUBQUIZ_TEST === '1';
  const log = createLog(path.join(app.getPath('logs'), 'pubquiz.log'), {echo: test}), serverLog = createLog(path.join(app.getPath('logs'), 'server.log'));
  const prefs = createPrefs(path.join(data, 'desktop.json'), {port: 3000, autoOpen: true, audience: null, desk: null, welcomed: false});
  const icon = path.join(here, '..', 'scripts', 'pubquiz.png');
  let key, server = null, info = null, desk = null, screens = null, quitting = false, crashes = [];
  const pending = new Map();
  const origin = () => `http://127.0.0.1:${info.port}`;

  process.on('uncaughtException', e => log('Uncaught', e));
  process.on('unhandledRejection', e => log('Unhandled', e));

  // ---- The quiz server ----
  function startServer() {
    return new Promise((resolve, reject) => {
      info = null;
      const child = utilityProcess.fork(path.join(here, 'server-host.js'), [], {serviceName: 'PubQuiz quiz server', stdio: 'pipe',
        env: {...process.env, HOST_KEY: key, PUBQUIZ_DATA: data, PORT: String(prefs.get().port), ...(test ? {PUBQUIZ_LAPTOP: process.env.PUBQUIZ_LAPTOP || '0'} : {})}});
      server = child;
      for (const stream of [child.stdout, child.stderr]) stream?.on('data', text => serverLog(String(text).trimEnd()));
      child.on('message', m => {
        if (m.type === 'ready') {info = m; log(`Quiz server ready on port ${m.port}; database ${m.prepared.state}`); resolve(m);}
        else if (m.type === 'failed') reject(Error(m.message));
        else if (m.type === 'quit') app.quit();
        else if (pending.has(m.id)) {pending.get(m.id)(m); pending.delete(m.id);}
      });
      child.on('exit', code => {
        if (server === child) server = null;
        log(`Quiz server exited (${code})`);
        if (!info) return reject(Error(`The quiz server stopped while starting (exit ${code}). See the logs.`));
        if (!quitting) crashed(code);
      });
    });
  }
  const ask = (type, extra = {}, timeout = 10000) => new Promise((resolve, reject) => {
    if (!server) return reject(Error('The quiz server is not running'));
    const id = randomUUID(), timer = setTimeout(() => {pending.delete(id); reject(Error('The quiz server did not answer'));}, timeout);
    pending.set(id, m => {clearTimeout(timer); resolve(m);});
    server.postMessage({type, id, ...extra});
  });
  // The app's own calls to the desk API (first-run choices), logged in with the key like any desk.
  async function hostApi(route, body = {}) {
    const post = async (r, b, k = '') => {
      const res = await fetch(`${origin()}/api/${r}`, {method: 'POST', headers: {'Content-Type': 'application/json', Authorization: 'Bearer ' + k}, body: JSON.stringify(b)});
      const json = await res.json(); if (!res.ok) throw Error(json.error || res.status); return json;
    };
    return post('host/' + route, body, (await post('login', {key})).key);
  }
  async function crashed(code) {
    crashes = [...crashes.filter(t => Date.now() - t < 60000), Date.now()];
    if (crashes.length <= 3) {
      log(`Restarting the quiz server (crash ${crashes.length} in the last minute)`);
      try {await startServer(); await reloadWindows(); return;} catch (e) {log('Restart failed', e);}
    }
    const {response} = await dialog.showMessageBox(desk && !desk.isDestroyed() ? desk : null, {type: 'error', title: 'PubQuiz', message: 'The quiz server keeps stopping',
      detail: `Your quiz is saved and nothing has been lost. Open the logs to see why, or try again.\n(Last exit code: ${code})`, buttons: ['Try again', 'Open logs', 'Quit'], defaultId: 0, cancelId: 2});
    if (response === 0) {crashes = []; try {await startServer(); await reloadWindows();} catch (e) {crashed(e.message);}}
    else if (response === 1) {shell.openPath(app.getPath('logs')); crashed(code);}
    else app.quit();
  }
  async function stopServer(stopWifi = false) {
    if (!server) return;
    const child = server, exited = new Promise(resolve => child.once('exit', resolve));
    child.postMessage({type: 'shutdown', stopWifi});
    // Stopping the quiz Wi-Fi may wait on a password prompt.
    const timer = setTimeout(() => child.kill(), stopWifi ? 120000 : 10000);
    await exited; clearTimeout(timer);
  }

  // ---- Windows ----
  const sameOrigin = url => {try {return info && new URL(url).origin === origin();} catch {return false;}};
  const external = url => {try {const u = new URL(url); if (!['http:', 'https:'].includes(u.protocol)) return; if (test) log('Would open in the browser:', u.href); else shell.openExternal(u.href);} catch {}};
  const secure = (extra = {}) => ({contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true, spellcheck: false, ...extra});

  async function openDesk() {
    const {ticket} = await ask('ticket');
    if (!desk || desk.isDestroyed()) {
      const area = screen.getPrimaryDisplay().workArea;
      desk = new BrowserWindow({show: false, ...area, minWidth: 900, minHeight: 600, title: 'PubQuiz', icon, backgroundColor: '#0c1220',
        webPreferences: secure({preload: path.join(here, 'preload.cjs'), partition: 'persist:desk'})});
      desk.once('ready-to-show', () => {desk.maximize(); desk.show();});
      desk.on('close', event => {
        if (quitting) return;
        event.preventDefault();
        const choice = dialog.showMessageBoxSync(desk, {type: 'question', title: 'PubQuiz', message: 'Close PubQuiz?', detail: 'The quiz is saved and carries on where it was next time. Phones lose the quiz until PubQuiz is open again.', buttons: ['Close PubQuiz', 'Cancel'], defaultId: 1, cancelId: 1});
        if (choice === 0) app.quit();
      });
      desk.webContents.on('render-process-gone', (_, details) => {log('Desk page stopped', details); if (!quitting) setTimeout(() => desk?.reload(), 1000);});
      desk.webContents.on('console-message', event => {if (event.level === 'error') log('Desk:', event.message);});
    }
    await desk.loadURL(`${origin()}/host#ticket=${ticket}`);
  }
  function openAudience({fullscreen, bounds}) {
    const tv = new BrowserWindow({...(bounds || {width: 960, height: 540}), fullscreen, title: 'PubQuiz — TV', icon, backgroundColor: '#000000', autoHideMenuBar: true,
      webPreferences: secure({partition: 'audience', autoplayPolicy: 'no-user-gesture-required'})});
    tv.setMenuBarVisibility(false);
    // The TV page waits for a click before it makes sound (a browser rule); the app clicks it once.
    tv.webContents.on('did-finish-load', () => {for (const type of ['mouseDown', 'mouseUp']) tv.webContents.sendInputEvent({type, x: 1, y: 1, button: 'left', clickCount: 1});});
    tv.webContents.on('render-process-gone', (_, details) => {log('TV page stopped', details); if (!tv.isDestroyed()) setTimeout(() => tv.reload(), 1000);});
    tv.loadURL(`${origin()}/display`);
    return tv;
  }
  async function reloadWindows() {
    if (desk && !desk.isDestroyed()) await openDesk();
    for (const w of BrowserWindow.getAllWindows()) if (w !== desk && !w.isDestroyed()) w.loadURL(`${origin()}/display`);
  }

  // Every page: stays on the quiz server; other links open in the normal browser; the desk's Projector link opens the TV.
  app.on('web-contents-created', (_, contents) => {
    contents.on('will-navigate', (event, url) => {if (!sameOrigin(url)) {event.preventDefault(); external(url);}});
    contents.on('will-attach-webview', event => event.preventDefault());
    contents.setWindowOpenHandler(({url}) => {
      if (sameOrigin(url) && new URL(url).pathname === '/display') screens?.open(); else external(url);
      return {action: 'deny'};
    });
  });
  function lockDown() {
    // mediaKeySystem: Widevine, for the desk's Spotify player.
    const allowed = {'persist:desk': ['clipboard-sanitized-write', 'fullscreen', 'mediaKeySystem'], audience: ['fullscreen']};
    for (const [partition, permissions] of Object.entries(allowed)) {
      const s = session.fromPartition(partition);
      s.setPermissionRequestHandler((_, permission, callback) => callback(permissions.includes(permission)));
      s.setPermissionCheckHandler((_, permission) => permissions.includes(permission));
    }
  }

  // ---- Desk calls (preload.cjs) ----
  const fromDesk = event => {try {const u = new URL(event.senderFrame.url); return sameOrigin(u.href) && u.pathname === '/host';} catch {return false;}};
  const handle = (name, fn) => ipcMain.handle('pubquiz:' + name, (event, ...args) => {if (!fromDesk(event)) throw Error('Not allowed'); return fn(...args);});
  handle('screens', () => screens.info());
  handle('open-tv', () => {screens.open(); return screens.info();});
  handle('close-tv', () => {screens.close(); return screens.info();});
  handle('blank', on => {screens.setBlank(on === true); return screens.info();});
  handle('swap', () => {screens.swap(); return screens.info();});
  handle('choose-tv', id => {if (id !== null && !Number.isSafeInteger(id)) throw Error('Unknown screen'); screens.chooseAudience(id); return screens.info();});
  handle('auto-open', on => {screens.setAutoOpen(on === true); return screens.info();});
  handle('open-logs', () => shell.openPath(app.getPath('logs')));
  handle('open-data', () => shell.openPath(data));
  handle('backup', () => backup());
  handle('restore', () => restore());
  handle('show-key', () => showKey());
  handle('open-in-browser', () => openInBrowser());

  async function backup() {
    const {canceled, filePaths} = await dialog.showOpenDialog(desk, {title: 'Choose a folder for the backup', properties: ['openDirectory', 'createDirectory']});
    if (canceled || !filePaths[0]) return null;
    const result = await ask('backup', {folder: filePaths[0]}, 60000);
    if (result.error) throw Error(result.error);
    log('Backup saved to', result.file);
    return result.file;
  }
  async function restore() {
    const {canceled, filePaths} = await dialog.showOpenDialog(desk, {title: 'Restore a quiz backup', filters: [{name: 'PubQuiz backup', extensions: ['sqlite']}], defaultPath: path.join(data, 'backups'), properties: ['openFile']});
    if (canceled || !filePaths[0]) return false;
    const confirm = await dialog.showMessageBox(desk, {type: 'warning', title: 'PubQuiz', message: 'Replace the current quiz with this backup?', detail: `${path.basename(filePaths[0])}\n\nThe current quiz is backed up first. Phones reconnect by themselves.`, buttons: ['Restore', 'Cancel'], defaultId: 1, cancelId: 1});
    if (confirm.response !== 0) return false;
    quitting = true;
    try {
      await stopServer();
      restoreDatabase(filePaths[0], path.join(data, 'quiz.sqlite'), path.join(data, 'backups'));
      log('Restored backup', filePaths[0]);
    } catch (e) {
      log('Restore failed', e);
      dialog.showErrorBox('PubQuiz', `That backup could not be restored: ${e.message}. The current quiz is unchanged.`);
    } finally {
      quitting = false;
      await startServer(); await reloadWindows();
    }
    return true;
  }
  async function showKey() {
    const {response} = await dialog.showMessageBox(desk, {type: 'info', title: 'Quizmaster key', message: 'Quizmaster key', detail: `${key}\n\nUse it to open the quiz desk in a browser (${origin()}/host) or on another device on your network. Keep it private: it unlocks the desk.`, buttons: ['Copy key', 'Close'], defaultId: 1});
    if (response === 0) clipboard.writeText(key);
  }
  async function openInBrowser() {
    external(`${origin()}/host`);
    await showKey();
  }

  function menu() {
    const tv = screens.info();
    const template = [
      {label: 'PubQuiz', submenu: [
        {label: 'Open the desk in a browser (fallback)', click: openInBrowser},
        {label: 'Show quizmaster key…', click: showKey},
        {type: 'separator'},
        {label: 'Back up the quiz…', click: () => backup().catch(e => dialog.showErrorBox('PubQuiz', e.message))},
        {label: 'Restore a backup…', click: () => restore()},
        {label: 'Open data folder', click: () => shell.openPath(data)},
        {label: 'Open logs', click: () => shell.openPath(app.getPath('logs'))},
        {type: 'separator'},
        {role: 'quit', label: 'Close PubQuiz'},
      ]},
      {label: 'TV', submenu: [
        {label: tv.open ? 'Close the TV window' : tv.windowed ? 'Preview the TV in a window' : 'Show the TV on the second screen', accelerator: 'F7', click: () => tv.open ? screens.close() : screens.open()},
        {label: 'Blank the TV', type: 'checkbox', checked: tv.blanked, accelerator: 'F8', enabled: tv.open, click: () => screens.toggleBlank()},
        {label: 'Swap desk and TV screens', enabled: tv.displays.length > 1, click: () => screens.swap()},
        {label: 'TV screen', submenu: [{label: 'Automatic', type: 'radio', checked: !prefs.get().audience, click: () => screens.chooseAudience(null)},
          ...tv.displays.map(d => ({label: `${d.label} (${d.width}×${d.height})${d.primary ? ' — main screen' : ''}`, type: 'radio', checked: !!prefs.get().audience && d.audience, click: () => screens.chooseAudience(d.id)}))]},
        {label: 'Open the TV by itself when a screen is connected', type: 'checkbox', checked: tv.autoOpen, click: item => screens.setAutoOpen(item.checked)},
      ]},
      {label: 'View', submenu: [{role: 'reload'}, {role: 'resetZoom'}, {role: 'zoomIn'}, {role: 'zoomOut'}, {type: 'separator'}, {role: 'togglefullscreen'}, ...(app.isPackaged ? [] : [{role: 'toggleDevTools'}])]},
      {label: 'Help', submenu: [{label: 'Quizmaster guide', click: () => external('https://github.com/DTJW92/PubQuiz/blob/main/docs/QUIZMASTER.md')}, {label: 'Troubleshooting', click: () => external('https://github.com/DTJW92/PubQuiz/blob/main/docs/DESKTOP.md')}]},
    ];
    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
  }

  // First run: how players join; the TV screen is automatic.
  async function welcome() {
    if (prefs.get().welcomed || test) return;
    const {response} = await dialog.showMessageBox(desk, {type: 'question', title: 'Welcome to PubQuiz', message: 'How will players join your quizzes?',
      detail: 'Venue Wi-Fi: phones on the venue’s own Wi-Fi open this laptop’s address.\nPubQuiz Wi-Fi: this laptop makes its own quiz Wi-Fi, no internet needed.\n\nYou can change this any time under “How players join”. A TV or projector plugged in as a second screen shows the quiz by itself.',
      buttons: ['Venue Wi-Fi or network', 'PubQuiz Wi-Fi from this laptop', 'Decide later'], defaultId: 0, cancelId: 2});
    try {
      if (response === 0) {
        const network = await hostApi('network'), address = network.addresses.find(a => a.kind === 'lan');
        await hostApi('settings', {joinMode: 'lan', ...(address ? {joinUrl: `http://${address.address}:${network.port}`} : {})});
      } else if (response === 1) await hostApi('settings', {joinMode: 'hotspot'});
    } catch (e) {log('First-run settings', e);}
    prefs.set({welcomed: true});
    desk.reload();
  }

  app.on('second-instance', () => {if (desk && !desk.isDestroyed()) {if (desk.isMinimized()) desk.restore(); desk.focus();}});
  app.on('before-quit', event => {
    if (quitting || !server) return;
    event.preventDefault(); quitting = true;
    log('Closing PubQuiz');
    stopServer(true).finally(() => app.quit());
  });
  app.on('window-all-closed', () => app.quit());

  app.whenReady().then(async () => {
    log(`PubQuiz ${app.getVersion()} starting (Electron ${process.versions.electron}, ${process.platform}); data in ${data}`);
    lockDown();
    // castlabs' Electron fetches Widevine (Google's protected-media module) by itself, the first time with internet; the
    // desk's Spotify player needs it. The quiz never waits for it. Plain Electron has no `components`.
    if (electron.components && !test) electron.components.whenReady().then(() => log('Widevine ready', electron.components.status()), e => log('Widevine not available (Spotify on the desk needs it; the Spotify app still works)', e));
    try {
      key = hostKey(path.join(data, 'host-key'), safeStorage.isEncryptionAvailable() && !test ? {encrypt: t => safeStorage.encryptString(t), decrypt: b => safeStorage.decryptString(b)} : null);
      await startServer();
      screens = createScreens({screen, openAudience, deskWindow: () => desk, prefs: prefs.get, savePrefs: prefs.set, log,
        changed: () => {if (quitting) return; try {if (desk && !desk.isDestroyed()) desk.webContents.send('pubquiz:screens', screens.info());} catch {} menu();}});
      menu();
      await openDesk();
      screens.start();
      if (info.port !== prefs.get().port) dialog.showMessageBox(desk, {type: 'warning', title: 'PubQuiz', message: `Port ${prefs.get().port} is in use, so PubQuiz is on port ${info.port}`, detail: 'Another program (or another copy of PubQuiz started from a terminal) is using the usual port. Phones still join with the address on the TV; the PubQuiz Wi-Fi sends phones to the new port.'});
      if (info.prepared.state === 'recovered' || info.prepared.state === 'reset') dialog.showMessageBox(desk, {type: 'warning', title: 'PubQuiz', message: info.prepared.state === 'recovered' ? 'The quiz database was damaged, so PubQuiz restored the newest backup' : 'The quiz database was damaged and there was no backup, so PubQuiz started a new one',
        detail: `${info.prepared.problem}. The damaged file is kept at ${info.prepared.kept}.`});
      await welcome();
    } catch (e) {
      log('Start failed', e);
      dialog.showErrorBox('PubQuiz could not start', `${e.message}\n\nThe logs are in ${app.getPath('logs')}.`);
      quitting = true; app.exit(1);
    }
  });
}
