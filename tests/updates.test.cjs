const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { supportsUpdates, createUpdateController, setupUpdateIPC, UPDATE_FEED, RELEASES_URL } = require('../desktop/updates.cjs');

class Updater extends EventEmitter {
  checks = 0; downloads = 0; installs = 0;
  setFeedURL(feed) { this.feed = feed; }
  async checkForUpdates() { this.checks++; this.emit('update-available', { version: '1.1.0' }); return {}; }
  async downloadUpdate() { this.downloads++; this.emit('download-progress', { percent: 45.5 }); this.emit('update-downloaded', { version: '1.1.0' }); return []; }
  quitAndInstall(silent, runAfter) { this.installs++; assert.equal(silent, false); assert.equal(runAfter, true); }
}
function setup(options = {}) {
  const updater = new Updater(), changes = [], opened = [];
  const controller = createUpdateController({ updater, version: '1.0.0', supported: true, notify: state => changes.push(state), openRelease: async url => opened.push(url), ...options });
  return { updater, controller, changes, opened };
}

test('updates require explicit check, download, and installation; ordinary exit cannot install', async () => {
  const { updater, controller, changes } = setup();
  assert.deepEqual(updater.feed, UPDATE_FEED);
  assert.equal(updater.autoDownload, false); assert.equal(updater.autoInstallOnAppQuit, false);
  assert.equal(updater.allowPrerelease, false); assert.equal(updater.allowDowngrade, false);
  assert.equal(updater.checks, 0); assert.equal(updater.downloads, 0); assert.equal(updater.installs, 0);
  await controller.download(); await controller.install();
  assert.equal(updater.downloads, 0); assert.equal(updater.installs, 0);
  assert.equal((await controller.check()).phase, 'available');
  assert.equal(updater.downloads, 0);
  assert.equal((await controller.download()).phase, 'downloaded');
  assert.ok(changes.some(state => state.phase === 'downloading' && state.percent === 45.5));
  assert.equal(updater.installs, 0);
  await controller.check(); assert.equal(updater.checks, 1, 'Checking again must not discard a verified downloaded update');
  assert.equal((await controller.install()).phase, 'installing'); await controller.install();
  assert.equal(updater.installs, 1);
});

test('concurrent clicks cannot duplicate a download or install before verification finishes', async () => {
  const { controller, updater } = setup();
  let complete;
  updater.downloadUpdate = () => { updater.downloads++; return new Promise(resolve => { complete = resolve; }); };
  await controller.check();
  const downloading = controller.download();
  await controller.download(); await controller.check(); await controller.install();
  assert.equal(updater.downloads, 1); assert.equal(updater.checks, 1); assert.equal(updater.installs, 0);
  updater.emit('update-downloaded', { version: '1.1.0' }); complete([]); await downloading;
  assert.equal(controller.getState().phase, 'downloaded');
});

test('network, missing release, missing manifest, and verification failures remain recoverable', async () => {
  const { controller, updater } = setup();
  for (const code of ['ERR_UPDATER_LATEST_VERSION_NOT_FOUND', 'ERR_UPDATER_CHANNEL_FILE_NOT_FOUND', 'ETIMEDOUT']) {
    updater.checkForUpdates = async () => { throw Object.assign(new Error('Internal details'), { code }); };
    const result = await controller.check(); assert.equal(result.phase, 'error'); assert.ok(result.message);
    assert.ok(!result.message.includes('Internal details'));
  }
  updater.checkForUpdates = Updater.prototype.checkForUpdates;
  await controller.check();
  updater.downloadUpdate = async () => { updater.emit('error', new Error('Checksum mismatch')); throw new Error('Checksum mismatch'); };
  assert.equal((await controller.download()).phase, 'error');
  await controller.install(); assert.equal(updater.installs, 0, 'An unverified download must never install');
  updater.downloadUpdate = Updater.prototype.downloadUpdate;
  await controller.check(); await controller.download();
  assert.equal(controller.getState().phase, 'downloaded');
});

test('an up-to-date check does not offer an update or trigger a download', async () => {
  const { controller, updater } = setup();
  updater.checkForUpdates = async () => { updater.emit('update-not-available', { version: '1.0.0' }); return {}; };
  assert.equal((await controller.check()).phase, 'current');
  await controller.download(); await controller.install();
  assert.equal(updater.downloads, 0); assert.equal(updater.installs, 0);
});

test('an asynchronous install failure is reported without quitting or getting stuck', async () => {
  const { controller, updater } = setup();
  await controller.check(); await controller.download();
  updater.quitAndInstall = async () => { throw new Error('Disk full'); };
  assert.equal((await controller.install()).phase, 'error');
  assert.equal((await controller.check()).phase, 'available');
});

test('packaged Windows and Linux copies update inside the app; release links are optional', async () => {
  for (const [options, expected] of [
    [{ packaged: true, platform: 'win32', windowsInstaller: true }, true],
    [{ packaged: true, platform: 'linux', appImage: '/tmp/App.AppImage' }, true],
    [{ packaged: false, platform: 'linux', appImage: '/tmp/App.AppImage' }, false],
    [{ packaged: true, platform: 'win32' }, true],
    [{ packaged: true, platform: 'linux' }, true],
    [{ packaged: true, platform: 'darwin' }, false],
  ]) assert.equal(supportsUpdates(options), expected);
  const { controller, updater, opened } = setup({ supported: false });
  assert.equal((await controller.check()).phase, 'unsupported');
  await controller.download(); await controller.install();
  assert.equal(updater.checks, 0); assert.equal(updater.downloads, 0); assert.equal(updater.installs, 0);
  await controller.openRelease(); assert.deepEqual(opened, [RELEASES_URL]);
});

test('update IPC rejects other windows and frames before performing actions', async () => {
  const handlers = new Map(), { controller, updater } = setup();
  setupUpdateIPC({ handle: (name, handler) => handlers.set(name, handler) }, event => event.trusted, controller);
  for (const handler of handlers.values()) assert.throws(() => handler({ trusted: false }), /Unavailable/);
  assert.equal(updater.checks, 0); assert.equal(updater.downloads, 0); assert.equal(updater.installs, 0);
  assert.equal((await handlers.get('updates:check')({ trusted: true })).phase, 'available');
});

test('update controls show download progress and require a separate restart click', async t => {
  const original = globalThis.document;
  const elements = new Map();
  globalThis.document = { getElementById: id => {
    if (!elements.has(id)) elements.set(id, {});
    return elements.get(id);
  } };
  t.after(() => { if (original) globalThis.document = original; else delete globalThis.document; });
  const { createUpdatePanel } = await import('../app/updates.js');
  let changed, installed = 0;
  const state = phase => ({ phase, currentVersion: '1.0.0', availableVersion: '1.1.0' });
  const api = {
    version: '1.0.0', onUpdateChanged: callback => { changed = callback; }, getUpdateState: async () => state('idle'),
    checkForUpdates: async () => state('available'),
    downloadUpdate: async () => { changed({ ...state('downloading'), percent: 42 }); assert.equal(elements.get('companion-update-progress').value, 42); return state('downloaded'); },
    installUpdate: async () => { installed++; return state('installing'); },
  };
  createUpdatePanel(api); await Promise.resolve();
  const button = elements.get('companion-update');
  assert.equal(button.textContent, 'Check for updates');
  await button.onclick(); assert.equal(button.textContent, 'Download update');
  await button.onclick(); assert.equal(button.textContent, 'Restart & install'); assert.equal(installed, 0);
  assert.equal(elements.get('companion-update-progress').hidden, true);
  await button.onclick(); assert.equal(installed, 1); assert.equal(button.disabled, true);
});
