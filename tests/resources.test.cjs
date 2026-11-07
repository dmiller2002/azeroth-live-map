const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { ORIGIN, MAX_ASSET_BYTES, MAX_ITEM_BYTES, isAppURL, localFile, modelURL, itemURL, itemModel, externalURL, createResourceHandler } = require('../desktop/resources.cjs');
const root = path.resolve(__dirname, '../app');

test('local resources never resolve outside the bundled interface', async () => {
  for (const value of ['file:///etc/passwd', 'azeroth://other/index.html', ORIGIN + '/%2e%2e%2fdesktop/main.cjs', ORIGIN + '/%5c..%5cdesktop/main.cjs', ORIGIN + '/%00', ORIGIN + '/%zz']) assert.equal(localFile(value, root), null, value);
  assert.equal(isAppURL('azeroth://companion.evil/'), false);
  assert.equal(localFile(ORIGIN + '/', root), path.join(root, 'index.html'));
  const handle = createResourceHandler(root);
  const page = await handle({ method: 'GET', url: ORIGIN + '/' });
  assert.equal(page.status, 200); assert.match(await page.text(), /Drunks Azeroth Companion/);
  assert.match(page.headers.get('content-security-policy'), /script-src 'self'/);
  assert.equal((await handle({ method: 'POST', url: ORIGIN + '/' })).status, 405);
  assert.equal((await handle({ method: 'GET', url: ORIGIN + '/desktop/main.cjs' })).status, 404);
});

test('model resources accept only supported public model paths', () => {
  for (const name of ['viewer.js', 'meta/character/9.json', 'meta/armor/1/34218.json', 'meta/charactercustomization/9.json', 'm2/123.m2', 'skin/123.skin', 'skel/123.skel', 'textures/123.webp']) assert.match(modelURL(ORIGIN + '/_model/' + name), /^https:\/\/wow\.zamimg\.com\/modelviewer\//);
  for (const name of ['https://example.com/private', '../index.html', 'viewer.js?url=http://localhost', 'viewer.js#fragment', 'textures/a.webp', 'meta/character/123456789.json']) assert.equal(modelURL(ORIGIN + '/_model/' + name), null, name);
});

test('model asset fetching strips caller credentials, sets MIME and caches successful downloads', async () => {
  const calls = [];
  const handle = createResourceHandler(root, async (url, options) => { calls.push({ url, options }); return new Response('{"test":true}', { headers: { 'content-type': 'text/html' } }); });
  const request = { method: 'GET', url: ORIGIN + '/_model/meta/character/9.json', headers: { Cookie: 'private', Authorization: 'secret' } };
  const first = await handle(request), second = await handle(request);
  assert.equal(first.status, 200); assert.equal(first.headers.get('content-type'), 'application/json');
  assert.deepEqual(await first.json(), { test: true }); assert.deepEqual(await second.json(), { test: true });
  assert.equal(calls.length, 1); assert.equal(calls[0].options.credentials, 'omit'); assert.equal(calls[0].options.headers, undefined); assert.equal(calls[0].options.redirect, 'error');
});

test('model failures and oversized bodies fail without being cached', async () => {
  const url = ORIGIN + '/_model/viewer.js';
  const request = { method: 'GET', url };
  const absent = createResourceHandler(root, async () => new Response('', { status: 404 }));
  assert.equal((await absent(request)).status, 404);
  const networkError = createResourceHandler(root, async () => { throw new Error('offline'); });
  assert.equal((await networkError(request)).status, 502);
  const largeHeader = createResourceHandler(root, async () => new Response('large', { headers: { 'content-length': MAX_ASSET_BYTES + 1 } }));
  assert.equal((await largeHeader(request)).status, 502);
  let calls = 0;
  const largeBody = createResourceHandler(root, async () => { calls++; return new Response(new Uint8Array(MAX_ASSET_BYTES + 1)); });
  assert.equal((await largeBody(request)).status, 502); assert.equal((await largeBody(request)).status, 502); assert.equal(calls, 2);
});

test('the upstream viewer stylesheet resolves through the desktop model route', async () => {
  const handle = createResourceHandler(root, async () => new Response('href="//wow.zamimg.com/modelviewer/viewer/viewer.css"'));
  const script = await handle({ method: 'GET', url: ORIGIN + '/_model/viewer.js' });
  assert.equal(await script.text(), 'href="/_model/viewer.css"');
  assert.equal(modelURL(ORIGIN + '/_model/viewer.css'), 'https://wow.zamimg.com/modelviewer/viewer/viewer.css');
});

test('external links permit only HTTPS Wowhead pages', () => {
  assert.equal(externalURL('https://www.wowhead.com/tbc/item=6948'), true);
  for (const value of ['file:///tmp/file', 'javascript:alert(1)', 'https://www.wowhead.com.evil/', 'http://www.wowhead.com/', 'https://user@www.wowhead.com/', 'https://www.wowhead.com:444/']) assert.equal(externalURL(value), false);
});

const equipmentXML = (id, display = 1542, slot = 21) => `<?xml version="1.0"?><wowhead><item id="${id}"><icon displayId="${display}">inv_sword_04</icon><inventorySlot id="${slot}">Main Hand</inventorySlot></item></wowhead>`;

test('equipment appearances resolve only the requested Forever item, with no legacy fallback', async () => {
  assert.equal(itemURL(ORIGIN + '/_items/25.json'), 'https://www.wowhead.com/forever/item=25&xml');
  for (const name of ['0.json', '-1.json', '25.json?url=http://localhost', '25.json#fragment', 'https://example.com', '123456789.json']) assert.equal(itemURL(ORIGIN + '/_items/' + name), null);
  assert.deepEqual(itemModel(equipmentXML(25), 25), { display: 1542, inventoryType: 21 });
  for (const xml of [equipmentXML(26), equipmentXML(25, 0), equipmentXML(25, 1542, 0), '<wowhead><error>Item not found!</error></wowhead>']) assert.equal(itemModel(xml, 25), null);
  const calls = [];
  const handle = createResourceHandler(root, async (url, options) => { calls.push({ url, options }); return new Response(equipmentXML(25)); });
  const request = { method: 'GET', url: ORIGIN + '/_items/25.json', headers: { Cookie: 'private' } };
  for (let i = 0; i < 2; i++) {
    const result = await handle(request);
    assert.equal(result.status, 200); assert.equal(result.headers.get('content-type'), 'application/json');
    assert.deepEqual(await result.json(), { display: 1542, inventoryType: 21 });
  }
  assert.equal(calls.length, 1); assert.equal(calls[0].options.credentials, 'omit'); assert.equal(calls[0].options.headers, undefined);
  assert.equal(calls[0].url, 'https://www.wowhead.com/forever/item=25&xml');
});

test('missing, mismatched, and oversized Forever item responses are omitted and can be retried', async () => {
  const request = { method: 'GET', url: ORIGIN + '/_items/25.json' };
  let attempts = 0;
  const handle = createResourceHandler(root, async () => new Response(++attempts === 1 ? equipmentXML(26) : equipmentXML(25)));
  assert.equal((await handle(request)).status, 404);
  assert.equal((await handle(request)).status, 200);
  const oversized = createResourceHandler(root, async () => new Response(new Uint8Array(MAX_ITEM_BYTES + 1)));
  assert.equal((await oversized(request)).status, 502);
});
