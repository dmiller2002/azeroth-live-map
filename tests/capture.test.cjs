const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function setup({ enumerate, platform = 'win32', env = {} } = {}) {
  const windows = [], handlers = new Map();
  class Window extends EventEmitter {
    constructor(options) { super(); this.options = options; this.destroyed = false; this.webContents = new EventEmitter(); this.webContents.mainFrame = {}; this.webContents.setWindowOpenHandler = () => {}; windows.push(this); }
    isDestroyed() { return this.destroyed; }
    setMenu() {}
    async loadURL(url) { this.url = url; }
    close() { this.destroyed = true; this.emit('closed'); }
  }
  let enumerations = 0;
  const source = { id: 'window:123', name: 'World of Warcraft', thumbnail: { toDataURL: () => 'data:image/png;base64,preview' } };
  const electron = {
    BrowserWindow: Window,
    desktopCapturer: { getSources: async () => { enumerations++; return enumerate ? enumerate(source) : [source]; } },
    ipcMain: { handle: (name, handler) => handlers.set(name, handler) }
  };
  const module = { exports: {} };
  vm.runInNewContext(readFileSync(path.join(__dirname, '../desktop/capture.cjs'), 'utf8'), {
    require: name => name === 'electron' ? electron : name === './resources.cjs' ? require('../desktop/resources.cjs') : require(name),
    module, exports: module.exports, __dirname: path.join(__dirname, '../desktop'), process: { platform, env }, console
  });
  const main = new Window(); let handler;
  module.exports.setupCapture({ setDisplayMediaRequestHandler: callback => { handler = callback; } }, () => main);
  const replies = [];
  const request = async (overrides = {}) => handler({ frame: main.webContents.mainFrame, userGesture: true, videoRequested: true, audioRequested: false, ...overrides }, value => replies.push(value));
  const invoke = (name, window, value, frame = window.webContents.mainFrame) => handlers.get(name)({ sender: window.webContents, senderFrame: frame }, value);
  return { main, windows, request, replies, invoke, source, enumerations: () => enumerations };
}

test('capture requires the main frame, a user action, and video without audio', async () => {
  const app = setup();
  for (const override of [{ frame: {} }, { userGesture: false }, { videoRequested: false }, { audioRequested: true }]) await app.request(override);
  assert.equal(app.enumerations(), 0); assert.equal(app.replies.length, 4);
  assert.ok(app.replies.every(value => !value.video));
});

test('the picker lists sources only to its own main frame and grants only the selected source', async () => {
  const app = setup(); await app.request();
  const picker = app.windows[1]; assert.match(picker.url, /capture.html$/);
  assert.throws(() => app.invoke('capture:sources', app.main), /Unavailable/);
  assert.throws(() => app.invoke('capture:sources', picker, undefined, {}), /Unavailable/);
  const sources = app.invoke('capture:sources', picker);
  assert.equal(sources[0].name, 'World of Warcraft');
  assert.throws(() => app.invoke('capture:choose', picker, 'window:999'), /Unknown/);
  assert.equal(app.replies.length, 0);
  app.invoke('capture:choose', picker, app.source.id);
  assert.equal(app.replies.length, 1); assert.equal(app.replies[0].video, app.source);
  assert.equal(app.replies[0].audio, undefined); assert.equal(picker.isDestroyed(), true);
});

test('canceling or closing the picker denies capture exactly once and allows a later request', async () => {
  const app = setup(); await app.request(); app.invoke('capture:choose', app.windows[1], null);
  assert.equal(app.replies.length, 1); assert.equal(app.replies[0].video, undefined);
  await app.request(); app.windows[2].close();
  assert.equal(app.replies.length, 2); assert.equal(app.replies[1].video, undefined);
});

test('concurrent capture requests cannot replace a pending source selection', async () => {
  let release;
  const app = setup({ enumerate: source => new Promise(resolve => { release = () => resolve([source]); }) });
  const first = app.request(); await app.request();
  assert.equal(app.enumerations(), 1); assert.equal(app.replies.length, 1);
  assert.equal(app.replies[0].video, undefined);
  release(); await first; app.invoke('capture:choose', app.windows[1], null);
  assert.equal(app.replies.length, 2);
});

test('a single PipeWire source uses the selection already made in the system portal', async () => {
  const app = setup({ platform: 'linux', env: { XDG_SESSION_TYPE: 'wayland' } });
  await app.request(); assert.equal(app.windows.length, 1);
  assert.equal(app.replies[0].video, app.source);
});

test('an empty source list denies capture without opening a picker', async () => {
  const app = setup({ enumerate: () => [] }); await app.request();
  assert.equal(app.windows.length, 1); assert.equal(app.replies.length, 1); assert.equal(app.replies[0].video, undefined);
});
