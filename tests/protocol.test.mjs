import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  HEADER, COLS, ROWS, encodePacket, decodeBytes, decodeAt, findStrip, Freshness,
  checksum, decodeBlock, bit,
} from '../dist/protocol.js';
import {QuestFeed} from '../dist/quests.js';

const QUESTIE_MOCK = `
local ns = {}
assert(loadfile('addon/AzerothLiveMap/Protocol.lua'))('AzerothLiveMap',ns)
assert(loadfile('addon/AzerothLiveMap/Questie.lua'))('AzerothLiveMap',ns)
local qm = {questIdFrames={}}
QuestieLoader={ImportModule=function(_,name) assert(name=='QuestieMap'); return qm end}
local function add(id, typ, x, y, extra)
  local name='QuestPin'..tostring(id)..'_'..tostring(x)..'_'..typ..'_'..tostring(extra and extra.miniMapIcon)
  local f={data={Type=typ, QuestData={name='|cffffffffQuête des loups|r'}, ObjectiveIndex=2,
    ObjectiveData=typ=='monster' and {Collected=3, Needed=8} or nil},
    x=x,y=y,UiMapID=1429,miniMapIcon=false,ShouldBeHidden=function() return false end}
  for k,v in pairs(extra or {}) do f[k]=v end
  _G[name]=f; qm.questIdFrames[id]=qm.questIdFrames[id] or {}; qm.questIdFrames[id][name]=name
  return f
end
local function emit(seq,mapID,now)
  print(table.concat(ns.QuestiePacket(mapID or 1429,.4,.6,seq,now or seq*.4),','))
end
`;
const readPackets = output => output.split('\n').map(row => {
  const bytes = row.split(',').map(Number), packet = decodeBytes(bytes);
  assert.ok(packet, `valid Lua auxiliary packet: ${row}`); return packet;
});

test('actual Questie bridge exports filtered world pins, progress, UTF-8 titles, and map coordinates', () => {
  const packets = readPackets(runLua(`${QUESTIE_MOCK}
    add(123,'monster',40,60)
    add(123,'monster',40,60,{miniMapIcon=true})
    add(124,'available',25,35)
    add(125,'complete',45,65)
    add(126,'monster',12,14,{ShouldBeHidden=function() return true end})
    add(127,'monster',12,15,{UiMapID=1944})
    add(128,'monster',12,16,{data={Type='monster',ObjectiveData={Completed=true}}})
    add(129,'manual',12,17)
    add(130,'monster',0/0,18)
    for i=1,120 do emit(i) end
    assert(qm.questIdFrames[126] and _G.QuestPin123_40_monster_nil.x==40,'Questie data is never modified')
  `, 'luajit'));
  const feed = new QuestFeed(); packets.forEach((p,i) => feed.accept(p,i*400));
  assert.equal(feed.zone(1429).count,3); assert.equal(feed.zone(1429).markers.size,3);
  const markers = feed.visible(1429,48000).sort((a,b)=>a.questId-b.questId);
  assert.deepEqual(markers.map(m => m.questId),[123,124,125]);
  assert.deepEqual(markers.map(m => m.markerKind),[2,1,3]);
  close(markers[0].x,.4); close(markers[0].y,.6);
  assert.equal(markers[0].collected,3); assert.equal(markers[0].needed,8);
  assert.equal(markers[0].title,'Quête des loups');
  assert.equal(feed.visible(1944,48000)[0].questId,127,'remote-zone pin is exported without visiting');
});

test('Questie snapshot replacement clears removed quests without flushing other zones', () => {
  const packets = readPackets(runLua(`${QUESTIE_MOCK}
    add(123,'monster',40,60)
    for i=1,40 do emit(i) end
    qm.questIdFrames={}
    for i=41,80 do emit(i) end
    for i=81,120 do emit(i,1944) end
  `, 'luajit'));
  const feed = new QuestFeed();
  for (const packet of packets.slice(0,40)) feed.accept(packet,1);
  assert.equal(feed.markers.size,1); const generation = feed.generation;
  for (const packet of packets.slice(40,80)) feed.accept(packet,2);
  assert.notEqual(feed.generation,generation); assert.equal(feed.count,0); assert.equal(feed.markers.size,0);
  for(const packet of packets.slice(80))feed.accept(packet,3); assert.equal(feed.zone(1429).count,0); assert.equal(feed.zone(1944).count,0);
});

test('Questie absence and incompatible internals send explicit status without breaking the stream', () => {
  for (const [setup,status] of [[`QuestieLoader=nil`,0],[`QuestieLoader.ImportModule=function() error('changed API') end`,2]]) {
    const packet = readPackets(runLua(`${QUESTIE_MOCK}${setup}; emit(1)`, 'luajit'))[0];
    assert.equal(packet.kind,3); assert.equal(packet.totalCount,0); assert.equal(packet.status,status);
  }
});

test('Questie exports every spawn and more than 96 markers without sampling', () => {
  const packets = readPackets(runLua(`${QUESTIE_MOCK}
    for i=1,20 do add(123,'monster',i,60) end
    for i=1,120 do add(1000+i,'available',i%100,35) end
    for i=1,1200 do emit(i) end
  `, 'luajit'));
  const feed = new QuestFeed(); packets.forEach(p => feed.accept(p,1));
  assert.equal(feed.count,140); assert.equal(feed.markers.size,140); assert.equal(feed.limited,false);
  assert.equal([...feed.markers.values()].filter(p=>p.questId===123).length,20);
});

test('v2 auxiliary packets survive optical detection and reject corruption and invalid bounds', () => {
  const bytes = runLua(`${QUESTIE_MOCK}print(table.concat(ns.EncodeQuest(0,1,1429,1,1,{1,0}),','))`, 'luajit').split(',').map(Number);
  const {image,rect} = fixture(bytes,{cell:2.4,antialias:true});
  assert.equal(decodeAt(image,rect).type,'quest'); assert.equal(findStrip(image).packet.count,1);
  for (let i=0;i<24;i++) { const bad=[...bytes]; bad[i]^=1; assert.equal(decodeBytes(bad),null); }
  for (const change of [b=>b[2]=9,b=>b[11]=3,b=>b[10]=97,b=>b[12]=2]) {
    const bad=[...bytes]; change(bad); bad.splice(22,2,...checksum(bad.slice(0,22))); assert.equal(decodeBytes(bad),null);
  }
});

test('Questie feed tolerates lost metadata, reordered titles, frozen blocks, and generation replacement', () => {
  const packets=readPackets(runLua(`${QUESTIE_MOCK}add(123,'monster',40,60); for i=1,40 do emit(i) end`,'luajit'));
  const feed=new QuestFeed(),global=packets.find(p=>p.kind===3),meta=packets.find(p=>p.kind===0),marker=packets.find(p=>p.kind===1);
  const labels=packets.filter(p=>p.kind===2).slice(0,2);
  assert.equal(feed.accept(marker,0),false,'wait for zone metadata');
  feed.accept(global,1);feed.accept(meta,2);
  labels.reverse().forEach((p,i)=>feed.accept(p,10+i));feed.accept(marker,20);
  assert.equal(feed.visible(1429,21)[0].title,'Quête des loups');
  for(let time=100;time<6500;time+=100)for(const p of [global,meta,marker,...labels])assert.equal(feed.accept(p,time),false,'frozen multi-lane block cannot refresh');
  assert.equal(feed.isFresh(6500),false);assert.deepEqual(feed.visible(1429,6500),[]);
  feed.accept({...meta,sequence:300,generation:meta.generation+1,count:0,index:0},7000);
  assert.equal(feed.zone(1429).markers.size,0);
  assert.equal(feed.accept({...marker,sequence:301},7001),false,'old generation ignored');
  assert.equal(feed.accept({...meta,sequence:302},7002),false,'old metadata cannot roll back generation');
  feed.reset();assert.equal(feed.status,null);assert.equal(feed.isFresh(7002),false);
});

test('real addon emits four quest packets per position update and supports compact mode', () => {
  const output=runLua(`${ADDON_MOCK}
    boot(nil,true)
    local function dump(f)
      local bits={}
      for j=98,#f.textures do bits[#bits+1]=f.textures[j].value end
      originalPrint(table.concat(bits,''))
    end
    for i=1,10 do
      now=10+i*.1; strip.scripts.OnUpdate(strip,.1); dump(strip)
      for _,child in ipairs(strip.children) do if child.kind=='Frame' and #child.textures==289 and child:IsShown() then dump(child) end end
    end
    assert(strip.width==100 and strip.height==80)
    command('unlock');dragTo(1900,1060);assertPosition(1820,1000)
    command('sync compact');assert(strip.height==16)
    assert(AzerothLiveMapDB.fastSync==false)
    command('sync fast');assert(strip.height==80)
    command('lock');assert(not strip:IsMouseEnabled())
  `,'luajit');
  const packets=output.split('\n').map(row=>decodeBytes(row.match(/.{8}/g).map(bits=>parseInt(bits,2))));
  assert.ok(packets.every(Boolean));assert.equal(packets.length,50);
  assert.equal(packets.filter(p=>p.type==='quest').length,40,'40 quest packets in one simulated second');
  const positions=packets.filter(p=>p.type!=='quest');assert.equal(positions.length,10);
  positions.forEach(p=>{assert.equal(p.questLanes,4);assert.equal(p.valid,true);close(p.x,.2345);});
  assert.ok(positions.at(-1).clock>positions[0].clock);
});

test('all-zone snapshots finish with 300 pins and shared titles at the fast-strip packet rate', t => {
  const packets=readPackets(runLua(`${QUESTIE_MOCK}
    for zone=1,3 do
      for quest=1,20 do
        for spawn=1,5 do add(1000+quest,'monster',zone*20+spawn,30+quest,{UiMapID=({1429,1944,1946})[zone]}) end
      end
    end
    for i=1,1600 do emit(i,1429,i/40) end
  `,'luajit'));
  const feed=new QuestFeed();let complete=null;
  for(let i=0;i<packets.length;i++){
    feed.accept(packets[i],i*25);
    const progress=feed.progress(i*25);
    if(progress.received===300 && progress.named===300){complete=i/40;break;}
  }
  assert.ok(complete!==null && complete<16,`all 300 pins/titles should arrive within 16 simulated seconds; got ${complete}`);
  for(const id of [1429,1944,1946])assert.equal(feed.visible(id,complete*1000).length,100);
  assert.equal(feed.titles.size,20,'one shared name per quest across three zones');
  t.diagnostic(`300 pins in three zones, including all names: ${complete.toFixed(2)} simulated seconds at 40 packets/s`);
  const lossy=new QuestFeed();
  packets.forEach((packet,i)=>{if(i%5!==0)lossy.accept(packet,i*25);});
  assert.equal(lossy.progress(40000).received,300,'repeats repair 20% deterministic frame loss');
});

test('progress changes do not starve late pins; a removed remote zone clears without resetting siblings',()=>{
  const packets=readPackets(runLua(`${QUESTIE_MOCK}
    local pin=add(123,'monster',40,60)
    for i=1,250 do add(1000+i,'available',i%100,35,{UiMapID=1944}) end
    for i=1,800 do
      pin.data.ObjectiveData.Collected=math.floor(i/80)%8
      if i==600 then qm.questIdFrames[123]=nil end
      emit(i,1429,i/40)
    end
  `,'luajit'));
  const feed=new QuestFeed();const seen=new Set();
  for(let i=0;i<packets.length;i++){
    feed.accept(packets[i],i*25);
    if(packets[i].kind===1 && packets[i].mapId===1944)seen.add(packets[i].questId);
  }
  assert.equal(seen.size,250);assert.equal(feed.zone(1944).markers.size,250);
  assert.equal(feed.visible(1429,20000).length,0,'removed zone uses an empty replacement snapshot');
  assert.equal(feed.visible(1944,20000).length,250,'remote zone remains usable');
});

test('a new addon session clears old character zones even when its sequence restarts',()=>{
  const packets=readPackets(runLua(`${QUESTIE_MOCK}add(123,'monster',40,60); for i=1,40 do emit(i) end`,'luajit'));
  const feed=new QuestFeed();packets.forEach((p,i)=>feed.accept(p,i*25));assert.equal(feed.zone(1429).markers.size,1);
  const global=packets.find(p=>p.kind===3);
  assert.equal(feed.accept({...global,generation:global.generation+1,totalCount:0,zoneCount:0},2000),true);
  assert.equal(feed.zones.size,0);assert.equal(feed.titles.size,0);
});

test('parallel optical lanes survive fractional scaling and isolate a corrupt quest row',()=>{
  const rows=runLua(`${QUESTIE_MOCK}
    print(table.concat(ns.Encode(1429,.4,.6,0,1,1000,4,12),','))
    for i=2,5 do print(table.concat(ns.QuestiePacket(1429,.4,.6,i,1),',')) end
  `,'luajit').split('\n').map(row=>row.split(',').map(Number));
  for(const cell of [2,2.4,4.8]){
    const fixtures=rows.map(bytes=>fixture(bytes,{cell,x:0,y:0,width:Math.ceil(COLS*cell),height:Math.ceil(ROWS*cell),margin:0,antialias:true}));
    // Rasterize each lane independently, including its antialiased border.
    const width=fixtures[0].image.width,laneHeight=fixtures[0].image.height;
    const data=new Uint8ClampedArray(width*laneHeight*5*4);
    fixtures.forEach((f,i)=>data.set(f.image.data,i*width*laneHeight*4));
    const image={data,width,height:laneHeight*5};
    // Whole-pixel row offsets are representative of capture scaling, while
    // width retains subpixel cell spacing for decoding each individual lane.
    const rect={x:0,y:0,width:COLS*cell,height:laneHeight};
    assert.equal(decodeBlock(image,rect).length,5);
    data.fill(128,width*laneHeight*2*4,width*laneHeight*3*4);
    const decoded=decodeBlock(image,rect);
    assert.equal(decoded.length,4);assert.equal(decoded[0].questLanes,4);
  }
});

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

// Independent NV12-style 4:2:0 round-trip. Screen capture often keeps a luma
// sample per pixel but shares each chroma sample across a 2×2 pixel block.
function subsample420(image, kr=.299, kb=.114){
  const kg=1-kr-kb,data=new Uint8ClampedArray(image.data),{width,height}=image;
  for(let y=0;y<height;y+=2)for(let x=0;x<width;x+=2){
    const pixels=[];let cb=0,cr=0;
    for(let dy=0;dy<2&&y+dy<height;dy++)for(let dx=0;dx<2&&x+dx<width;dx++){
      const index=((y+dy)*width+x+dx)*4,r=image.data[index],g=image.data[index+1],b=image.data[index+2],luma=kr*r+kg*g+kb*b;
      pixels.push({index,luma});cb+=(b-luma)/(2*(1-kb));cr+=(r-luma)/(2*(1-kr));
    }
    cb=(Math.round(128+224/255*cb/pixels.length)-128)*255/224;
    cr=(Math.round(128+224/255*cr/pixels.length)-128)*255/224;
    for(const {index,luma} of pixels){
      const yy=(Math.round(16+219/255*luma)-16)*255/219;
      const r=yy+2*(1-kr)*cr,b=yy+2*(1-kb)*cb,g=(yy-kr*r-kb*b)/kg;
      data[index]=Math.round(r);data[index+1]=Math.round(g);data[index+2]=Math.round(b);
    }
  }
  return {...image,data};
}

// Independently rasterize the wire format, including antialiasing at cell edges.
// This intentionally does not use production drawStrip or its bit helper.
function fixture(bytes, {cell = 6, x = 31, y = 29, width = 440, height = 160, white = 255, black = 0, antialias = false, margin = 20} = {}) {
  width = Math.max(width, Math.ceil(x + COLS * cell + margin));
  height = Math.max(height, Math.ceil(y + ROWS * cell + margin));
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

test('the tiny 100×16 strip is detected at screen edges and deterministic arbitrary positions', () => {
  const bytes = luaPacket({mapId: 1429, x: .4152, y: .7631, sequence: 456});
  const positions = [[0,0], [540,0], [0,344], [540,344], [1,1], [539,343]];
  let seed = 1701;
  for (let i = 0; i < 12; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const x = seed % 541;
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    positions.push([x, seed % 345]);
  }
  for (const [x, y] of positions) {
    const {image, rect} = fixture(bytes, {cell: 2, x, y, width: 640, height: 360, margin: 0});
    assert.equal(decodeAt(image, rect)?.sequence, 456, `manual decode at (${x},${y})`);
    assert.equal(findStrip(image)?.packet.sequence, 456, `auto-detection at (${x},${y})`);
  }
  const {image} = fixture(bytes, {cell:2, x:0, y:0, width:100, height:16, margin:0});
  assert.equal(findStrip(image)?.packet.sequence, 456, 'tight capture of the entire strip');
});

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

const ADDON_MOCK = `
  local now, px, py = 10, .2345, .6789
  local screenWidth, screenHeight, uiScale = 1920, 1080, .8
  local frames, strip, handle = {}, nil, nil
  local originalPrint = print; print = function() end
  local function near(actual, expected, label)
    assert(type(actual) == 'number' and math.abs(actual - expected) < .001,
      (label or 'number') .. ': got ' .. tostring(actual) .. ', expected ' .. tostring(expected))
  end
  local Object = {}; Object.__index = Object
  local function object(parent, name, kind)
    local o = setmetatable({parent=parent, name=name, kind=kind, scripts={}, textures={}, children={}, strings={}, visible=true, width=0, height=0, scale=1}, Object)
    if parent and parent.children then table.insert(parent.children, o) end
    if name then frames[name] = o end
    return o
  end
  UIParent = object(nil, 'UIParent', 'root')
  function UIParent:GetEffectiveScale() return uiScale end
  function UIParent:GetWidth() return screenWidth / uiScale end
  function UIParent:GetHeight() return screenHeight / uiScale end
  function UIParent:GetPhysicalRect() return 0, 0, screenWidth, screenHeight end
  function GetPhysicalScreenSize() return screenWidth, screenHeight end
  function GetScreenWidth() return screenWidth / uiScale end
  function GetScreenHeight() return screenHeight / uiScale end
  function GetTime() return now end
  function GetPlayerFacing() return math.pi end
  C_Map = {
    GetBestMapForUnit=function() return 1944 end,
    GetPlayerMapPosition=function() return {GetXY=function() return px, py end} end,
  }
  function Object:GetEffectiveScale() return self.scale * (self.parent and self.parent:GetEffectiveScale() or 1) end
  function Object:SetScale(value) self.scale=value end
  function Object:GetScale() return self.scale end
  function Object:SetSize(w,h) self.width,self.height=w,h end
  function Object:SetWidth(w) self.width=w end
  function Object:SetHeight(h) self.height=h end
  function Object:GetWidth() return self.width end
  function Object:GetHeight() return self.height end
  function Object:GetName() return self.name end
  function Object:GetParent() return self.parent end
  function Object:SetFrameStrata(value) self.strata=value end
  function Object:SetFrameLevel(value) self.level=value end
  function Object:GetFrameLevel() return self.level or 1 end
  function Object:EnableMouse(value) self.mouse=value end
  function Object:IsMouseEnabled() return self.mouse == true end
  function Object:SetMovable(value) self.movable=value end
  function Object:SetDontSavePosition(value) self.dontSavePosition=value end
  function Object:SetClampedToScreen(value) self.clamped=value end
  function Object:SetClampRectInsets(...) self.insets={...} end
  function Object:RegisterForDrag(...) self.dragButtons={...} end
  function Object:SetScript(kind,fn) self.scripts[kind]=fn end
  function Object:HookScript(kind,fn)
    local old=self.scripts[kind]
    self.scripts[kind]=function(...) if old then old(...) end; fn(...) end
  end
  function Object:RegisterEvent(event) self.events=self.events or {}; self.events[event]=true end
  function Object:SetShown(value) self.visible=value == true end
  function Object:Show() self:SetShown(true) end
  function Object:Hide() self:SetShown(false) end
  function Object:IsShown() return self.visible end
  function Object:IsVisible() return self.visible and (not self.parent or self.parent:IsVisible()) end
  function Object:SetAlpha(value) self.alpha=value end
  function Object:SetText(value) self.text=value end
  function Object:SetTextColor(...) self.textColor={...} end
  function Object:SetJustifyH(value) self.justify=value end
  function Object:SetAllPoints(relative) self.allPoints=relative or self.parent end
  function Object:ClearAllPoints() self.point=nil; self.allPoints=nil; self.dragLeft=nil; self.dragTop=nil end
  function Object:SetPoint(point, relative, relativePoint, x, y)
    if type(relative)=='number' then x,y=relative,relativePoint; relative,relativePoint=self.parent,point end
    self.point={point,relative or self.parent,relativePoint or point,x or 0,y or 0}
  end
  function Object:GetPoint() return unpack(self.point or {}) end
  local anchors={TOPLEFT={0,1},TOP={.5,1},TOPRIGHT={1,1},LEFT={0,.5},CENTER={.5,.5},RIGHT={1,.5},BOTTOMLEFT={0,0},BOTTOM={.5,0},BOTTOMRIGHT={1,0}}
  function Object:GetPhysicalRect()
    if self.allPoints then return self.allPoints:GetPhysicalRect() end
    local scale=self:GetEffectiveScale()
    if self.dragLeft then return self.dragLeft*scale,self.dragTop*scale-self.height*scale,self.width*scale,self.height*scale end
    local p=self.point or {'BOTTOMLEFT',self.parent or UIParent,'BOTTOMLEFT',0,0}
    local rx,ry,rw,rh=p[2]:GetPhysicalRect()
    local a,b=anchors[p[1]],anchors[p[3]]
    return rx+rw*b[1]+p[4]*scale-self.width*scale*a[1],ry+rh*b[2]+p[5]*scale-self.height*scale*a[2],self.width*scale,self.height*scale
  end
  function Object:GetLeft() local x=self:GetPhysicalRect(); return x/self:GetEffectiveScale() end
  function Object:GetTop() local _,y,_,h=self:GetPhysicalRect(); return (y+h)/self:GetEffectiveScale() end
  function Object:GetRight() local x,_,w=self:GetPhysicalRect(); return (x+w)/self:GetEffectiveScale() end
  function Object:GetBottom() local _,y=self:GetPhysicalRect(); return y/self:GetEffectiveScale() end
  function Object:StartMoving() assert(self.movable, 'dragged frame must be movable'); self.moving=true; self.moveCount=(self.moveCount or 0)+1 end
  function Object:StopMovingOrSizing() self.moving=false end
  function Object:SetUserPlaced(value) self.userPlaced=value end
  function Object:SetColorTexture(r,g,b,a) self.value=r; self.color={r,g,b,a} end
  function Object:SetTexture(path,...) self.texture=path end
  function Object:SetTexCoord(...) self.texCoord={...} end
  function Object:CreateTexture(_,layer)
    local texture=object(self,nil,'texture'); texture.layer=layer; table.insert(self.textures,texture); return texture
  end
  function Object:CreateFontString(name,layer,template)
    local text=object(self,name,'font'); text.layer,text.template=layer,template; table.insert(self.strings,text); return text
  end
  function CreateFrame(kind,name,parent) return object(parent or UIParent,name,kind) end
  SlashCmdList={}
  local function boot(saved, withQuestie, withArt)
    AzerothLiveMapDB=saved; frames={}
    local ns={}
    assert(loadfile('addon/AzerothLiveMap/Protocol.lua'))('AzerothLiveMap',ns)
    if withQuestie then assert(loadfile('addon/AzerothLiveMap/Questie.lua'))('AzerothLiveMap',ns) end
    if withArt then
      assert(loadfile('addon/AzerothLiveMap/Elephant.lua'))('AzerothLiveMap',ns)
      assert(loadfile('addon/AzerothLiveMap/Art.lua'))('AzerothLiveMap',ns)
    end
    assert(loadfile('addon/AzerothLiveMap/Main.lua'))('AzerothLiveMap',ns)
    strip=assert(frames.AzerothLiveMapStrip,'named strip frame missing')
    strip.scripts.OnEvent(strip,'PLAYER_LOGIN')
    handle=nil
    for _,candidate in pairs(frames) do if candidate~=strip and candidate.scripts.OnDragStart then handle=candidate end end
    if not handle then for _,candidate in ipairs(strip.children) do if candidate.scripts.OnDragStart then handle=candidate end end end
  end
  local function command(text) SlashCmdList.AZEROTHLIVEMAP(text) end
  local function event(name) strip.scripts.OnEvent(strip,name) end
  local function physicalPosition()
    return strip:GetLeft()*strip:GetEffectiveScale(),screenHeight-strip:GetTop()*strip:GetEffectiveScale()
  end
  local function assertPosition(x,y)
    local actualX,actualY=physicalPosition(); near(actualX,x,'physical x'); near(actualY,y,'physical y')
  end
  local function dragTo(x,y)
    assert(handle,'drag handle missing')
    handle.scripts.OnDragStart(handle)
    assert(strip.moving,'unlocked handle should move the strip')
    strip.dragLeft=x/strip:GetEffectiveScale(); strip.dragTop=(screenHeight-y)/strip:GetEffectiveScale()
    handle.scripts.OnDragStop(handle)
    assert(not strip.moving,'drag stop should stop movement')
  end
`;

test('animated elephant renders and decodes five actual Lua packets in every animation frame',async()=>{
  const {readFileSync}=await import('node:fs');
  const {decodeArtAt}=await import('../dist/art.js');
  const art=JSON.parse(readFileSync(new URL('../dist/elephant-art.json',import.meta.url)));
  const rows=runLua(`${ADDON_MOCK}
    boot(nil,true,true)
    assert(strip.width==100 and strip.height==136,'full mascot must fit its frame')
    assert(frames.AzerothLiveMapArt:IsShown() and frames.AzerothLiveMapLocator:IsShown())
    for _,tick in ipairs({0,12,15,17,18,21,23,26}) do
      now=(tick+.01)/10;strip.scripts.OnUpdate(strip,.1)
      local a=frames.AzerothLiveMapArt
      local index=math.floor(a.textures[1].texCoord[1]*8+.5)
      local colors={}
      for i=2,#a.textures do for channel=1,3 do colors[#colors+1]=math.floor(a.textures[i].color[channel]*255+.5) end end
      originalPrint(index..';'..table.concat(colors,','))
    end
    command('unlock');dragTo(1910,1070);assertPosition(1820,944)
    command('lock');assert(not strip:IsMouseEnabled(),'art must remain click-through')
    command('art off');assert(strip.height==80 and not frames.AzerothLiveMapArt:IsShown())
    command('art on');assert(strip.height==136)
    command('sync compact');assert(strip.height==136)
    command('hide');assert(not strip:IsShown())
    boot(AzerothLiveMapDB,true,true);assert(AzerothLiveMapDB.art and not AzerothLiveMapDB.fastSync)
  `,'luajit').split('\n');
  assert.equal(rows.length,8);
  for(const [expectedFrame,row] of rows.entries()){
    const [frameText,colorText]=row.split(';'),frame=Number(frameText),rgb=colorText.split(',').map(Number);
    assert.equal(frame,expectedFrame);assert.equal(rgb.length,960*3);
    const carrier=new Map(art.positions.map((position,i)=>[position,rgb.slice(i*3,i*3+3)]));
    for(const cell of [2,2.4,3.6]){
      const left=31,top=29,width=Math.ceil(left+50*cell+20),height=Math.ceil(top+68*cell+20);
      const data=new Uint8ClampedArray(width*height*4);
      for(let y=0;y<height;y++)for(let x=0;x<width;x++){
        let color=[57,76,64];
        const gx=Math.floor((x+.5-left)/cell),gy=Math.floor((y+.5-top)/cell);
        if(gx>=0&&gx<50&&gy>=0&&gy<68){
          if(gy<64){
            const position=gy*50+gx,base=art.palette[art.frames[frame][position]];
            if(base[3])color=carrier.get(position)??base.slice(0,3);
          }else{
            const fy=gy-64,white=gx>0&&gx<49&&((fy===1&&bit(HEADER,gx-1))||(fy===2&&!bit(HEADER,gx-1)));
            color=white?[255,255,255]:[0,0,0];
          }
        }
        const index=(y*width+x)*4;data.set([...color,255],index);
      }
      const image={data,width,height},rect={x:left,y:top+64*cell,width:50*cell,height:8*cell};
      const decoded=decodeArtAt(image,rect,art,decodeBytes,HEADER);
      assert.equal(decoded?.frame,frame,`frame ${frame} at ${cell}px`);
      assert.equal(decoded.packets.length,5);assert.equal(decoded.packets[0].artMode,true);
      assert.equal(decoded.packets[0].artEncoding,1);
      assert.equal(decoded.packets[0].mapId,1944);close(decoded.packets[0].x,.2345);
      const found=findStrip(image,art);assert.equal(found?.art,true,`auto-discovery frame ${frame}, ${cell}px`);
      for(const [name,kr,kb] of [['BT.601',.299,.114],['BT.709',.2126,.0722]]){
        const video=subsample420(image,kr,kb),received=decodeArtAt(video,rect,art,decodeBytes,HEADER);
        assert.equal(received?.packets.length,5,`${name} 4:2:0 frame ${frame} at ${cell}px`);
        assert.equal(received.packets[0].mapId,1944);close(received.packets[0].x,.2345);
        assert.equal(findStrip(video,art)?.packet.mapId,1944,`${name} auto-discovery`);
      }
      if(frame===0&&cell===2){
        for(const gamma of [.9,1.1]){
          const adjusted={...image,data:new Uint8ClampedArray(data)};
          for(let i=0;i<adjusted.data.length;i++)if(i%4!==3)adjusted.data[i]=Math.round(255*(adjusted.data[i]/255)**gamma);
          assert.equal(decodeArtAt(adjusted,rect,art,decodeBytes,HEADER)?.packets.length,5,`gamma ${gamma}`);
        }
        const damaged={...image,data:new Uint8ClampedArray(data)},position=art.positions[384];
        const px=left+(position%50)*cell,py=top+Math.floor(position/50)*cell;
        const base=art.palette[art.frames[frame][position]].slice(0,3).map(value=>Math.max(48,Math.min(207,value)));
        const opposite=base.map((value,i)=>2*value-carrier.get(position)[i]);
        for(let yy=py;yy<py+cell;yy++)for(let xx=px;xx<px+cell;xx++)damaged.data.set(opposite,(yy*width+xx)*4);
        const repaired=decodeArtAt(damaged,rect,art,decodeBytes,HEADER);
        assert.equal(repaired?.packets.length,4,'one damaged quest packet leaves position and siblings readable');
      }
    }
  }
});

test('actual tiny addon login and timer render a readable position; unavailable (0,0) clears validity', () => {
  const output = runLua(`${ADDON_MOCK}
    boot(nil)
    local function snapshot()
      local bits = {}
      for i = 2, #strip.textures do bits[#bits + 1] = strip.textures[i].value end
      originalPrint(table.concat(bits, ''))
    end
    assert(strip.width == 100 and strip.height == 16 and strip.visible)
    near(strip:GetEffectiveScale(),1,'physical scale')
    assertPosition(12,12)
    snapshot()
    now = 10.2; px, py = 0, 0
    strip.scripts.OnUpdate(strip, .2); snapshot()
    command('hide'); assert(not strip.visible)
    command('size 10'); assert(strip.width == 500)
    command('show'); assert(strip.visible)
  `, 'luajit');
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

test('minimap commands persist hiding across reload and restore the game UI without affecting the bridge',()=>{
  runLua(`${ADDON_MOCK}
    MinimapCluster=object(UIParent,nil,'Frame')
    local calls=0
    function MinimapCluster:SetShown(value) calls=calls+1; self.visible=value end
    boot(nil,true,true)
    assert(calls==0 and MinimapCluster:IsShown(),'default installation leaves the minimap alone')
    command('minimap hide')
    assert(not MinimapCluster:IsShown() and AzerothLiveMapDB.hideMinimap==true)
    assert(strip:IsShown() and frames.AzerothLiveMapArt:IsShown(),'minimap hiding must not hide the position/quest bridge')
    local saved=AzerothLiveMapDB
    MinimapCluster:Show();boot(saved,true,true)
    assert(not MinimapCluster:IsShown(),'saved hidden preference survives reload')
    command('minimap show')
    assert(MinimapCluster:IsShown() and AzerothLiveMapDB.hideMinimap==false)
    local previous=calls
    MinimapCluster.visible=false;boot(AzerothLiveMapDB,true,true)
    assert(calls==previous and not MinimapCluster:IsShown(),'a disabled hide preference must not override other minimap customization')
    command('minimap show');assert(MinimapCluster:IsShown())
    MinimapCluster=nil;command('minimap hide')
    assert(strip:IsShown(),'missing minimap frame must not break tracking')
  `,'luajit');
});

test('minimap changes wait for combat to end and apply the latest requested state',()=>{
  runLua(`${ADDON_MOCK}
    local combat=false
    InCombatLockdown=function()return combat end
    MinimapCluster=object(UIParent,nil,'Frame')
    local calls=0
    function MinimapCluster:SetShown(value) calls=calls+1; self.visible=value end
    boot(nil)
    combat=true;command('minimap hide')
    assert(MinimapCluster:IsShown() and calls==0,'never change protected UI in combat')
    combat=false;event('PLAYER_REGEN_ENABLED')
    assert(not MinimapCluster:IsShown() and calls==1)
    combat=true;command('minimap hide');command('minimap show')
    assert(not MinimapCluster:IsShown() and calls==1)
    combat=false;event('PLAYER_REGEN_ENABLED')
    assert(MinimapCluster:IsShown() and calls==2 and not AzerothLiveMapDB.hideMinimap)
    event('PLAYER_REGEN_ENABLED');assert(calls==2,'completed changes do not repeat')
  `,'luajit');
});

test('a saved custom size and physical position survive login and UI scale changes', () => {
  runLua(`${ADDON_MOCK}
    boot({size=8,x=327,y=219,enabled=true,locked=false})
    assert(strip.dontSavePosition==true,'WoW layout cache must not compete with saved physical offsets')
    near(strip.width*strip:GetEffectiveScale(),400,'saved width')
    near(strip.height*strip:GetEffectiveScale(),64,'saved height')
    assertPosition(327,219)
    assert(not strip:IsMouseEnabled(),'strip must be click-through at login')
    assert(handle and not handle:IsShown(),'login must lock a previously unlocked handle')
    uiScale=.55; event('UI_SCALE_CHANGED')
    near(strip:GetEffectiveScale(),1,'scale-independent pixels')
    near(strip.width*strip:GetEffectiveScale(),400,'same physical width')
    assertPosition(327,219)
    uiScale=1.25; event('UI_SCALE_CHANGED')
    assertPosition(327,219)
    command('unlock'); handle.scripts.OnDragStart(handle)
    strip.dragLeft=900; strip.dragTop=500
    uiScale=.7; event('UI_SCALE_CHANGED')
    assert(not strip.moving,'a scale change must cancel an active drag')
    assertPosition(327,219)
  `, 'luajit');
});

test('unlock exposes a separate handle; dragging persists and locking restores click-through', () => {
  runLua(`${ADDON_MOCK}
    boot(nil)
    assert(handle,'movable addon needs a drag handle')
    assert(not handle:IsShown(),'handle hidden while locked')
    handle.scripts.OnDragStart(handle)
    assert(not strip.moving,'a locked strip cannot start dragging')
    command('unlock')
    assert(handle:IsShown() and handle:IsMouseEnabled(),'unlock must expose a usable handle')
    local x,y,w,h=strip:GetPhysicalRect()
    local hx,hy,hw,hh=handle:GetPhysicalRect()
    assert(hw>=100 and hh>=16,'handle must provide a practical drag target')
    assert(hx+hw<=x or hx>=x+w or hy+hh<=y or hy>=y+h,'handle must not cover encoded cells')
    assert(#strip.strings==0,'label must not be drawn over the encoded strip')
    dragTo(701,333)
    assertPosition(701,333)
    near(AzerothLiveMapDB.x,701,'saved x'); near(AzerothLiveMapDB.y,333,'saved y')
    command('lock')
    assert(not handle:IsShown() and not strip:IsMouseEnabled(),'locked addon must be unobtrusive and click-through')
    handle.scripts.OnDragStart(handle)
    assert(not strip.moving,'locking must disable subsequent drags')
    local saved=AzerothLiveMapDB
    boot(saved)
    assertPosition(701,333)
    assert(not handle:IsShown(),'reload must never restore an unlocked handle')
  `, 'luajit');
});

test('dragged and saved positions clamp to the current physical screen after resizing', () => {
  runLua(`${ADDON_MOCK}
    boot({size=2,x=99999,y=-500,enabled=true})
    assertPosition(1820,0)
    command('unlock'); dragTo(-100,99999)
    assertPosition(0,1064)
    local hx,hy,hw,hh=handle:GetPhysicalRect()
    assert(hx>=0 and hy>=0 and hx+hw<=screenWidth and hy+hh<=screenHeight,'handle must remain accessible at the bottom edge')
    command('size 12')
    assertPosition(0,984)
    screenWidth,screenHeight=640,360; event('DISPLAY_SIZE_CHANGED')
    assertPosition(0,264)
    dragTo(99999,99999)
    assertPosition(40,264)
    hx,hy,hw,hh=handle:GetPhysicalRect()
    assert(hx>=0 and hy>=0 and hx+hw<=screenWidth and hy+hh<=screenHeight,'handle must remain accessible after display resize')
    near(AzerothLiveMapDB.x,40,'clamped saved x'); near(AzerothLiveMapDB.y,264,'clamped saved y')
    command('lock'); uiScale=.65; event('UI_SCALE_CHANGED')
    assertPosition(40,264)
  `, 'luajit');
});

test('reset returns the small visible strip to its default corner and locks it', () => {
  runLua(`${ADDON_MOCK}
    boot({size=9,x=600,y=400,enabled=false})
    assert(not strip:IsShown(),'saved hidden preference should survive login')
    command('show'); command('unlock'); command('size 12'); dragTo(800,500)
    command('reset')
    assert(strip:IsShown(),'reset must show the strip')
    near(strip.width,100,'reset width'); near(strip.height,16,'reset height')
    assertPosition(12,12)
    assert(not strip:IsMouseEnabled() and not handle:IsShown(),'reset must lock')
    assert(AzerothLiveMapDB.enabled==true and AzerothLiveMapDB.size==2)
    near(AzerothLiveMapDB.x,12); near(AzerothLiveMapDB.y,12)
  `, 'luajit');
});

test('malformed saved state cannot create NaN geometry or a permanently unreachable strip', () => {
  runLua(`${ADDON_MOCK}
    for _,saved in ipairs({
      'corrupt', false, 37,
      {size=0/0,x=math.huge,y=-math.huge,enabled='invalid'},
      {size='not a number',x={},y='bad'},
      {size=math.huge,x=0/0,y=0/0},
    }) do
      boot(saved)
      assert(type(AzerothLiveMapDB)=='table','saved state repaired to table')
      local x,y=physicalPosition()
      assert(x==x and y==y and strip.width==strip.width and strip.height==strip.height,'finite geometry')
      assert(x>=0 and y>=0 and x+strip.width<=screenWidth and y+strip.height<=screenHeight,'on-screen geometry')
      assert(AzerothLiveMapDB.size>=2 and AzerothLiveMapDB.size<=12,'bounded cell size')
      assert(not handle:IsShown(),'corrupt state cannot unlock the handle')
    end
    boot(nil)
    command('size 1'); assert(AzerothLiveMapDB.size==2,'minimum cell size')
    command('size 99'); assert(AzerothLiveMapDB.size==12,'maximum cell size')
    command('size 3.9'); assert(AzerothLiveMapDB.size==3,'whole physical pixels')
    local width=strip.width
    command('size nope'); command('size 1e999')
    assert(strip.width==strip.width and strip.width>=100 and strip.width<=600,'invalid commands remain finite and bounded')
  `, 'luajit');
});
