// Preferences only: no capture images, positions, trails, or sharing permissions.
const KEY = 'azeroth-live-map.preferences.v1';
const defaults = {follow:true, trail:true, grid:false, quests:true, questSource:'questie', mapOnly:false, questLogOpen:true, theme:'original', zone:1429, activeTab:'map', bagView:'separate', splitView:false, secondaryTab:'bags', guildSort:'status', guildSortDirection:'descending'};
const validTab=value=>typeof value==='string' && /^[a-z][a-z0-9-]{0,31}$/.test(value);

export function loadPreferences() {
  const preferences = {...defaults};
  try {
    const saved = JSON.parse(localStorage.getItem(KEY));
    if (!saved || typeof saved !== 'object') return preferences;
    for (const key of ['follow','trail','grid','quests','mapOnly','splitView','questLogOpen']) {
      if (typeof saved[key] === 'boolean') preferences[key] = saved[key];
    }
    if (Number.isInteger(saved.zone) && saved.zone > 0 && saved.zone <= 65535) preferences.zone = saved.zone;
    if (validTab(saved.activeTab)) preferences.activeTab = saved.activeTab;
    if (validTab(saved.secondaryTab)) preferences.secondaryTab = saved.secondaryTab;
    if (['separate','combined'].includes(saved.bagView)) preferences.bagView = saved.bagView;
    if (['light','dark','original'].includes(saved.theme)) preferences.theme = saved.theme;
    if (['forever','questie'].includes(saved.questSource)) preferences.questSource = saved.questSource;
    if (['member','status','professions','location'].includes(saved.guildSort)) preferences.guildSort = saved.guildSort;
    if (['ascending','descending'].includes(saved.guildSortDirection)) preferences.guildSortDirection = saved.guildSortDirection;
  } catch { /* The app remains usable when storage is blocked or damaged. */ }
  return preferences;
}

export function savePreferences(changes) {
  const preferences = loadPreferences();
  for (const key of ['follow','trail','grid','quests','mapOnly','splitView','questLogOpen']) {
    if (typeof changes[key] === 'boolean') preferences[key] = changes[key];
  }
  if (Number.isInteger(changes.zone) && changes.zone > 0 && changes.zone <= 65535) preferences.zone = changes.zone;
  if (validTab(changes.activeTab)) preferences.activeTab = changes.activeTab;
  if (validTab(changes.secondaryTab)) preferences.secondaryTab = changes.secondaryTab;
  if (['separate','combined'].includes(changes.bagView)) preferences.bagView = changes.bagView;
  if (['light','dark','original'].includes(changes.theme)) preferences.theme = changes.theme;
  if (['forever','questie'].includes(changes.questSource)) preferences.questSource = changes.questSource;
  if (['member','status','professions','location'].includes(changes.guildSort)) preferences.guildSort = changes.guildSort;
  if (['ascending','descending'].includes(changes.guildSortDirection)) preferences.guildSortDirection = changes.guildSortDirection;
  try { localStorage.setItem(KEY, JSON.stringify(preferences)); } catch { /* Optional persistence. */ }
}
