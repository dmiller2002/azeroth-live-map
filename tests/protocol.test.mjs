import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  HEADER, COLS, ROWS, encodePacket, decodeBytes, decodeAt, findStrip, Freshness,
} from '../dist/protocol.js';

const root = fileURLToPath(new URL('../', import.meta.url));
function runLua(program, runtime = 'lua') {
  const result = spawnSync(runtime, ['-e', program], {cwd: root, encoding: 'utf8', timeout: 3000});
  assert.equal(result.status, 0, result.stderr || result.error?.message);
  return result.stdout.trim();
}
const luaLiteral = n => n === null || n === undefined ? 'nil' : String(n);
function luaPacket({mapId = 1429, x = .5, y = .5, facing = 0, sequence = 1, clock = 1000} = {}, runtime = 'lua') {
  const args = [mapId, x, y, facing, sequence, clock].map(luaLiteral).join(', ');
  return runLua(`local ns = {}; assert(loadfile('addon/AzerothLiveMap/Protocol.lua'))('AzerothLiveMap', ns)
    print(table.concat(ns.Encode(${args}), ','))`, runtime).split(',').map(Number);
}
function close(actual, expected, tolerance = 1 / 65535) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} should be near ${expected}`);
}

// Independently rasterize the wire format, including antialiasing at cell edges.
// This intentionally does not use production drawStrip or its bit helper.
function fixture(bytes, {cell = 6, x = 31, y = 29, width = 440, height = 160, white = 255, black = 0, antialias = false} = {}) {
  width = Math.max(width, Math.ceil(x + COLS * cell + 20));
  height = Math.max(height, Math.ceil(y + ROWS * cell + 20));
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = 37; data[i + 1] = 48; data[i + 2] = 58; data[i + 3] = 255;
  }
  const headerBits = HEADER.flatMap(b => b.toString(2).padStart(8, '0').split('').map(Number));
  const payloadBits = bytes.flatMap(b => b.toString(2).padStart(8, '0').split('').map(Number));
  function valueAt(px, py) {
    const col = Math.floor((px - x) / cell), row = Math.floor((py - y) / cell);
    if (col < 0 || col >= COLS || row < 0 || row >= ROWS) return null;
    if (col === 0 || col === 49 || row === 0 || row === 7) return black;
    const bit = row === 1 ? headerBits[col - 1] : row === 2 ? 1 - headerBits[col - 1] : payloadBits[(row - 3) * 48 + col - 1];
    return bit ? white : black;
  }
  for (let py = Math.floor(y); py < Math.ceil(y + ROWS * cell); py++) {
    for (let px = Math.floor(x); px < Math.ceil(x + COLS * cell); px++) {
      let value;
      if (antialias) {
        let sum = 0;
        for (const dy of [.125, .375, .625, .875]) for (const dx of [.125, .375, .625, .875]) {
          sum += valueAt(px + dx, py + dy) ?? 48;
        }
        value = sum / 16;
      } else value = valueAt(px + .5, py + .5) ?? 48;
      const i = (py * width + px) * 4;
      data[i] = data[i + 1] = data[i + 2] = value;
    }
  }
  return {image: {data, width, height}, rect: {x, y, width: COLS * cell, height: ROWS * cell}};
}

test('Lua emitter and browser decoder agree on live position, direction, and heartbeat', () => {
  const input = {mapId: 1944, x: .3179, y: .8241, facing: 4.71238898038469, sequence: 65300, clock: 1234567890};
  const bytes = luaPacket(input);
  assert.equal(bytes.length, 24);
  assert.deepEqual(bytes, encodePacket(input));
  const packet = decodeBytes(bytes);
  assert.equal(packet.valid, true);
  assert.equal(packet.mapId, input.mapId);
  assert.equal(packet.sequence, input.sequence);
  assert.equal(packet.clock, input.clock);
  close(packet.x, input.x); close(packet.y, input.y);
  close(packet.facing, input.facing, 2 * Math.PI / 65535);
});

test('Lua coordinates encode map edges, nullable facing, and clockwise wrap', () => {
  const edge = decodeBytes(luaPacket({mapId: 1453, x: 0, y: 1, facing: null}));
  assert.equal(edge.valid, true); assert.equal(edge.x, 0); assert.equal(edge.y, 1); assert.equal(edge.facing, null);
  const wrap = decodeBytes(luaPacket({facing: -Math.PI / 2, sequence: 65536, clock: 4294967296 + 9}));
  assert.equal(wrap.sequence, 0); assert.equal(wrap.clock, 9);
  close(wrap.facing, Math.PI * 1.5, 2 * Math.PI / 65535);
});

test('the encoder is compatible with the Lua 5.1 language used by WoW', () => {
  const input = {mapId: 1453, x: .51512, y: .9987, facing: -3, sequence: 65535, clock: 4294967295};
  assert.deepEqual(luaPacket(input, 'luajit'), luaPacket(input));
});

test('Lua emitter marks missing or out-of-range positions unavailable', () => {
  for (const bad of [{mapId: null}, {x: null}, {y: null}, {x: -0.1}, {x: 1.1}, {y: -0.1}, {y: 1.1}, {mapId: 0}]) {
    const packet = decodeBytes(luaPacket(bad));
    assert.ok(packet); assert.equal(packet.valid, false, JSON.stringify(bad));
    assert.equal(packet.mapId, 0); assert.equal(packet.x, 0); assert.equal(packet.y, 0); assert.equal(packet.facing, null);
  }
});

test('corruption in any packet byte is rejected; unsupported version and flags fail closed', () => {
  const bytes = luaPacket();
  for (let i = 0; i < bytes.length; i++) {
    const changed = [...bytes]; changed[i] ^= 1;
    assert.equal(decodeBytes(changed), null, `byte ${i}`);
  }
  assert.equal(decodeBytes(bytes.slice(1)), null);
  assert.equal(decodeBytes([...bytes, 0]), null);
  // Recompute sums so format rejection is not merely a checksum failure.
  for (const [index, value] of [[0, 99], [1, 2], [2, 8]]) {
    const changed = [...bytes]; changed[index] = value;
    let a = 0, b = 0;
    for (let j = 0; j < 22; j++) { a = (a + changed[j]) % 255; b = (b + a) % 255; }
    changed[22] = a; changed[23] = b;
    assert.equal(decodeBytes(changed), null);
  }
});

for (const cell of [1.5, 2, 2.5, 3, 4, 6, 9, 12]) {
  test(`optical auto-detection finds a ${cell}px strip away from the screen origin`, () => {
    const bytes = luaPacket({mapId: 1946, x: .25, y: .75, sequence: 987});
    const {image, rect} = fixture(bytes, {cell});
    assert.equal(decodeAt(image, rect)?.mapId, 1946);
    const found = findStrip(image);
    assert.ok(found, 'strip was not found');
    assert.equal(found.packet.sequence, 987);
    close(found.packet.x, .25); close(found.packet.y, .75);
  });
}

for (const cell of [2.4, 3.6, 4.8]) {
  test(`optical detection survives fractional ${cell}px cells with antialiased capture scaling`, () => {
    const {image, rect} = fixture(luaPacket({sequence: 221}), {cell, x: 31.25, y: 29.5, antialias: true});
    assert.equal(decodeAt(image, rect)?.sequence, 221, 'manual calibration should decode');
    assert.equal(findStrip(image)?.packet.sequence, 221, 'automatic detection should decode');
  });
}

test('monochrome encoding survives moderate black/white level changes', () => {
  const {image, rect} = fixture(luaPacket(), {black: 35, white: 220});
  assert.equal(decodeAt(image, rect)?.mapId, 1429);
  assert.equal(findStrip(image)?.packet.mapId, 1429);
});

test('headers without a valid payload and damaged bitmaps do not create a false location', () => {
  const bytes = luaPacket(); bytes[8] ^= 4;
  const {image, rect} = fixture(bytes);
  assert.equal(decodeAt(image, rect), null);
  assert.equal(findStrip(image), null);
  const empty = {data: new Uint8ClampedArray(640 * 100 * 4).fill(255), width: 640, height: 100};
  assert.equal(findStrip(empty), null);
  assert.equal(decodeAt(empty, {x: 0, y: 0, width: 300, height: 48}), null);
});

test('noise and a checkerboard UI pattern are not mistaken for the position strip', () => {
  const width = 600, height = 120, data = new Uint8ClampedArray(width * height * 4);
  let seed = 11;
  for (let i = 0; i < width * height; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const color = (seed >>> 28) & 1 ? 255 : 0;
    data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = color; data[i * 4 + 3] = 255;
  }
  assert.equal(findStrip({data, width, height}), null);
});

test('an edge pixel exactly at the white threshold cannot lock the detector', () => {
  // Keep a regression in a subprocess: an infinite scan must fail this test
  // rather than freezing the entire suite (or the user's browser).
  const program = `import {findStrip} from './dist/protocol.js';
    const image = {width: 100, height: 20, data: new Uint8ClampedArray(100 * 20 * 4)};
    const i = (2 * 100 + 1) * 4;
    image.data[i] = image.data[i + 1] = image.data[i + 2] = 170;
    if (findStrip(image) !== null) throw new Error('unexpected strip');`;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', program], {
    cwd: root, encoding: 'utf8', timeout: 1500,
  });
  assert.equal(result.status, 0, result.error?.message || result.stderr);
});

test('a frozen capture expires even if the same valid packet is delivered repeatedly', () => {
  const freshness = new Freshness();
  assert.equal(freshness.isFresh(0), false);
  const packet = decodeBytes(luaPacket());
  assert.equal(freshness.accept(packet, 10), true);
  assert.equal(freshness.isFresh(1000), true);
  assert.equal(freshness.accept(packet, 2000), false);
  assert.equal(freshness.isFresh(2510), false);
  const next = {...packet, sequence: packet.sequence + 1, clock: packet.clock + 100};
  assert.equal(freshness.accept(next, 2600), true);
  assert.equal(freshness.isFresh(2600), true);
});

test('heartbeat updates while stationary, survives sequence rollover, and reset clears position', () => {
  const freshness = new Freshness();
  const old = decodeBytes(luaPacket({sequence: 65535, clock: 6553500}));
  const next = decodeBytes(luaPacket({sequence: 0, clock: 6553600}));
  freshness.accept(old, 100);
  assert.equal(freshness.accept(next, 200), true);
  assert.equal(freshness.packet.sequence, 0);
  freshness.reset();
  assert.equal(freshness.packet, null); assert.equal(freshness.isFresh(201), false);
});

test('actual addon login and timer render a readable position; unavailable (0,0) clears validity', () => {
  const output = runLua(`
    local ns, frame = {}, nil
    local now, px, py = 10, .2345, .6789
    UIParent = {GetEffectiveScale = function() return .8 end}
    SlashCmdList = {}
    function GetTime() return now end
    function GetPlayerFacing() return math.pi end
    C_Map = {
      GetBestMapForUnit = function() return 1944 end,
      GetPlayerMapPosition = function() return {GetXY = function() return px, py end} end,
    }
    local dummy = function() end
    function CreateFrame()
      frame = {textures = {}, scripts = {}}
      function frame:CreateTexture()
        local t = {SetAllPoints = dummy, ClearAllPoints = dummy}
        function t:SetColorTexture(r, g, b, a) self.value = r end
        function t:SetSize(w, h) self.width, self.height = w, h end
        function t:SetPoint(_, _, _, x, y) self.x, self.y = x, y end
        table.insert(self.textures, t); return t
      end
      function frame:SetScript(kind, fn) self.scripts[kind] = fn end
      function frame:SetShown(value) self.visible = value end
      function frame:SetSize(w, h) self.width, self.height = w, h end
      function frame:SetScale(value) self.scale = value end
      frame.SetFrameStrata, frame.EnableMouse = dummy, dummy
      frame.ClearAllPoints, frame.SetPoint, frame.RegisterEvent = dummy, dummy, dummy
      return frame
    end
    local originalPrint = print; print = function() end
    assert(loadfile('addon/AzerothLiveMap/Protocol.lua'))('AzerothLiveMap', ns)
    assert(loadfile('addon/AzerothLiveMap/Main.lua'))('AzerothLiveMap', ns)
    frame.scripts.OnEvent(frame, 'PLAYER_LOGIN')
    local function snapshot()
      local bits = {}
      for i = 2, #frame.textures do bits[#bits + 1] = frame.textures[i].value end
      originalPrint(table.concat(bits, ''))
    end
    assert(frame.width == 300 and frame.height == 48 and frame.visible)
    assert(math.abs(frame.scale * UIParent:GetEffectiveScale() - 1) < .00001)
    snapshot()
    now = 10.2; px, py = 0, 0
    frame.scripts.OnUpdate(frame, .2); snapshot()
    SlashCmdList.AZEROTHLIVEMAP('hide'); assert(not frame.visible)
    SlashCmdList.AZEROTHLIVEMAP('size 10'); assert(frame.width == 500)
    SlashCmdList.AZEROTHLIVEMAP('show'); assert(frame.visible)
  `);
  const rows = output.split('\n');
  assert.equal(rows.length, 2);
  const extract = row => {
    assert.equal(row.length, 288);
    const expectedHeader = HEADER.map(n => n.toString(2).padStart(8, '0')).join('');
    assert.equal(row.slice(0, 48), expectedHeader);
    assert.equal(row.slice(48, 96), expectedHeader.replace(/[01]/g, n => n === '1' ? '0' : '1'));
    const bytes = row.slice(96).match(/.{8}/g).map(n => parseInt(n, 2));
    return decodeBytes(bytes);
  };
  const live = extract(rows[0]);
  assert.equal(live.mapId, 1944); assert.equal(live.valid, true);
  close(live.x, .2345); close(live.y, .6789);
  const missing = extract(rows[1]);
  assert.equal(missing.valid, false);
  assert.equal(missing.sequence, live.sequence + 1);
  assert.ok(missing.clock > live.clock);
});
