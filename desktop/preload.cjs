// The only things the quiz desk page can ask of the desktop app. Runs sandboxed; the main process also checks that
// each call comes from the desk page on the app's own quiz server.
const {contextBridge, ipcRenderer} = require('electron');
const call = (name, ...args) => ipcRenderer.invoke('pubquiz:' + name, ...args);

contextBridge.exposeInMainWorld('pubquizDesktop', {
  screens: () => call('screens'),
  openTv: () => call('open-tv'),
  closeTv: () => call('close-tv'),
  blank: on => call('blank', on === true),
  swap: () => call('swap'),
  chooseTv: id => call('choose-tv', id === null ? null : Number(id)),
  autoOpen: on => call('auto-open', on === true),
  openLogs: () => call('open-logs'),
  openDataFolder: () => call('open-data'),
  backup: () => call('backup'),
  restore: () => call('restore'),
  showKey: () => call('show-key'),
  openInBrowser: () => call('open-in-browser'),
  onScreens: fn => {
    const listener = (_, info) => fn(info);
    ipcRenderer.on('pubquiz:screens', listener);
    return () => ipcRenderer.off('pubquiz:screens', listener);
  },
});
