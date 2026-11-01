import {decodeArtAt} from './art.js';
export const HEADER = [211, 145, 166, 92, 240, 43];
export const COLS = 50, ROWS = 8;
export const bit = (bytes, i) => (bytes[i >> 3] >> (7 - (i & 7))) & 1;

export function checksum(bytes) {
  let a = 0, b = 0;
  for (const byte of bytes) { a = (a + byte) % 255; b = (b + a) % 255; }
  return [a, b];
}

export function decodeBytes(bytes) {
  if (bytes.length !== 24 || bytes[0] !== 167) return null;
  const [a, b] = checksum(bytes.slice(0, 22));
  if (bytes[22] !== a || bytes[23] !== b) return null;
  const u16 = i => bytes[i] * 256 + bytes[i + 1];
  if (bytes[1] === 2 || bytes[1] === 3) {
    const version = bytes[1], maxMarkers = version === 3 ? 65535 : 96;
    const base = {type:'quest', version, kind:bytes[2], sequence:u16(3), mapId:u16(5), generation:u16(7), index:u16(9)};
    if (version === 3 && base.kind === 3) {
      if (base.mapId || bytes[11]>2 || bytes[12]>1 || (bytes[11]!==1 && base.index)) return null;
      return {...base, zoneCount:base.index, status:bytes[11], limited:Boolean(bytes[12]), totalCount:u16(13)*65536+u16(15)};
    }
    if (version === 3 && base.kind === 2) {
      const questId = base.mapId*65536+base.index;
      if (!questId || base.mapId>255 || (bytes[11]&127)>=8) return null;
      return {...base, questId, fragment:bytes[11]&127, final:Boolean(bytes[11]&128), textBytes:Array.from(bytes.slice(12,22))};
    }
    if (base.kind === 0) {
      if (base.index > maxMarkers || bytes[11] > 2 || bytes[12] > 1 || (bytes[11] !== 1 && base.index)) return null;
      return {...base, count:base.index, status:bytes[11], limited:Boolean(bytes[12])};
    }
    if (!base.index || base.index > maxMarkers) return null;
    if (base.kind === 1) {
      const questId = bytes[11] * 65536 + u16(12);
      if (!questId || bytes[18] < 1 || bytes[18] > 3) return null;
      return {...base, questId, x:u16(14)/65535, y:u16(16)/65535, markerKind:bytes[18], objective:bytes[19], collected:bytes[20], needed:bytes[21]};
    }
    if (base.kind === 2 && (bytes[11] & 127) < 8) {
      return {...base, fragment:bytes[11] & 127, final:Boolean(bytes[11] & 128), textBytes:Array.from(bytes.slice(12,22))};
    }
    return null;
  }
  if (bytes[1] !== 1 || (bytes[2] & ~3)) return null;
  return {
    valid: Boolean(bytes[2] & 1) && u16(5) !== 0,
    sequence: u16(3), mapId: u16(5), x: u16(7) / 65535, y: u16(9) / 65535,
    facing: (bytes[2] & 2) ? u16(11) / 65535 * Math.PI * 2 : null,
    clock: u16(13) * 65536 + u16(15), questLanes:bytes[17] <= 4 ? bytes[17] : 0, questSession:u16(18), artMode:bytes[20]===225, artEncoding:bytes[21],
  };
}

export function encodePacket({mapId = 1429, x = .5, y = .5, facing = 0, sequence = 1, clock = 1000, valid = true, questLanes = 0, questSession = 0, artMode = false, artEncoding = 1} = {}) {
  const bytes = [167, 1, valid ? (facing === null ? 1 : 3) : 0];
  const put = n => { n = Math.floor(n) & 65535; bytes.push(n >> 8, n & 255); };
  put(sequence); put(valid ? mapId : 0); put(Math.round(x * 65535)); put(Math.round(y * 65535));
  put(Math.round(((facing || 0) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) / (Math.PI * 2) * 65535));
  put(Math.floor(clock / 65536)); put(clock % 65536);
  bytes.push(questLanes, questSession>>8&255, questSession&255, artMode?225:0, artMode?artEncoding:0); bytes.push(...checksum(bytes));
  return bytes;
}

function luminance(image, x, y) {
  x = Math.floor(x); y = Math.floor(y);
  if (x < 0 || y < 0 || x >= image.width || y >= image.height) return 128;
  const i = (y * image.width + x) * 4;
  return (image.data[i] + image.data[i + 1] + image.data[i + 2]) / 3;
}

export function decodeAt(image, rect) {
  const {x, y, width, height} = rect;
  const sx = width / COLS, sy = height / ROWS;
  if (sx < 1 || sy < 1 || x < 0 || y < 0 || x + width > image.width + sx || y + height > image.height + sy) return null;
  const sample = (col, row) => {
    const value = luminance(image, x + (col + .5) * sx, y + (row + .5) * sy);
    return value > 170 ? 1 : value < 85 ? 0 : -1;
  };
  for (let i = 0; i < 48; i++) {
    if (sample(i + 1, 1) !== bit(HEADER, i) || sample(i + 1, 2) !== 1 - bit(HEADER, i)) return null;
  }
  const bytes = new Uint8Array(24);
  for (let i = 0; i < 192; i++) {
    const v = sample(i % 48 + 1, Math.floor(i / 48) + 3);
    if (v < 0) return null;
    bytes[i >> 3] |= v << (7 - (i & 7));
  }
  return decodeBytes(bytes);
}

// A damaged quest lane must not interrupt the position row or its siblings.
export function decodeBlock(image, rect) {
  const first=decodeAt(image,rect);
  if (!first) return [];
  const packets=[first];
  for(let lane=1;lane<=(first.questLanes||0);lane++) {
    const packet=decodeAt(image,{...rect,y:rect.y+rect.height*lane});
    if(packet?.type==='quest')packets.push(packet);
  }
  return packets;
}

// Search for the header's distinctive 11010011... run pattern, then require
// both full sync rows AND a packet checksum. Works anywhere in a shared display.
export function findStrip(image, art = null) {
  const runs = [];
  for (let i = 0; i < 48; i++) {
    if (i === 0 || bit(HEADER, i) !== bit(HEADER, i - 1)) runs.push(1);
    else runs[runs.length - 1]++;
  }
  for (let y = 1; y < image.height - 5; y++) {
    let x = 1;
    while (x < image.width - 50) {
      if (luminance(image, x, y) < 128 || luminance(image, x - 1, y) >= 128) { x++; continue; }
      const start = x;
      while (x < image.width && luminance(image, x, y) >= 128) x++;
      const cell = (x - start) / 2;
      if (cell < 1 || cell > 24) continue;
      let cursor = x, matches = true;
      for (let r = 1; r < runs.length; r++) {
        const runStart = cursor;
        while (cursor < image.width && (luminance(image, cursor, y) >= 128) === (r % 2 === 0) && cursor - runStart < runs[r] * cell + 3) cursor++;
        if (Math.abs(cursor - runStart - runs[r] * cell) > 2) { matches = false; break; }
      }
      if (!matches) continue;
      // Estimate cell width over the ENTIRE header so subpixel error does not
      // accumulate across 48 cells. Explore the remaining pixel-boundary error.
      const measured = (cursor - start) / 48;
      for (const delta of [0, -1/96, 1/96, -1/48, 1/48]) {
        const s = measured + delta;
        if (s < 1.4) continue;
        for (const dx of [0, -.5, .5]) for (const dy of [0, -.5, .5]) {
          const rect = {x: start - s + dx, y: y - 1.5 * s + dy, width: COLS * s, height: ROWS * s};
          const decodedArt = decodeArtAt(image,rect,art,decodeBytes,HEADER);
          if(decodedArt)return {rect,packet:decodedArt.packets[0],art:true};
          const packet = decodeAt(image, rect);
          if (packet) return {rect, packet};
        }
      }
    }
  }
  return null;
}

export function drawStrip(ctx, bytes, x, y, cell = 6) {
  ctx.fillStyle = '#000'; ctx.fillRect(x, y, COLS * cell, ROWS * cell);
  ctx.fillStyle = '#fff';
  for (let col = 0; col < 48; col++) {
    ctx.fillRect(x + (col + 1) * cell, y + (bit(HEADER, col) ? 1 : 2) * cell, cell, cell);
  }
  for (let i = 0; i < 192; i++) if (bit(bytes, i)) ctx.fillRect(x + (i % 48 + 1) * cell, y + (Math.floor(i / 48) + 3) * cell, cell, cell);
}

export class Freshness {
  constructor() { this.reset(); }
  reset() { this.key = null; this.changedAt = -Infinity; this.packet = null; }
  accept(packet, now) {
    const key = `${packet.clock}:${packet.sequence}`;
    if (key === this.key) return false;
    this.key = key; this.changedAt = now; this.packet = packet;
    return true;
  }
  isFresh(now) { return now - this.changedAt < 2500; }
}
