const { app, BrowserWindow, Menu, dialog, ipcMain, protocol, session, shell, screen } = require('electron');
const { readFileSync, writeFileSync, existsSync } = require('node:fs');
const { copyFile } = require('node:fs/promises');
const path = require('node:path');
const { ORIGIN, isAppURL, externalURL, createResourceHandler } = require('./resources.cjs');
const { setupCapture } = require('./capture.cjs');
const { normalizeUIScale, setupUIScaleIPC, UI_SCALE_STEP } = require('./ui-scale.cjs');
const { supportsUpdates, createUpdateController, setupUpdateIPC } = require('./updates.cjs');
const { managedPaths, findManagedUpdate, createManagedAppImageUpdater } = require('./managed-updates.cjs');
const { spawn } = require('node:child_process');

app.setName('Drunks Azeroth Companion - Forever');
// A fixed profile keeps display preferences stable across development and packaged launches.
app.setPath('userData', path.join(app.getPath('appData'), 'drunks-azeroth-ui-companion'));
if (process.env.COMPANION_USER_DATA) app.setPath('userData', path.resolve(process.env.COMPANION_USER_DATA));
protocol.registerSchemesAsPrivileged([{ scheme: 'azeroth', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }]);

let mainWindow;
let uiScale = 100, scheduleStateSave = () => {};
const root = path.join(__dirname, '..', 'app');
const stateFile = path.join(app.getPath('userData'), 'window.json');
const trustedMain = contents => mainWindow && !mainWindow.isDestroyed() && contents === mainWindow.webContents && isAppURL(contents.getURL());
const canPermit = (contents, permission, details = {}) => trustedMain(contents) && (
  permission === 'display-capture' || permission === 'fullscreen' ||
  (permission === 'clipboard-sanitized-write')
) && (!details.requestingUrl || isAppURL(details.requestingUrl));

function openExternal(value) { if (externalURL(value)) shell.openExternal(value).catch(error => console.error(error.message)); }

function setUIScale(value) {
  uiScale = normalizeUIScale(value);
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.setZoomFactor(uiScale / 100);
    mainWindow.webContents.send('ui-scale:changed', uiScale);
    scheduleStateSave();
  }
  return uiScale;
}

function createWindow() {
  let saved = {};
  try { saved = JSON.parse(readFileSync(stateFile, 'utf8')); } catch { /* First launch. */ }
  if (!saved || typeof saved !== 'object') saved = {};
  uiScale = normalizeUIScale(saved.uiScale);
  const width = Math.max(900, Math.min(3840, Number(saved.width) || 1440));
  const height = Math.max(640, Math.min(2160, Number(saved.height) || 960));
  const visible = Number.isFinite(saved.x) && Number.isFinite(saved.y) && screen.getAllDisplays().some(({ workArea: a }) => saved.x < a.x + a.width - 80 && saved.x + width > a.x + 80 && saved.y >= a.y && saved.y < a.y + a.height - 80);
  mainWindow = new BrowserWindow({
    width, height, ...(visible ? { x: saved.x, y: saved.y } : {}), minWidth: 900, minHeight: 640,
    title: 'Drunks Azeroth Companion — WoW Forever Edition', backgroundColor: '#111817', show: false,
    icon: path.join(root, 'icons', 'huzzah-icon-512.png'), autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true, zoomFactor: uiScale / 100 }
  });
  // Isolated zoom scales the interface without changing capture-picker windows
  // that use the same bundled origin.
  mainWindow.webContents.setZoomMode('isolated');
  mainWindow.webContents.setZoomFactor(uiScale / 100);
  mainWindow.webContents.on('did-finish-load', () => {
    mainWindow.webContents.setZoomFactor(uiScale / 100);
    mainWindow.webContents.send('ui-scale:changed', uiScale);
  });
  mainWindow.webContents.on('zoom-changed', (_event, direction) => setUIScale(uiScale + (direction === 'in' ? UI_SCALE_STEP : -UI_SCALE_STEP)));
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown' || !(input.control || input.meta) || input.alt) return;
    if (['+', '=', '-', '0'].includes(input.key)) {
      event.preventDefault();
      setUIScale(input.key === '0' ? 100 : uiScale + (input.key === '-' ? -UI_SCALE_STEP : UI_SCALE_STEP));
    }
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => { openExternal(url); return { action: 'deny' }; });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url !== ORIGIN + '/?app=1') { event.preventDefault(); openExternal(url); }
  });
  mainWindow.webContents.on('will-attach-webview', event => event.preventDefault());
  const window = mainWindow;
  let saveTimer;
  const saveWindow = () => {
    clearTimeout(saveTimer);
    if (window.isDestroyed()) return;
    try { writeFileSync(stateFile, JSON.stringify({ ...window.getNormalBounds(), maximized: window.isMaximized(), uiScale })); } catch (error) { console.error('Could not save window settings:', error.message); }
  };
  scheduleStateSave = () => { clearTimeout(saveTimer); saveTimer = setTimeout(saveWindow, 200); };
  for (const event of ['move', 'resize', 'maximize', 'unmaximize']) window.on(event, scheduleStateSave);
  window.once('ready-to-show', () => { if (saved.maximized) window.maximize(); window.show(); saveWindow(); });
  window.on('close', saveWindow);
  window.on('closed', () => clearTimeout(saveTimer));
  mainWindow.on('closed', () => { mainWindow = null; scheduleStateSave = () => {}; });
  mainWindow.loadURL(ORIGIN + '/?app=1').catch(error => dialog.showErrorBox('Companion could not start', error.message));
}

const isManagedCopy = process.env.APPIMAGE && path.resolve(process.env.APPIMAGE) === managedPaths(app.getPath('userData')).executable;
const managedUpdate = app.isPackaged && process.platform === 'linux' && !isManagedCopy
  ? findManagedUpdate(app.getPath('userData'), app.getVersion()) : null;
if (managedUpdate) {
  // Existing shortcuts keep opening the installed, newer managed copy.
  const child = spawn(managedUpdate, ['--appimage-extract-and-run', ...process.argv.slice(1)], { detached: true, stdio: 'ignore' });
  child.on('error', error => { dialog.showErrorBox('Could not open updated companion', error.message); app.quit(); });
  child.once('spawn', () => { child.unref(); app.quit(); });
} else if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (mainWindow) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.show(); mainWindow.focus(); } });
  app.whenReady().then(() => {
    const supported = supportsUpdates({ packaged: app.isPackaged, platform: process.platform });
    const managedLinux = supported && process.platform === 'linux';
    const windowsZIP = supported && process.platform === 'win32' && !existsSync(path.join(path.dirname(process.execPath), `Uninstall ${app.getName()}.exe`));
    const updater = !supported ? null : managedLinux ? createManagedAppImageUpdater(app) : require('electron-updater').autoUpdater;
    if (windowsZIP) updater.installDirectory = path.dirname(process.execPath);
    const updates = createUpdateController({
      updater, version: app.getVersion(), supported,
      installation: managedLinux ? 'managed-appimage' : windowsZIP ? 'windows-installer' : 'standard',
      notify: state => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('updates:changed', state); },
      openRelease: url => shell.openExternal(url),
    });
    setupUpdateIPC(ipcMain, event => trustedMain(event.sender) && event.senderFrame === event.sender.mainFrame, updates);
    session.defaultSession.protocol.handle('azeroth', createResourceHandler(root));
    session.defaultSession.setPermissionCheckHandler((contents, permission, origin, details) => isAppURL(origin) && canPermit(contents, permission, details));
    session.defaultSession.setPermissionRequestHandler((contents, permission, callback, details) => callback(canPermit(contents, permission, details)));
    session.defaultSession.on('will-download', event => event.preventDefault());
    setupCapture(session.defaultSession, () => mainWindow);
    setupUIScaleIPC(ipcMain,
      event => trustedMain(event.sender) && event.senderFrame === event.sender.mainFrame,
      () => uiScale, setUIScale);
    ipcMain.handle('addon:save', async event => {
      if (!trustedMain(event.sender) || event.senderFrame !== event.sender.mainFrame) throw new Error('Unavailable');
      const result = await dialog.showSaveDialog(mainWindow, { title: 'Save the WoW addon', defaultPath: path.join(app.getPath('downloads'), 'DrunksAzerothUI.zip'), filters: [{ name: 'ZIP archive', extensions: ['zip'] }] });
      if (result.canceled || !result.filePath) return false;
      await copyFile(path.join(root, 'DrunksAzerothUI.zip'), result.filePath);
      return true;
    });
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      { label: 'Companion', submenu: [{ label: 'About Drunks Azeroth Companion', click: () => dialog.showMessageBox(mainWindow, { type: 'info', title: 'Drunks Azeroth Companion — WoW Forever Edition', message: 'Drunks Azeroth Companion ' + app.getVersion(), detail: 'Developed by Drunk.\nWoW Forever Edition.\nReads the connected client version and build automatically.' }) }, { type: 'separator' }, { role: 'quit' }] },
      { role: 'editMenu' },
      { label: 'View', submenu: [
        { role: 'togglefullscreen' },
        { label: 'Reset UI scale (100%)', accelerator: 'CommandOrControl+0', click: () => setUIScale(100) },
        { label: 'Increase UI scale', accelerator: 'CommandOrControl+Plus', click: () => setUIScale(uiScale + UI_SCALE_STEP) },
        { label: 'Decrease UI scale', accelerator: 'CommandOrControl+-', click: () => setUIScale(uiScale - UI_SCALE_STEP) },
        ...(!app.isPackaged ? [{ role: 'toggleDevTools' }] : [])
      ] }
    ]));
    createWindow();
    app.on('activate', () => { if (!mainWindow) createWindow(); });
  }).catch(error => { dialog.showErrorBox('Companion could not start', error.stack || error.message); app.exit(1); });
  app.on('window-all-closed', () => app.quit());
}
