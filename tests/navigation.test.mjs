import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {buildMapCatalog, mapViewport, mapPoint, hitTestMap} from '../dist/navigation.js';

const zones=JSON.parse(readFileSync(new URL('../dist/maps.json',import.meta.url)));
const maps=buildMapCatalog(zones), byId=new Map(maps.map(map=>[map.uiMapId,map]));
const children=id=>maps.filter(map=>map.parentId===id);
const native={x:0,y:0,w:1024,h:683};
const hit=(id,x,y)=>hitTestMap(children(id),x,y,native)?.uiMapId;

test('every supported map has an acyclic route back to Worlds',()=>{
  assert.equal(maps.length,zones.length+5);
  assert.equal(byId.size,maps.length);
  for(const entry of maps){
    const seen=new Set();let map=entry;
    while(map.parentId!==null){
      assert.ok(!seen.has(map.uiMapId),`cycle from ${entry.name}`);seen.add(map.uiMapId);
      map=byId.get(map.parentId);assert.ok(map,`missing parent for ${entry.name}`);
    }
    assert.equal(map.uiMapId,946);
    if(entry.kind==='zone')assert.ok(entry.polygon,`missing navigation region for ${entry.name}`);
    if(entry.kind==='city')assert.ok(entry.entrance,`missing entrance for ${entry.name}`);
  }
});

test('geographic selections open the expected continent and zone; oceans stay inert',()=>{
  for(const [parent,x,y,id] of [
    [946,300,230,1945],[946,780,440,947],
    [947,230,400,1414],[947,790,400,1415],
    [1415,455,520,1429],[1415,570,115,1941],[1415,538,316,1417],
    [1414,595,340,1411],[1414,477,425,1412],[1414,440,595,1451],
    [1945,570,357,1944],[1945,330,460,1951],[1945,590,155,1953],
  ])assert.equal(hit(parent,x,y),id,`map ${parent} at ${x},${y}`);
  for(const parent of [946,947,1414,1415,1945])assert.equal(hit(parent,30,400),undefined);
  assert.equal(hit(1415,15,15),undefined);
});

test('panning, zooming, and letterboxing preserve area hit tests',()=>{
  for(const [w,h,zoom,pan] of [[1100,650,1,{x:0,y:0}],[390,390,1,{x:0,y:0}],[950,700,2.5,{x:83,y:-45}]]){
    const viewport=mapViewport(w,h,1024,683,zoom,pan);
    const x=viewport.x+455/1024*viewport.w,y=viewport.y+520/683*viewport.h;
    assert.equal(hitTestMap(children(1415),x,y,viewport)?.uiMapId,1429);
    assert.equal(mapPoint(viewport.x-1,viewport.y,viewport),null);
    assert.equal(hitTestMap(children(1415),viewport.x+viewport.w+1,y,viewport),null);
  }
  assert.equal(mapPoint(0,0,null),null);
});

test('city entrances are selectable with a consistent screen-sized target',()=>{
  const viewport=mapViewport(390,390,1024,683);
  const city=byId.get(1453),x=viewport.x+city.entrance.x*viewport.w,y=viewport.y+city.entrance.y*viewport.h;
  assert.equal(hitTestMap(children(1429),x+10,y,viewport)?.uiMapId,1453);
  assert.equal(hitTestMap(children(1429),x+30,y,viewport),null);
  assert.equal(byId.get(1453).parentId,1429);
  assert.equal(byId.get(1429).parentId,1415);
  assert.equal(byId.get(1415).parentId,947);
  assert.equal(byId.get(1944).parentId,1945);
  assert.equal(byId.get(1945).parentId,946);
});
