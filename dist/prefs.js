// Preferences only: no capture images, positions, trails, or sharing permissions.
const KEY = 'azeroth-live-map.preferences.v1';
const defaults = {follow:true, trail:true, grid:false, quests:true, mapOnly:false, zone:1429, activeTab:'map', bagView:'separate', splitView:false, secondaryTab:'bags'};
const validTab=value=>typeof value==='string' && /^[a-z][a-z0-9-]{0,31}$/.test(value);

export function loadPreferences() {
  const preferences = {...defaults};
  try {
    const saved = JSON.parse(localStorage.getItem(KEY));
    if (!saved || typeof saved !== 'object') return preferences;
    for (const key of ['follow','trail','grid','quests','mapOnly','splitView']) {
      if (typeof saved[key] === 'boolean') preferences[key] = saved[key];
    }
    if (Number.isInteger(saved.zone) && saved.zone > 0 && saved.zone <= 65535) preferences.zone = saved.zone;
    if (validTab(saved.activeTab)) preferences.activeTab = saved.activeTab;
    if (validTab(saved.secondaryTab)) preferences.secondaryTab = saved.secondaryTab;
    if (['separate','combined'].includes(saved.bagView)) preferences.bagView = saved.bagView;
  } catch { /* The app remains usable when storage is blocked or damaged. */ }
  return preferences;
}

export function savePreferences(changes) {
  const preferences = loadPreferences();
  for (const key of ['follow','trail','grid','quests','mapOnly','splitView']) {
    if (typeof changes[key] === 'boolean') preferences[key] = changes[key];
  }
  if (Number.isInteger(changes.zone) && changes.zone > 0 && changes.zone <= 65535) preferences.zone = changes.zone;
  if (validTab(changes.activeTab)) preferences.activeTab = changes.activeTab;
  if (validTab(changes.secondaryTab)) preferences.secondaryTab = changes.secondaryTab;
  if (['separate','combined'].includes(changes.bagView)) preferences.bagView = changes.bagView;
  try { localStorage.setItem(KEY, JSON.stringify(preferences)); } catch { /* Optional persistence. */ }
}
