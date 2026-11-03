const { BrowserWindow, desktopCapturer, ipcMain } = require('electron');
const path = require('node:path');
const { ORIGIN } = require('./resources.cjs');

function setupCapture(session, getMainWindow) {
  let pending = null;
  ipcMain.handle('capture:sources', event => {
    if (!pending || event.sender !== pending.window.webContents || event.senderFrame !== event.sender.mainFrame) throw new Error('Unavailable');
    return pending.sources.map(source => ({ id: source.id, name: source.name, thumbnail: source.thumbnail.toDataURL() }));
  });
  ipcMain.handle('capture:choose', (event, id) => {
    if (!pending || event.sender !== pending.window.webContents || event.senderFrame !== event.sender.mainFrame) throw new Error('Unavailable');
    const source = pending.sources.find(source => source.id === id);
    if (id !== null && !source) throw new Error('Unknown capture source');
    pending.finish(source || null);
  });
  session.setDisplayMediaRequestHandler(async (request, callback) => {
    const main = getMainWindow();
    if (!main || request.frame !== main.webContents.mainFrame || !request.userGesture || !request.videoRequested || request.audioRequested || pending) { callback({}); return; }
    // Reserve the request while the OS portal is open to prevent concurrent pickers.
    const state = { window: null, sources: [], finish: null }; pending = state;
    let completed = false;
    state.finish = source => {
      if (completed) return; completed = true;
      main.removeListener('closed', cancel);
      if (pending === state) pending = null;
      if (state.window && !state.window.isDestroyed()) state.window.close();
      if (!main.isDestroyed() && request.frame === main.webContents.mainFrame) callback(source ? { video: source } : {});
    };
    const cancel = () => state.finish(null);
    main.once('closed', cancel);
    try {
      state.sources = await desktopCapturer.getSources({ types: ['window', 'screen'], thumbnailSize: { width: 320, height: 180 }, fetchWindowIcons: false });
      if (completed) return;
      if (!state.sources.length) { state.finish(null); return; }
      // PipeWire already asks the user to select a window or monitor in the system portal.
      if (process.platform === 'linux' && process.env.XDG_SESSION_TYPE === 'wayland' && state.sources.length === 1) { state.finish(state.sources[0]); return; }
      const picker = new BrowserWindow({
        parent: main, modal: true, width: 880, height: 620, minWidth: 560, minHeight: 400,
        title: 'Choose your WoW window', backgroundColor: '#111817', autoHideMenuBar: true,
        webPreferences: { session, preload: path.join(__dirname, 'capture-preload.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false }
      });
      state.window = picker;
      picker.setMenu(null);
      picker.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      picker.webContents.on('will-navigate', event => event.preventDefault());
      picker.once('closed', cancel);
      await picker.loadURL(ORIGIN + '/capture.html');
    } catch (error) { console.error('Capture selection failed:', error.message); state.finish(null); }
  });
}

module.exports = { setupCapture };
