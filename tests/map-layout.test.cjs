const test=require('node:test');
const assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
const {readFileSync}=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const near=(actual,expected)=>assert.ok(Math.abs(actual-expected)<.0003,`${actual} should be ${expected}`);

async function layoutPackets(extra=''){
  const script=`local ns={QuestSession=777};local now=0;GetTime=function()return now end
assert(loadfile('addon/AzerothLiveMap/Compat.lua'))('AzerothLiveMap',ns)
assert(loadfile('addon/AzerothLiveMap/Protocol.lua'))('AzerothLiveMap',ns)
assert(loadfile('tests/fixtures/map-layout.lua'))()
assert(loadfile('addon/AzerothLiveMap/MapData.lua'))('AzerothLiveMap',ns)
${extra}
for i=1,30 do local packet=ns.MapDataPacket(1429,i);if packet then print('['..table.concat(packet,',')..']')end end`;
  const output=execFileSync('luajit',['-e',script],{cwd:root,encoding:'utf8'});
  const {decodeBytes}=await import('../app/protocol.js');
  return output.trim().split('\n').filter(Boolean).map(row=>{const raw=JSON.parse(row),packet=decodeBytes(raw);assert.ok(packet);return {...packet,raw};});
}

test('real native layout packets align a zone point on continent, world, and cosmic maps',async()=>{
  const {MapLayout}=await import('../app/map-layout.js');
  const layout=new MapLayout(),packets=await layoutPackets();
  assert.deepEqual(packets.slice(0,4).map(packet=>packet.mapId),[1429,1415,947,946],'The current map chain must arrive before background maps');
  for(const packet of packets){assert.equal(packet.type,'maplayout');assert.equal(packet.session,777);layout.accept(packet);}
  let point=layout.project(1429,1415,{x:.25,y:.75});near(point.x,.45);near(point.y,.85);
  point=layout.project(1429,947,{x:.25,y:.75});near(point.x,.785);near(point.y,.78);
  point=layout.project(1429,946,{x:.25,y:.75});near(point.x,.7925);near(point.y,.668);
  point=layout.project(947,1429,{x:.785,y:.78});near(point.x,.25);near(point.y,.75);
  assert.equal(layout.project(1429,1436,{x:.25,y:.75}),null,'A sibling zone is not treated as the active zone');
  assert.equal(layout.project(947,1429,{x:.1,y:.1}),null,'Out-of-zone parent waypoints stay hidden');
  const signed=packets.find(packet=>packet.mapId===3000);near(signed.minX,-.2);
});

test('native rectangles replace old navigation regions, including city hit targets',async()=>{
  const {MapLayout}=await import('../app/map-layout.js');
  const {buildMapCatalog,hitTestMap}=await import('../app/navigation.js');
  const base=buildMapCatalog(JSON.parse(readFileSync(path.join(root,'app/maps.json'))));
  assert.ok(base.every(map=>!map.polygon && !map.entrance),'Old TBC artwork is never used to infer geometry');
  const layout=new MapLayout();for(const packet of await layoutPackets())layout.accept(packet);
  const maps=layout.catalog(base),children=maps.filter(map=>map.parentId===1415),viewport={x:0,y:0,w:1000,h:1000};
  assert.equal(hitTestMap(children,450,850,viewport)?.uiMapId,1429);
  const city=maps.find(map=>map.uiMapId===1453);assert.equal(city.parentId,1429);near(city.entrance.x,.2);near(city.entrance.y,.3);
  assert.equal(hitTestMap([city],200,300,viewport)?.uiMapId,1453);
});

test('unavailable and restricted native rectangles are omitted rather than guessed',async()=>{
  const packets=await layoutPackets("local secret={};issecretvalue=function(value)return rawequal(value,secret)end;C_Map.GetMapRectOnMap=function()return secret,.5,.1,.9 end");
  assert.ok(packets.every(packet=>packet.mapId===946),'Only the root identity record may remain');
  const {MapLayout}=await import('../app/map-layout.js');const layout=new MapLayout();
  assert.equal(layout.project(1429,947,{x:.5,y:.5}),null);
  assert.deepEqual(layout.project(1429,1429,{x:.5,y:.5}),{x:.5,y:.5});
  const record={type:'maplayout',mapId:1,parentId:2,mapType:3,minX:0,maxX:1,minY:0,maxY:1};
  assert.equal(layout.accept(record),true);assert.equal(layout.accept({...record,mapId:2,parentId:1}),false);
  assert.equal(layout.accept({...record,mapId:3,minX:NaN}),false);
  layout.reset();assert.equal(layout.project(1,2,{x:.5,y:.5}),null);
});

test('both pixel transports retain layout and native quest packets beside the player position',async()=>{
  const {encodePacket,checksum,drawStrip,decodeBlock,decodeBytes,HEADER}=await import('../app/protocol.js');
  const {drawArtBlock,decodeArtAt}=await import('../app/art.js');
  const art=JSON.parse(readFileSync(path.join(root,'app/elephant-art.json')));
  const layout=(await layoutPackets())[0].raw;
  const native=[167,11,3,0,3,0,0,3,9,0,0,1,0,0,0,0,0,0,0,0,0,0];native.push(...checksum(native));
  function bitmap(width,height){
    const data=new Uint8ClampedArray(width*height*4);
    const context={fillStyle:'#000',fillRect(x,y,w,h){
      const color=this.fillStyle.startsWith('rgb')?this.fillStyle.match(/[0-9.]+/g).slice(0,3).map(Number):this.fillStyle==='#fff'?[255,255,255]:[0,0,0];
      for(let row=y;row<y+h;row++)for(let col=x;col<x+w;col++)data.set([...color,255],(row*width+col)*4);
    }};
    return {image:{data,width,height},context};
  }
  const cell=4,plain=bitmap(50*cell,24*cell);
  const position=encodePacket({questLanes:2,questSession:777});
  [position,layout,native].forEach((packet,index)=>drawStrip(plain.context,packet,0,index*8*cell,cell));
  let packets=decodeBlock(plain.image,{x:0,y:0,width:50*cell,height:8*cell});
  assert.deepEqual(packets.slice(1).map(packet=>packet.type),['maplayout','quest']);
  const sprite=bitmap(art.width*cell,(art.height+art.footerRows)*cell);
  drawArtBlock(sprite.context,[encodePacket({questLanes:2,questSession:777,artMode:true}),layout,native],art,0,0,0,cell,HEADER);
  packets=decodeArtAt(sprite.image,{x:0,y:art.height*cell,width:50*cell,height:8*cell},art,decodeBytes,HEADER)?.packets;
  assert.deepEqual(packets?.slice(1).map(packet=>packet.type),['maplayout','quest']);
  assert.equal(packets[2].source,'forever');
});
