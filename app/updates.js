export function createUpdatePanel(api = window.companion) {
  const $ = id => document.getElementById(id);
  const action = $('companion-update'), status = $('companion-update-status'), progress = $('companion-update-progress');
  let state = { phase: 'idle', currentVersion: api.version };
  function render(next) {
    state = next;
    $('companion-version').textContent = `Installed version · ${state.currentVersion}`;
    const messages = {
      idle: 'Check GitHub for a newer companion release.',
      unsupported: 'Updates are available in the packaged companion. This source checkout is managed separately.',
      checking: 'Checking GitHub for updates…',
      current: 'Your companion is up to date.',
      available: `Version ${state.availableVersion} is available.`,
      downloading: `Downloading version ${state.availableVersion} · ${Math.floor(state.percent || 0)}%`,
      downloaded: `Version ${state.availableVersion} is ready. Restart to install and reconnect WoW afterward.`,
      installing: 'Restarting to install the update…',
      error: state.message || 'Could not check for updates. Check your connection and try again.',
    };
    status.textContent = messages[state.phase] || messages.error;
    action.textContent = ({ unsupported: 'Packaged app required', checking: 'Checking…', available: 'Download update', downloading: 'Downloading…', downloaded: 'Restart & install', installing: 'Restarting…' })[state.phase] || 'Check for updates';
    action.disabled = ['unsupported', 'checking', 'downloading', 'installing'].includes(state.phase);
    progress.hidden = state.phase !== 'downloading';
    progress.value = state.percent || 0;
    $('companion-update-note').textContent = state.installation === 'managed-appimage'
      ? 'The update installs in your user folder and keeps your settings. Existing shortcuts will open the updated companion. Restarting ends your WoW connection.'
      : state.installation === 'windows-installer'
        ? 'The Windows installer will update this folder and keep your settings. Restarting ends your WoW connection.'
        : 'Updates are downloaded only when you choose. Restart & install closes the companion and ends your WoW connection.';
  }
  action.onclick = async () => {
    action.disabled = true;
    try {
      if (state.phase === 'unsupported') { render(state); return; }
      const operation = state.phase === 'available' ? 'downloadUpdate' : state.phase === 'downloaded' ? 'installUpdate' : 'checkForUpdates';
      render(await api[operation]());
    } catch { render({ ...state, phase: 'error', message: 'The update could not finish. Check your connection and try again.' }); }
  };
  $('companion-releases').onclick = async () => {
    try { await api.openReleases(); }
    catch { status.textContent = 'Could not open GitHub releases. Visit github.com/dmiller2002/azeroth-live-map/releases in your browser.'; }
  };
  api.onUpdateChanged(render);
  api.getUpdateState().then(render).catch(() => render({ ...state, phase: 'error' }));
}
