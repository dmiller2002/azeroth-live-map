const MIN_UI_SCALE = 50, MAX_UI_SCALE = 200, UI_SCALE_STEP = 5;

function normalizeUIScale(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 100;
  return Math.max(MIN_UI_SCALE, Math.min(MAX_UI_SCALE, Math.round(value / UI_SCALE_STEP) * UI_SCALE_STEP));
}

function setupUIScaleIPC(ipcMain, authorized, getScale, setScale) {
  ipcMain.handle('ui-scale:get', event => {
    if (!authorized(event)) throw new Error('Unavailable');
    return getScale();
  });
  ipcMain.handle('ui-scale:set', (event, value) => {
    if (!authorized(event)) throw new Error('Unavailable');
    if (typeof value !== 'number' || !Number.isFinite(value)) throw new TypeError('UI scale must be a finite number');
    return setScale(normalizeUIScale(value));
  });
}

module.exports = { MIN_UI_SCALE, MAX_UI_SCALE, UI_SCALE_STEP, normalizeUIScale, setupUIScaleIPC };
