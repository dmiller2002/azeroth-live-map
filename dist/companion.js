const $ = id => document.getElementById(id);
let installPrompt = null;
const standalone = matchMedia('(display-mode: standalone)');
const localWindow = new URLSearchParams(location.search).get('app') === '1';

function appMode() {
  const inApp = standalone.matches || navigator.standalone === true || localWindow;
  $('app-mode').textContent = inApp ? 'DRUNKS AZEROTH UI · COMPANION APP' : 'SECOND-SCREEN COMPANION';
  $('install-app').hidden = inApp;
}
standalone.addEventListener('change', appMode);
appMode();
window.addEventListener('beforeinstallprompt', event => {
  event.preventDefault(); installPrompt = event;
  $('install-app').textContent = 'Install companion ↗';
});
window.addEventListener('appinstalled', () => {
  installPrompt = null;
  $('install-app').textContent = 'App installed';
  $('install-app').disabled = true;
});
$('install-app').onclick = async () => {
  if (!installPrompt) { $('app-dialog').showModal(); return; }
  const prompt = installPrompt; installPrompt = null;
  try { await prompt.prompt(); await prompt.userChoice; }
  catch { $('app-dialog').showModal(); }
  finally { if (!$('install-app').disabled) $('install-app').textContent = 'Open as an app ↗'; }
};
$('close-app-dialog').onclick = () => $('app-dialog').close();

// Update on the next launch; never reload an active screen-sharing session.
if ('serviceWorker' in navigator && isSecureContext) {
  navigator.serviceWorker.register('./sw.js', {updateViaCache:'none'}).catch(() => {});
}
