const RELEASES_URL = 'https://github.com/dmiller2002/azeroth-live-map/releases';
const UPDATE_FEED = { provider: 'github', owner: 'dmiller2002', repo: 'azeroth-live-map' };

function supportsUpdates({ packaged, platform }) {
  return Boolean(packaged && ['linux', 'win32'].includes(platform));
}

function createUpdateController({ updater, version, supported, installation = 'standard', notify = () => {}, openRelease }) {
  let state = { phase: supported ? 'idle' : 'unsupported', currentVersion: version, availableVersion: null, percent: null, installation };
  let operation = false;
  const getState = () => ({ ...state });
  function change(changes) { state = { ...state, ...changes }; notify(getState()); }
  function fail(error) {
    const message = error?.code === 'ERR_UPDATER_CHANNEL_FILE_NOT_FOUND'
      ? 'This release is missing update files. Please try again after the release has been completed.'
      : ['ERR_UPDATER_LATEST_VERSION_NOT_FOUND', 'ERR_UPDATER_NO_PUBLISHED_VERSIONS'].includes(error?.code)
        ? 'No stable companion update has been published yet.'
        : 'The update could not finish. Check your connection and try again.';
    change({ phase: 'error', percent: null, message });
  }
  if (supported) {
    updater.autoDownload = false;
    updater.autoInstallOnAppQuit = false;
    updater.allowPrerelease = false;
    updater.allowDowngrade = false;
    updater.setFeedURL(UPDATE_FEED);
    updater.on('error', fail);
    updater.on('update-available', info => change({ phase: 'available', availableVersion: info.version, message: null }));
    updater.on('update-not-available', () => change({ phase: 'current', availableVersion: null, message: null }));
    updater.on('download-progress', progress => {
      if (state.phase === 'downloading' && Number.isFinite(progress.percent)) change({ percent: Math.max(0, Math.min(100, progress.percent)) });
    });
    updater.on('update-downloaded', info => change({ phase: 'downloaded', availableVersion: info.version, percent: 100, message: null }));
  }
  return {
    getState,
    async check() {
      if (!supported || operation || ['downloaded', 'installing'].includes(state.phase)) return getState();
      operation = true; change({ phase: 'checking', message: null, percent: null, availableVersion: null });
      try { await updater.checkForUpdates(); } catch (error) { fail(error); }
      finally { operation = false; }
      return getState();
    },
    async download() {
      if (!supported || operation || state.phase !== 'available') return getState();
      operation = true; change({ phase: 'downloading', percent: 0, message: null });
      try { await updater.downloadUpdate(); } catch (error) { fail(error); }
      finally { operation = false; }
      return getState();
    },
    async install() {
      if (!supported || operation || state.phase !== 'downloaded') return getState();
      operation = true; change({ phase: 'installing', message: null });
      // Installation is always requested explicitly; normal app exit never installs.
      try { await updater.quitAndInstall(false, true); } catch (error) { fail(error); }
      finally { operation = false; }
      return getState();
    },
    async openRelease() { await openRelease(RELEASES_URL); return true; },
  };
}

function setupUpdateIPC(ipcMain, authorized, controller) {
  for (const [channel, action] of Object.entries({ 'updates:get': 'getState', 'updates:check': 'check', 'updates:download': 'download', 'updates:install': 'install', 'updates:releases': 'openRelease' })) {
    ipcMain.handle(channel, event => {
      if (!authorized(event)) throw new Error('Unavailable');
      return controller[action]();
    });
  }
}

module.exports = { RELEASES_URL, UPDATE_FEED, supportsUpdates, createUpdateController, setupUpdateIPC };
