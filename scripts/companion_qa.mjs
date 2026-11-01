// End-to-end checks for the standalone browser companion. Run only against the
// isolated QA Chromium on CDP 9223 and the local project server on port 8765.
// Synthetic screen capture stays inside this fresh QA page; no WoW capture or
// operating-system sharing permissions are requested by this test.
import assert from 'node:assert/strict';
import {mkdir, writeFile} from 'node:fs/promises';

const origin = 'http://localhost:8765';
const cdp = 'http://127.0.0.1:9223';
const target = await (await fetch(`${cdp}/json/new?about:blank`, {method: 'PUT'})).json();
assert.ok(target.webSocketDebuggerUrl, 'the isolated Chromium must allow a fresh QA tab');
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, {once: true});
  socket.addEventListener('error', reject, {once: true});
});
let serial = 0;
const pending = new Map(), runtimeErrors = [];
socket.addEventListener('message', event => {
  const message = JSON.parse(event.data);
  if (message.id) {
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id); clearTimeout(request.timeout);
    if (message.error) request.reject(new Error(JSON.stringify(message.error)));
    else request.resolve(message.result);
  } else if (message.method === 'Runtime.exceptionThrown') {
    runtimeErrors.push(message.params.exceptionDetails);
  }
});
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++serial;
  const timeout = setTimeout(() => {
    pending.delete(id); reject(new Error(`CDP timed out: ${method}`));
  }, 20000);
  pending.set(id, {resolve, reject, timeout});
  socket.send(JSON.stringify({id, method, params}));
});
const evaluate = async expression => {
  const response = await send('Runtime.evaluate', {expression, awaitPromise: true, returnByValue: true});
  if (response.exceptionDetails) throw new Error(JSON.stringify(response.exceptionDetails));
  return response.result.value;
};
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const until = async (expression, label, milliseconds = 12000) => {
  const deadline = Date.now() + milliseconds;
  while (Date.now() < deadline) {
    try { if (await evaluate(expression)) return; }
    catch (error) {
      // Navigation destroys the old execution context during reload.
      if (!/context|frame|navigated|document is not defined/i.test(String(error))) throw error;
    }
    await wait(100);
  }
  throw new Error(`Timed out waiting for ${label}`);
};
const reload = async (params, label, milliseconds = 20000) => {
  const previousTimeOrigin = await evaluate('performance.timeOrigin');
  await send('Page.reload', params);
  // Page.reload acknowledges the request before the old document disappears.
  // Its existing zone options must not satisfy the new-document readiness check.
  await until(`performance.timeOrigin !== ${JSON.stringify(previousTimeOrigin)} && document.readyState !== 'loading'`, `${label}: new document`, milliseconds);
  await until("document.querySelectorAll('#zone option').length === 70 && document.getElementById('quick-connect')", `${label}: app ready`, milliseconds);
};
const shown = id => `(() => {
  const e = document.getElementById(${JSON.stringify(id)});
  if (!e) return false;
  const r = e.getBoundingClientRect(), s = getComputedStyle(e);
  return !e.hidden && s.display !== 'none' && s.visibility !== 'hidden' && r.width > 0 && r.height > 0
    && r.left >= 0 && r.right <= innerWidth + 1 && r.top >= 0 && r.bottom <= innerHeight + 1;
})()`;
const readPrefs = () => evaluate(`({
  follow: document.getElementById('follow').checked,
  trail: document.getElementById('trail').checked,
  grid: document.getElementById('grid').checked,
  zone: document.getElementById('zone').value,
  mapOnly: document.body.classList.contains('map-only')
})`);
const assertNoStoredPosition = async () => {
  const stores = await evaluate(`({
    local: Object.fromEntries(Object.entries(localStorage)),
    session: Object.fromEntries(Object.entries(sessionStorage))
  })`);
  const forbidden = /^(?:x|y|coords?|coordinates?|position|lastPosition|frames?|screenshots?|pixels?|stream|roi|latitude|longitude|capture)$/i;
  const inspect = (value, path) => {
    if (value && typeof value === 'object') {
      for (const [key, child] of Object.entries(value)) {
        assert.ok(!forbidden.test(key), `screen/position data must not persist at ${path}.${key}`);
        if (/trail/i.test(key)) assert.equal(typeof child, 'boolean', 'only the trail preference may persist');
        inspect(child, `${path}.${key}`);
      }
    } else if (typeof value === 'string') {
      assert.ok(!/^data:(?:image|video)\//i.test(value), 'captured image/video must not persist');
    }
  };
  for (const [store, entries] of Object.entries(stores)) {
    for (const [key, value] of Object.entries(entries)) {
      try { inspect(JSON.parse(value), `${store}.${key}`); }
      catch (error) { if (!(error instanceof SyntaxError)) throw error; }
      assert.ok(!value.includes('0.2345') && !value.includes('0.6789'), 'live coordinate payload must not be stored');
    }
  }
  return stores;
};

let offline = false;
try {
  await send('Runtime.enable'); await send('Page.enable'); await send('Page.bringToFront'); await send('Network.enable');
  await send('Storage.clearDataForOrigin', {origin, storageTypes: 'all'});
  await send('Emulation.setDeviceMetricsOverride', {width: 1440, height: 960, deviceScaleFactor: 1, mobile: false});
  await send('Page.addScriptToEvaluateOnNewDocument', {source: `
    // Force the documented no-prompt browser path; this does not fake an install.
    window.addEventListener('beforeinstallprompt', event => {
      event.preventDefault(); event.stopImmediatePropagation();
    });
    window.__companionFeed = {valid:true, mapId:1944, x:.2345, y:.6789, facing:.6};
    window.__companionCaptureCalls = 0;
    navigator.mediaDevices.getDisplayMedia = async () => {
      window.__companionCaptureCalls++;
      const {drawStrip, encodePacket} = await import('/protocol.js');
      const source = document.createElement('canvas'); source.width = 1280; source.height = 720;
      const ctx = source.getContext('2d'); let sequence = 1;
      const paint = () => {
        ctx.fillStyle = '#394c40'; ctx.fillRect(0,0,source.width,source.height);
        drawStrip(ctx,encodePacket({...window.__companionFeed,sequence:sequence++,clock:Math.floor(performance.now())}),73,62,6);
      };
      paint(); window.__companionTimer = setInterval(paint,100);
      window.__companionStream = source.captureStream(10);
      return window.__companionStream;
    };
  `});
  await send('Page.navigate', {url: origin});
  await until("document.querySelectorAll('#zone option').length === 70 && document.getElementById('install-app')", 'companion application');
  assert.equal(await evaluate("document.getElementById('status').textContent"), 'Not connected');
  assert.equal(await evaluate('window.__companionCaptureCalls'), 0, 'loading the companion must not request screen capture');

  // Chrome's own parsed manifest and resource responses, not source string checks.
  const manifestResult = await send('Page.getAppManifest');
  assert.deepEqual(manifestResult.errors, [], 'manifest must parse without errors');
  assert.ok(manifestResult.data, 'Chromium must discover the linked app manifest');
  const manifest = JSON.parse(manifestResult.data);
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.name,'Drunks Azeroth UI');
  assert.equal(new URL(manifest.start_url, manifestResult.url).origin, origin, 'standalone launch must stay on the site');
  assert.ok(manifest.icons.some(icon => icon.sizes.split(' ').includes('192x192')), '192px installation icon');
  assert.ok(manifest.icons.some(icon => icon.sizes.split(' ').includes('512x512')), '512px installation icon');
  for (const icon of manifest.icons) {
    const url = new URL(icon.src, manifestResult.url).href;
    const result = await evaluate(`fetch(${JSON.stringify(url)}).then(async r => ({status:r.status,bytes:(await r.arrayBuffer()).byteLength,type:r.headers.get('content-type')}))`);
    assert.equal(result.status, 200, `manifest icon ${url}`);
    assert.ok(result.bytes > 100 && result.type?.startsWith('image/'), `usable image for ${url}`);
  }

  await until('navigator.serviceWorker.controller !== null', 'service worker control', 20000);
  const installability = await send('Page.getInstallabilityErrors');
  assert.deepEqual(installability.installabilityErrors, [], 'Chromium installability checks');
  assert.ok(await evaluate("document.getElementById('app-mode').textContent.trim().length > 0"), 'app-mode label');
  await evaluate("document.getElementById('install-app').click()");
  await until("document.getElementById('app-dialog').open", 'install fallback instructions');
  assert.ok(await evaluate("document.getElementById('app-dialog').textContent.trim().length > 80"), 'fallback must explain how to use the companion without an install prompt');
  await evaluate("document.getElementById('close-app-dialog').click()");
  assert.equal(await evaluate("document.getElementById('app-dialog').open"), false);

  // Exercise the actual controls before checking their recovery on a fresh page.
  await evaluate(`
    document.getElementById('follow').click();
    document.getElementById('trail').click();
    document.getElementById('grid').click();
    const zone = document.getElementById('zone'); zone.value = '1444'; zone.dispatchEvent(new Event('change',{bubbles:true}));
    document.getElementById('toggle-controls').click();
  `);
  const wantedPrefs = {follow: false, trail: false, grid: true, zone: '1444', mapOnly: true};
  assert.deepEqual(await readPrefs(), wantedPrefs);
  assert.equal(await evaluate("document.getElementById('toggle-controls').getAttribute('aria-expanded')"), 'false');
  assert.equal(await evaluate("document.getElementById('controls-panel').inert"), true, 'hidden sidebar must leave the tab order');
  assert.equal(await evaluate(shown('quick-connect')), true, 'connect remains available with controls hidden');
  const stored = await assertNoStoredPosition();
  assert.ok(Object.keys(stored.local).length > 0, 'selected preferences must be saved');

  await evaluate("document.getElementById('tab-character').click()");
  await reload({ignoreCache: true}, 'preferences restored after reload');
  assert.equal(await evaluate("document.getElementById('tab-character').getAttribute('aria-selected')"),'true','selected Character tab is remembered');
  assert.equal(await evaluate("document.getElementById('map-view').hidden"),true);
  await evaluate("document.getElementById('tab-bags').click()");
  await evaluate("document.getElementById('bags-layout').value='combined';document.getElementById('bags-layout').dispatchEvent(new Event('change'))");
  await reload({ignoreCache: true}, 'Bags tab restored after reload');
  assert.equal(await evaluate("document.getElementById('tab-bags').getAttribute('aria-selected')"),'true','selected Bags tab is remembered');
  assert.match(await evaluate("document.getElementById('bags-status').textContent"),/Connect WoW/);
  assert.equal(await evaluate("document.getElementById('bags-layout').value"),'combined','combined bag view is remembered');
  assert.equal(await evaluate("document.getElementById('combined-bag').hidden"),false);
  await evaluate("document.getElementById('tab-map').click()");
  assert.deepEqual(await readPrefs(), wantedPrefs);
  assert.equal(await evaluate("document.getElementById('status').textContent"), 'Not connected');
  assert.equal(await evaluate('window.__companionCaptureCalls'), 0, 'saved preferences cannot silently re-share a screen');
  await evaluate("document.getElementById('quick-connect').click()");
  await until("document.getElementById('status').textContent === 'Live position'", 'map-only capture');
  await until("document.getElementById('quick-status').textContent.includes('Live')", 'compact live status');
  await until("document.getElementById('quick-coordinates').textContent.includes('23.5') && document.getElementById('quick-coordinates').textContent.includes('67.9')", 'compact live coordinates');
  assert.equal(await evaluate("document.getElementById('map-title').textContent"), 'Feralas', 'manual browsing preference survives the first live packet');
  assert.equal(await evaluate('window.__companionCaptureCalls'), 1);
  await assertNoStoredPosition();

  // Map-only must remain operable on a narrow secondary display.
  await send('Emulation.setDeviceMetricsOverride', {width: 390, height: 844, deviceScaleFactor: 1, mobile: false});
  await wait(250);
  assert.ok(await evaluate('document.documentElement.scrollWidth <= innerWidth'), 'no narrow-window horizontal overflow');
  assert.equal(await evaluate(shown('quick-connect')), true, 'compact disconnect is visible at 390px');
  assert.equal(await evaluate(shown('toggle-controls')), true, 'restore-controls button is visible at 390px');
  await mkdir('artifacts', {recursive: true});
  const screenshot = await send('Page.captureScreenshot', {format: 'png'});
  await writeFile('artifacts/companion-map-only-mobile.png', Buffer.from(screenshot.data, 'base64'));
  await evaluate("document.getElementById('quick-connect').click(); clearInterval(window.__companionTimer)");
  await until("document.getElementById('status').textContent === 'Not connected'", 'compact disconnect');
  assert.equal(await evaluate('window.__companionStream.getTracks().every(track => track.readyState === "ended")'), true);
  await evaluate("document.getElementById('quick-connect').click()");
  await until("document.getElementById('status').textContent === 'Live position'", 'compact reconnect');
  assert.equal(await evaluate('window.__companionCaptureCalls'), 2);
  await evaluate("document.getElementById('toggle-controls').click()");
  assert.equal(await evaluate("document.getElementById('controls-panel').inert"), false);
  assert.equal(await evaluate("document.getElementById('toggle-controls').getAttribute('aria-expanded')"), 'true');
  await evaluate("document.getElementById('toggle-controls').click()");

  // Cache storage must contain only same-origin shell resources, not map CDN
  // requests, frames, coordinates, or a serialized live session.
  const cached = await evaluate(`caches.keys().then(async names => (await Promise.all(names.map(async name => {
    const cache = await caches.open(name); return (await cache.keys()).map(request => request.url);
  }))).flat())`);
  assert.ok(cached.length > 0, 'service worker must cache the shell');
  assert.ok(cached.some(url=>url.endsWith('/tabs.js')),'offline shell includes tab navigation');
  for (const url of cached) {
    const parsed = new URL(url);
    assert.equal(parsed.origin, origin, 'external map art should not be placed in shell cache');
    assert.equal(parsed.search, '', 'live data must not become cache query parameters');
    assert.ok(!/capture|screenshot|position|telemetry/i.test(parsed.pathname), 'no captured/live resource in cache');
  }

  // Reload offline while tracking: UI/preferences must reopen, but a previous
  // coordinate must never reappear as live and capture must require a new click.
  await evaluate("document.getElementById('tab-updates').click()");
  await evaluate("document.getElementById('split-view-toggle').click();document.getElementById('split-secondary').value='bags';document.getElementById('split-secondary').dispatchEvent(new Event('change'))");
  await send('Network.emulateNetworkConditions', {offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0});
  offline = true;
  await reload({ignoreCache: false}, 'offline companion shell');
  assert.deepEqual(await readPrefs(), wantedPrefs);
  assert.equal(await evaluate("document.getElementById('tab-updates').getAttribute('aria-selected')"),'true','Updates tab is remembered offline');
  assert.equal(await evaluate("document.getElementById('updates-view').hidden"),false);
  assert.equal(await evaluate("document.body.classList.contains('split-view')"),true,'split mode is remembered offline');
  assert.equal(await evaluate("document.getElementById('split-primary').value"),'updates');
  assert.equal(await evaluate("document.getElementById('split-secondary').value"),'bags');
  assert.equal(await evaluate("document.getElementById('bags-view').hidden"),false,'both saved panes reopen offline');
  assert.equal(await evaluate("document.getElementById('status').textContent"), 'Not connected');
  assert.equal(await evaluate("document.getElementById('coord-x').textContent"), '—');
  assert.equal(await evaluate("document.getElementById('coord-y').textContent"), '—');
  assert.equal(await evaluate('window.__companionCaptureCalls'), 0);
  assert.ok(await evaluate("!document.getElementById('quick-status').textContent.includes('Live position')"), 'offline reload cannot claim a live position');
  await assertNoStoredPosition();
  assert.deepEqual(runtimeErrors, [], 'no uncaught browser exceptions');

  console.log('Companion QA passed: parsed/installable manifest and icons, install fallback, service worker, persisted tabs and display preferences, offline tab navigation, map-only accessibility, desktop/mobile reconnect, local-only live data, offline shell, and fresh reconnect required after reload.');
} finally {
  if (offline) await send('Network.emulateNetworkConditions', {offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1}).catch(() => {});
  await evaluate('if(window.__companionTimer)clearInterval(window.__companionTimer);if(window.__companionStream)window.__companionStream.getTracks().forEach(track=>track.stop())').catch(() => {});
  socket.close();
  await fetch(`${cdp}/json/close/${target.id}`).catch(() => {});
}
