const $ = id => document.getElementById(id);
$('app-mode').textContent = 'DRUNKS AZEROTH COMPANION · WOW FOREVER EDITION';
const scaleButton = $('ui-scale'), scaleSlider = $('ui-scale-slider');
function showScale(value) {
  scaleSlider.value = value;
  scaleSlider.setAttribute('aria-valuetext', `${value} percent`);
  $('ui-scale-value').value = `${value}%`;
  scaleButton.textContent = `UI scale · ${value}%`;
  $('ui-scale-less').disabled = value <= 50;
  $('ui-scale-more').disabled = value >= 200;
}
async function applyScale(value) {
  $('ui-scale-status').textContent = '';
  try { showScale(await window.companion.setUIScale(value)); }
  catch {
    $('ui-scale-status').textContent = 'Could not change the UI scale. Try again.';
    window.companion.getUIScale().then(showScale).catch(() => {});
  }
}
window.companion.onUIScaleChanged(showScale);
window.companion.getUIScale().then(value => { showScale(value); scaleButton.disabled = false; }).catch(() => {
  scaleButton.title = 'Restart the companion to enable UI scaling.';
});
scaleButton.onclick = () => { $('ui-scale-status').textContent = ''; $('ui-scale-dialog').showModal(); };
$('close-ui-scale').onclick = () => $('ui-scale-dialog').close();
scaleSlider.oninput = () => {
  $('ui-scale-value').value = `${scaleSlider.value}%`;
  scaleSlider.setAttribute('aria-valuetext', `${scaleSlider.value} percent`);
};
// Commit on release so changing the dialog's own size does not move the slider
// underneath a pointer while it is being dragged.
scaleSlider.onchange = () => applyScale(Number(scaleSlider.value));
$('ui-scale-less').onclick = () => applyScale(Number(scaleSlider.value) - 5);
$('ui-scale-more').onclick = () => applyScale(Number(scaleSlider.value) + 5);
$('ui-scale-reset').onclick = () => applyScale(100);
// Keep shortcuts available to renderer-delivered keyboard events as well as
// Electron's native menu accelerators. Native interception consumes its events.
window.addEventListener('keydown', event => {
  if (!(event.ctrlKey || event.metaKey) || event.altKey || !['+', '=', '-', '0'].includes(event.key)) return;
  event.preventDefault();
  applyScale(event.key === '0' ? 100 : Number(scaleSlider.value) + (event.key === '-' ? -5 : 5));
}, { capture: true });
