import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {decodeBytes,checksum,decodeBlock,HEADER,bit,encodePacket} from '../dist/protocol.js';
import {CharacterFeed} from '../dist/character.js';
import {decodeArtAt,drawArtBlock} from '../dist/art.js';
import {readFileSync} from 'node:fs';

const setup=`
local ns={}
assert(loadfile('addon/AzerothLiveMap/Protocol.lua'))('AzerothLiveMap',ns)
assert(loadfile('addon/AzerothLiveMap/Character.lua'))('AzerothLiveMap',ns)
assert(loadfile('tests/fixtures/character.lua'))()
ns.QuestSession=777
local function emit(seq,now)
 local packet=ns.CharacterPacket(seq,now or seq*.1)
 assert(packet);print(table.concat(packet,','))
end
`;
function emit(lua,runtime='luajit'){
  const result=spawnSync(runtime,['-e',setup+lua],{encoding:'utf8',timeout:5000});
  assert.equal(result.status,0,result.stderr);
  return result.stdout.trim().split('\n').map(row=>row.split(',').map(Number));
}
function feedPackets(rows,{loss=false}={}){
  const feed=new CharacterFeed();
  rows.forEach((row,i)=>{const packet=decodeBytes(row);assert.equal(packet?.type,'character');if(!loss || i%5)feed.accept(packet,i*100);});
  return feed;
}

test('actual Lua character packets sync identity, 19 slots, UTF-8 names, attributes and empty slots',()=>{
  const rows=emit('for i=1,300 do emit(i) end');
  const feed=feedPackets(rows,{loss:true});
  assert.equal(feed.identity.text,'Éowyn\nTest Realm');
  assert.equal(feed.identity.info.level,65);
  assert.equal(feed.identity.info.raceId,5);
  assert.equal(feed.slot(1).text,'Netherwind Crown');
  assert.equal(feed.slot(16).text,'Thunderfury, Blessed Blade of the Windseeker');
  assert.equal(feed.slot(16).info.quality,5);
  assert.equal(feed.slot(16).info.durability,65);
  assert.equal(feed.slot(2).info.itemId,0);
  for(let slot=1;slot<=19;slot++)assert.ok(feed.slot(slot).info,'every slot has explicit metadata');
  assert.deepEqual(feed.records.get('stats:1').info.stats,[200,120,180,90,80]);
  assert.equal(feed.records.get('stats:2').info.maxHealth,5420);
  assert.equal(feed.records.get('stats:2').info.armor,3480);
  assert.ok(feed.isFresh(30000));assert.equal(feed.isFresh(36000),false);
});

test('gear replacement, empty slots and uncached names replace only their own record',()=>{
  const rows=emit(`
    for i=1,150 do emit(i) end
    fixture.slots[1]=12345;fixture.slots[16]=nil;fixture.stats[1]=225
    for i=151,300 do emit(i) end
    fixture.items[12345]=nil
    for i=301,330 do emit(i) end
    fixture.items[12345]={"Newly loaded item",3,70}
    for i=331,480 do emit(i) end
  `);
  const feed=feedPackets(rows.slice(0,150)),oldHead=decodeBytes(rows.find(row=>decodeBytes(row).kind===1 && decodeBytes(row).index===1));
  const oldGeneration=feed.slot(1).generation;
  rows.slice(150,300).forEach((row,i)=>feed.accept(decodeBytes(row),15000+i*100));
  assert.notEqual(feed.slot(1).generation,oldGeneration);
  assert.equal(feed.slot(1).info.itemId,12345);
  assert.equal(feed.slot(1).text,"Équipement de l'aventurier");
  assert.equal(feed.slot(16).info.itemId,0);assert.equal(feed.slot(16).text,null);
  assert.equal(feed.slot(5).text,'Breastplate of Might');
  assert.equal(feed.records.get('stats:1').info.stats[0],225);
  assert.equal(feed.accept({...oldHead,sequence:500},30100),false,'late old gear cannot replace the new item');
  rows.slice(300).forEach((row,i)=>feed.accept(decodeBytes(row),31000+i*100));
  assert.equal(feed.slot(1).text,'Newly loaded item');assert.equal(feed.slot(1).info.quality,3);
  const changedSession={...decodeBytes(rows.at(-1)),sequence:501,session:778};
  assert.equal(feed.accept(changedSession,50000),false);
  feed.reset();assert.equal(feed.identity,undefined);assert.equal(feed.records.size,0);
  assert.equal(feed.accept(changedSession,50001),true);
});

test('reordered character fragments reconstruct names without mixing equipment revisions',()=>{
  const rows=emit('for i=1,100 do emit(i) end');
  const packets=rows.map(decodeBytes).filter(p=>p.index===16);
  const feed=new CharacterFeed();
  packets.slice().reverse().forEach((p,i)=>feed.accept(p,i));
  assert.equal(feed.slot(16).text,'Thunderfury, Blessed Blade of the Windseeker');
  const info=packets.find(p=>p.kind===1);
  feed.accept({...info,sequence:1000,generation:info.generation+1,itemId:12345},200);
  assert.equal(feed.slot(16).text,null);
  assert.equal(feed.accept({...packets.find(p=>p.kind===2),sequence:1001},201),false);
});

test('character packets reject corrupted or unsupported fields and stay Lua 5.1 compatible',()=>{
  const row=emit('emit(1)','lua5.1')[0];assert.ok(decodeBytes(row));
  for(let i=0;i<24;i++){const broken=[...row];broken[i]^=1;assert.equal(decodeBytes(broken),null);}
  for(const [index,value] of [[2,99],[9,255],[13,255]]){
    const broken=[...row];broken[index]=value;broken.splice(22,2,...checksum(broken.slice(0,22)));assert.equal(decodeBytes(broken),null);
  }
});

test('plain multi-lane and animated transports decode character data beside quests and positions',()=>{
  const character=emit('emit(1)')[0],position=encodePacket({valid:true,mapId:1429,x:.4,y:.6,sequence:1,clock:100,questLanes:4,questSession:777,artMode:true});
  const quest=[167,3,3,0,2,0,0,3,9,0,0,0,...Array(10).fill(0)];quest.push(...checksum(quest));
  const packets=[position,quest,character,character,quest];
  const image={width:100,height:80,data:new Uint8ClampedArray(100*80*4)};
  const pixel=(image,x,y,value)=>{const i=(y*image.width+x)*4;image.data[i]=image.data[i+1]=image.data[i+2]=value;image.data[i+3]=255;};
  packets.forEach((packet,lane)=>{for(let row=1;row<=6;row++)for(let col=1;col<=48;col++){
    const value=row===1?bit(HEADER,col-1):row===2?1-bit(HEADER,col-1):bit(packet,(row-3)*48+col-1);
    for(let dy=0;dy<2;dy++)for(let dx=0;dx<2;dx++)pixel(image,col*2+dx,(lane*8+row)*2+dy,value*255);
  }});
  assert.deepEqual(decodeBlock(image,{x:0,y:0,width:100,height:16}).map(p=>p.type||'position'),['position','quest','character','character','quest']);
  const art=JSON.parse(readFileSync(new URL('../dist/elephant-art.json',import.meta.url))),cell=2;
  const artImage={width:art.width*cell,height:(art.height+art.footerRows)*cell,data:new Uint8ClampedArray(art.width*cell*(art.height+art.footerRows)*cell*4)};
  const context={fillStyle:'#000',fillRect(x,y,w,h){
    const color=this.fillStyle==='#000'?[0,0,0]:this.fillStyle==='#fff'?[255,255,255]:this.fillStyle.match(/\d+/g).map(Number);
    for(let py=y;py<y+h;py++)for(let px=x;px<x+w;px++)artImage.data.set([...color,255],(py*artImage.width+px)*4);
  }};
  drawArtBlock(context,packets,art,0,0,0,cell,HEADER);
  assert.deepEqual(decodeArtAt(artImage,{x:0,y:art.height*cell,width:100,height:16},art,decodeBytes,HEADER).packets.map(p=>p.type||'position'),['position','quest','character','character','quest']);
});
