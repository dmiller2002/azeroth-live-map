const sources = document.getElementById('sources');
document.getElementById('cancel').onclick = () => window.capturePicker.cancel();
document.addEventListener('keydown', event => { if (event.key === 'Escape') window.capturePicker.cancel(); });
window.capturePicker.sources().then(items => {
  sources.replaceChildren();
  if (!items.length) { sources.textContent = 'No capture sources are available. Check your screen-sharing permissions and try again.'; return; }
  for (const item of items) {
    const button = document.createElement('button'); button.className = 'source';
    const image = document.createElement('img'); image.src = item.thumbnail; image.alt = '';
    const name = document.createElement('span'); name.textContent = item.name;
    button.append(image, name); button.onclick = () => {
      for (const control of sources.querySelectorAll('button')) control.disabled = true;
      window.capturePicker.choose(item.id).catch(() => { for (const control of sources.querySelectorAll('button')) control.disabled = false; });
    };
    sources.append(button);
  }
  sources.querySelector('button')?.focus();
}).catch(() => { sources.textContent = 'Could not list capture sources. Close this window and try again.'; });
