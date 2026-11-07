const test = require('node:test');
const assert = require('node:assert/strict');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check) {
  const deadline = Date.now() + 3000;
  while (!check()) { assert.ok(Date.now() < deadline, 'Model operation timed out'); await wait(10); }
}
function feedWith(equipment) {
  return { session: 1, identity: { info: { raceId: 1, sex: 2 }, text: 'Test character' }, slot: slot => ({ info: { itemId: equipment[slot] || 0 } }) };
}

test('Forever display IDs replace legacy gear while preserving robes and weapon hands', async () => {
  const { equippedModels } = await import('../app/character-model.js');
  const records = { 35: { display: 472, inventoryType: 20 }, 2092: { display: 2704, inventoryType: 13 }, 25: { display: 1542, inventoryType: 21 } };
  const result = await equippedModels(feedWith({ 1: 999999, 5: 35, 16: 2092, 17: 25 }), async id => records[id]);
  assert.deepEqual(result, { items: [
    { slot: 20, display: 472, visual: 0 },
    { slot: 21, display: 2704, visual: 0 },
    { slot: 22, display: 1542, visual: 0 },
  ], unknown: [999999] });
});

test('changing gear during lookup cannot restore an older outfit; empty slots clear and refresh retries missing models', async t => {
  const originals = Object.fromEntries(['window', 'document', 'localStorage', 'ResizeObserver', 'fetch'].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  t.after(() => { for (const [name, descriptor] of Object.entries(originals)) descriptor ? Object.defineProperty(globalThis, name, descriptor) : delete globalThis[name]; });
  const elements = new Map();
  function element(id) {
    if (!elements.has(id)) elements.set(id, { hidden: false, dataset: {}, textContent: '', replaceChildren() {}, setAttribute() {}, addEventListener() {}, querySelector: () => ({}), getBoundingClientRect: () => ({ width: 250, height: 430 }) });
    return elements.get(id);
  }
  globalThis.document = { getElementById: element, querySelectorAll: () => [] };
  globalThis.localStorage = { getItem: () => null };
  globalThis.ResizeObserver = class { observe() {} };
  let viewer;
  globalThis.window = { jQuery() {}, ZamModelViewer: class {
    constructor() { viewer = this; this.options = {}; this.renderer = { actors: [{ loaded: true }], downloads: {} }; this.calls = []; }
    method(name, args) { this.calls.push({ name, args }); }
    destroy() {}
  } };
  const pending = new Map(), calls = [];
  let missing = true;
  globalThis.fetch = async url => {
    calls.push(url);
    if (url.includes('charactercustomization')) return Response.json({ Options: [] });
    if (url.startsWith('/_items/')) return new Promise(resolve => pending.set(url, resolve));
    if (url.includes('/300.json') && missing) return new Response('', { status: 404 });
    return Response.json({});
  };
  const { createCharacterModel } = await import('../app/character-model.js');
  const model = createCharacterModel(), equipment = { 1: 100 };
  t.after(() => model.destroy());
  const feed = feedWith(equipment), update = () => model.update({ available: true, currentFeed: feed });
  update();
  await until(() => pending.has('/_items/100.json'));
  equipment[1] = 200; update();
  await until(() => pending.has('/_items/200.json'));
  pending.get('/_items/200.json')(Response.json({ display: 200, inventoryType: 1 }));
  await until(() => viewer.calls.some(call => call.name === 'setItems'));
  pending.get('/_items/100.json')(Response.json({ display: 100, inventoryType: 1 }));
  await wait(30);
  assert.deepEqual(viewer.calls.filter(call => call.name === 'setItems').map(call => call.args[0]), [[{ slot: 1, display: 200, visual: 0 }]]);
  assert.equal(calls.includes('/_model/meta/armor/1/100.json'), false, 'An obsolete outfit must not reach the renderer');
  const lookups = calls.length;
  for (let i = 0; i < 20; i++) update();
  assert.equal(calls.length, lookups, 'Unchanged capture frames must not restart gear loading');
  viewer.calls = []; delete equipment[1]; update(); await wait(10);
  assert.ok(viewer.calls.some(call => call.name === 'clearSlots' && call.args[0] === '1'));
  assert.equal(viewer.calls.some(call => call.name === 'setItems'), false);
  equipment[1] = 300; update();
  await until(() => pending.has('/_items/300.json'));
  pending.get('/_items/300.json')(Response.json({ display: 300, inventoryType: 1 }));
  await until(() => element('model-status').textContent.includes('1 equipped item unavailable'));
  assert.equal(viewer.calls.some(call => call.name === 'setItems'), false);
  missing = false; pending.delete('/_items/300.json'); element('model-refresh').onclick();
  await until(() => pending.has('/_items/300.json'));
  pending.get('/_items/300.json')(Response.json({ display: 300, inventoryType: 1 }));
  await until(() => viewer.calls.some(call => call.name === 'setItems'));
  assert.deepEqual(viewer.calls.find(call => call.name === 'setItems').args[0], [{ slot: 1, display: 300, visual: 0 }]);
});
