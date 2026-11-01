import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {decodeBytes,checksum,encodePacket,decodeBlock,drawStrip,HEADER} from '../dist/protocol.js';
import {decodeArtAt,drawArtBlock} from '../dist/art.js';
import {BagFeed} from '../dist/bags.js';

const setup=`local ns={}
assert(loadfile('addon/AzerothLiveMap/Protocol.lua'))('AzerothLiveMap',ns)
assert(loadfile('addon/AzerothLiveMap/Bags.lua'))('AzerothLiveMap',ns)
assert(loadfile('tests/fixtures/bags.lua'))()
ns.QuestSession=777
local function emit(seq)
 local packet=ns.BagPacket(seq,seq*.1);assert(packet);print(table.concat(packet,','))
end
`;
function emit(code,runtime='luajit'){
  const result=spawnSync(runtime,['-e',setup+code],{encoding:'utf8',timeout:5000});
  assert.equal(result.status,0,result.stderr);
  return result.stdout.trim().split('\n').map(row=>row.split(',').map(Number));
}
function accept(feed,rows,start=0){rows.forEach((row,i)=>{const packet=decodeBytes(row);assert.equal(packet?.type,'bags');feed.accept(packet,start+i*100);});return feed;}

test('Lua bag metadata arrives before names; repeated packets recover all five bags under loss',()=>{
  const rows=emit('for i=1,1000 do emit(i) end'),feed=new BagFeed();
  accept(feed,rows.slice(0,69));assert.equal(feed.progress().complete,true,'all slot metadata is sent first');
  assert.equal(feed.bag(1).text,null,'names follow the initial slot snapshot');
  feed.reset();rows.forEach((row,i)=>{if(i%5)feed.accept(decodeBytes(row),i*100);});
  assert.deepEqual(feed.progress(),{bags:5,total:64,received:64,used:13,free:51,complete:true});
  assert.equal(feed.bag(1).text,'Netherweave Bag');
  assert.equal(feed.slot(0,6).text,'Étoffe de l’aventurier');
  assert.equal(feed.slot(0,2).info.count,12);assert.equal(feed.slot(3,2).info.count,181);
  assert.equal(feed.slot(0,16).info.itemId,0);assert.equal(feed.bag(2).info.slotCount,0);
  assert.equal(feed.slot(2,1),null);assert.equal(feed.isFresh(100000),true);assert.equal(feed.isFresh(110000),false);
});

test('looting, moving, clearing slots and replacing/removing bags cannot restore old contents',()=>{
  const rows=emit(`for i=1,400 do emit(i) end
    bagFixture.slots[0][2][2]=3
    bagFixture.slots[0][8]=bagFixture.slots[0][3];bagFixture.slots[0][3]=nil
    bagFixture.sizes[1]=4;bagFixture.bagIDs[1]=4496;bagFixture.names[1]='Small Brown Pouch';bagFixture.slots[1]={[1]={13446,2}}
    ns.InvalidateBags();for i=401,800 do emit(i) end
    bagFixture.sizes[3]=0;bagFixture.bagIDs[3]=nil;bagFixture.slots[3]={}
    ns.InvalidateBags();for i=801,1000 do emit(i) end`);
  const feed=accept(new BagFeed(),rows.slice(0,400));
  const old=rows.slice(0,400).map(decodeBytes).find(p=>p.kind===1 && p.index===65);
  accept(feed,rows.slice(400,800),40000);
  assert.equal(feed.slot(0,2).info.count,3);assert.equal(feed.slot(0,3).info.itemId,0);
  assert.equal(feed.slot(0,8).info.itemId,27854);assert.equal(feed.bag(1).info.slotCount,4);
  assert.equal(feed.slot(1,1).info.itemId,13446);assert.equal(feed.slot(1,5),null);
  assert.equal(feed.accept({...old,sequence:2000},80001),false,'old item revision is ignored');
  accept(feed,rows.slice(800),80000);assert.equal(feed.bag(3).info.slotCount,0);assert.equal(feed.slot(3,1),null);
  assert.equal(feed.progress().total,40);assert.equal(feed.progress().complete,true);
  assert.equal(feed.accept({...old,sequence:2001,session:778},100001),false);
  feed.reset();assert.equal(feed.progress().total,0);assert.equal(feed.records.size,0);
});

test('bag names survive reordering, unavailable item cache, and topology packets arriving late',()=>{
  const rows=emit(`for i=1,400 do emit(i) end
    bagFixture.items[12345]=nil;ns.InvalidateBags();for i=401,600 do emit(i) end
    bagFixture.items[12345]={'Loaded item name',4,70};ns.InvalidateBags();for i=601,900 do emit(i) end`);
  const feed=accept(new BagFeed(),rows.slice(0,400).reverse());assert.equal(feed.slot(0,6).text,'Étoffe de l’aventurier');
  accept(feed,rows.slice(400,600),40000);assert.equal(feed.slot(0,6).info.itemId,12345);assert.equal(feed.slot(0,6).text,null);
  accept(feed,rows.slice(600),60000);assert.equal(feed.slot(0,6).text,'Loaded item name');assert.equal(feed.slot(0,6).info.quality,4);
  const descriptor=feed.bag(1).info,slot=feed.slot(1,1).info;
  feed.accept({...slot,generation:slot.generation+1000,sequence:5000,epoch:slot.epoch+1},100000);
  assert.equal(feed.slot(1,1),null,'slot for a future bag cannot appear under the old bag');
  feed.accept({...descriptor,generation:descriptor.generation+1001,sequence:5001,epoch:slot.epoch+1},100001);
  assert.equal(feed.slot(1,1).info.epoch,slot.epoch+1);
});

test('bag packets support legacy container APIs and Lua 5.1; reject invalid fields and corruption',()=>{
  const rows=emit(`local modern=C_Container
    GetContainerNumSlots=modern.GetContainerNumSlots;ContainerIDToInventoryID=modern.ContainerIDToInventoryID;GetBagName=modern.GetBagName
    GetContainerItemID=modern.GetContainerItemID
    GetContainerItemInfo=function(bag,slot)local d=modern.GetContainerItemInfo(bag,slot);if d then return 123,d.stackCount,false,d.quality,false,false,d.hyperlink,false,false,d.itemID end end
    C_Container=nil
    for i=1,300 do emit(i) end`,'lua5.1');
  const feed=accept(new BagFeed(),rows);assert.equal(feed.slot(0,2).info.count,12);
  const slot=rows.find(row=>decodeBytes(row).kind===1 && decodeBytes(row).itemId);
  for(let i=0;i<24;i++){const broken=[...slot];broken[i]^=1;assert.equal(decodeBytes(broken),null);}
  for(const [index,value] of [[2,99],[9,255],[16,8]]){
    const broken=[...slot];broken[index]=value;broken.splice(22,2,...checksum(broken.slice(0,22)));assert.equal(decodeBytes(broken),null);
  }
});

test('bag packets share both plain and HUZZAH transport lanes with positions and other data',()=>{
  const bag=emit('emit(1)')[0],position=encodePacket({questLanes:4,questSession:777,artMode:true});
  const packets=[position,bag,bag,bag,bag];
  function context(width,height){
    const image={width,height,data:new Uint8ClampedArray(width*height*4)};
    const ctx={fillStyle:'#000',fillRect(x,y,w,h){const color=this.fillStyle==='#000'?[0,0,0]:this.fillStyle==='#fff'?[255,255,255]:this.fillStyle.match(/\d+/g).map(Number);for(let py=y;py<y+h;py++)for(let px=x;px<x+w;px++)image.data.set([...color,255],(py*width+px)*4);}};
    return {image,ctx};
  }
  const plain=context(100,80);packets.forEach((packet,lane)=>drawStrip(plain.ctx,packet,0,lane*16,2));
  assert.deepEqual(decodeBlock(plain.image,{x:0,y:0,width:100,height:16}).map(p=>p.type||'position'),['position','bags','bags','bags','bags']);
  const art=JSON.parse(readFileSync(new URL('../dist/elephant-art.json',import.meta.url))),block=context(art.width*2,(art.height+art.footerRows)*2);
  drawArtBlock(block.ctx,packets,art,0,0,0,2,HEADER);
  assert.deepEqual(decodeArtAt(block.image,{x:0,y:art.height*2,width:100,height:16},art,decodeBytes,HEADER).packets.map(p=>p.type||'position'),['position','bags','bags','bags','bags']);
});
