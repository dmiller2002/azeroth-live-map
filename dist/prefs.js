// Preferences only: no capture images, positions, trails, or sharing permissions.
const KEY = 'azeroth-live-map.preferences.v1';
const defaults = {follow:true, trail:true, grid:false, mapOnly:false, zone:1429};

export function loadPreferences() {
  const preferences = {...defaults};
  try {
    const saved = JSON.parse(localStorage.getItem(KEY));
    if (!saved || typeof saved !== 'object') return preferences;
    for (const key of ['follow','trail','grid','mapOnly']) {
      if (typeof saved[key] === 'boolean') preferences[key] = saved[key];
    }
    if (Number.isInteger(saved.zone) && saved.zone > 0 && saved.zone <= 65535) preferences.zone = saved.zone;
  } catch { /* The app remains usable when storage is blocked or damaged. */ }
  return preferences;
}

export function savePreferences(changes) {
  const preferences = loadPreferences();
  for (const key of ['follow','trail','grid','mapOnly']) {
    if (typeof changes[key] === 'boolean') preferences[key] = changes[key];
  }
  if (Number.isInteger(changes.zone) && changes.zone > 0 && changes.zone <= 65535) preferences.zone = changes.zone;
  try { localStorage.setItem(KEY, JSON.stringify(preferences)); } catch { /* Optional persistence. */ }
}
