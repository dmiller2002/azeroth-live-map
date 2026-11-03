const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeUIScale, setupUIScaleIPC } = require('../desktop/ui-scale.cjs');

test('old or corrupt saved settings recover to a usable scale', () => {
  for (const value of [undefined, null, '125', {}, NaN, Infinity, -Infinity]) assert.equal(normalizeUIScale(value), 100);
  assert.equal(normalizeUIScale(125), 125);
  assert.equal(normalizeUIScale(-20), 50);
  assert.equal(normalizeUIScale(9999), 200);
});

test('only an authorized renderer can read or change scale, with bounded numeric input', () => {
  const handlers = new Map();
  const ipcMain = { handle: (name, handler) => handlers.set(name, handler) };
  const trusted = {}, untrusted = {}; let current = 100;
  setupUIScaleIPC(ipcMain, event => event === trusted, () => current, value => { current = value; return current; });
  const get = handlers.get('ui-scale:get'), set = handlers.get('ui-scale:set');
  assert.equal(get(trusted), 100);
  assert.throws(() => get(untrusted), /Unavailable/);
  assert.throws(() => set(untrusted, 125), /Unavailable/);
  for (const value of ['125', {}, null, Infinity, NaN]) assert.throws(() => set(trusted, value), /finite number/);
  assert.equal(current, 100);
  assert.equal(set(trusted, 125), 125);
  assert.equal(set(trusted, 1000), 200);
  assert.equal(set(trusted, 1), 50);
});
