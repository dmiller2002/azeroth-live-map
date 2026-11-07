const test=require('node:test');
const assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
const {readFileSync}=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
async function packets(body=''){
  const lua=`local ns={QuestSession=777};local clock=0;AzerothLiveMapDB={};GetTime=function()return clock end;GetServerTime=function()return 1800000000+math.floor(clock)end
UnitName=function()return 'Éowyn','Test Realm'end;GetRealmName=function()return 'Test Realm'end
assert(loadfile('tests/fixtures/bags.lua'))();assert(loadfile('tests/fixtures/bank.lua'))()
for _,name in ipairs({'Compat','Protocol','Bags','Bank'})do assert(loadfile('addon/AzerothLiveMap/'..name..'.lua'))('AzerothLiveMap',ns)end
local sequence=0
local function emit(count)
 for i=1,count do clock=clock+.1;sequence=(sequence+1)%65536;local p=ns.BankPacket(sequence,clock);if p then print(clock..'|['..table.concat(p,',')..']')end end
end
local function open()bankFixture.open=true;ns.BankEvent('BANKFRAME_OPENED')end
local function close()bankFixture.open=false;ns.BankEvent('BANKFRAME_CLOSED')end
${body}`;
  const {decodeBytes}=await import('../app/protocol.js');
  return execFileSync('luajit',['-e',lua],{cwd:root,encoding:'utf8'}).trim().split('\n').filter(Boolean).map(row=>{
    const [time,json]=row.split('|'),raw=JSON.parse(json),packet=decodeBytes(raw);assert.ok(packet,json);return {now:Number(time)*1000,packet,raw};
  });
}
async function feed(rows){const {BankFeed}=await import('../app/bank.js');const f=new BankFeed();for(const row of rows)f.accept(row.packet,row.now);return f;}

test('native character and account bank tabs retain all slots beyond the old 64-slot limit',async()=>{
  const rows=await packets('open();emit(3000)');const f=await feed(rows);
  assert.equal(f.summary(0).status,1);assert.equal(f.summary(0).tabCount,2);assert.equal(f.summary(1).tabCount,1);
  assert.equal(f.bag(0).text,'Supplies');assert.equal(f.bag(16).text,'Shared materials');
  assert.deepEqual(f.progress(0),{tabs:2,total:114,received:114,used:3,free:111,complete:true});
  assert.equal(f.slot(0,98).info.count,12);assert.equal(f.slot(16,97).info.count,55);
  assert.equal(f.slot(0,98).text,'Major Healing Potion');
});
test('closed banks use a saved snapshot, including after addon reload, without reading closed containers',async()=>{
  const rows=await packets("open();emit(1500);close();emit(200);assert(loadfile('addon/AzerothLiveMap/Bank.lua'))('AzerothLiveMap',ns);emit(1500)");
  // Reload creates fresh record generations and a new desktop feed.
  const f=await feed(rows.slice(-1500));assert.equal(f.summary(0).status,2);assert.equal(f.summary(0).updatedAt>0,true);
  assert.equal(f.slot(0,98).info.itemId,13446);assert.equal(f.slot(16,97).info.count,55);
});
test('bank item moves, stack changes and removed tabs invalidate old contents without touching bags',async()=>{
  const rows=await packets("open();emit(1600);bankFixture.slots[20][1]=nil;bankFixture.slots[20][98]={13446,3};bankFixture.types[0]={{ID=20,name='Updated supplies'}};ns.BankEvent('BANK_TABS_CHANGED');emit(2000)");
  const f=await feed(rows);assert.equal(f.summary(0).tabCount,1);assert.equal(f.bag(1),null);
  assert.equal(f.slot(0,1).info.itemId,0);assert.equal(f.slot(0,98).info.count,3);assert.equal(f.bag(0).text,'Updated supplies');
  const {BagFeed}=await import('../app/bags.js');const bags=new BagFeed();assert.equal(bags.accept(rows.at(-1).packet,rows.at(-1).now),false);
});
test('failed or restricted bank reads preserve the last successful snapshot and do not clear live bags',async()=>{
  for(const change of ["C_Container.GetContainerNumSlots=function()error('Not ready')end","local secret={};issecretvalue=function(v)return rawequal(v,secret)end;C_Container.GetContainerItemInfo=function()return {itemID=secret}end"]){
    const f=await feed(await packets('open();emit(1600);'+change+";ns.BankEvent('BAG_UPDATE_DELAYED');emit(500)"));
    assert.equal(f.summary(0).status,3);assert.equal(f.slot(0,98).info.itemId,13446);
  }
});
test('bank cache is isolated by character and realm, and malformed saved snapshots are ignored',async()=>{
  for(const change of ["UnitName=function()return 'Another','Test Realm'end","AzerothLiveMapDB.bankCache['Éowyn-Test Realm'][1]={tabs={{id=20,count=98,slots={}}},updatedAt=1800000000}"]){
    const rows=await packets("open();emit(1500);close();"+change+";assert(loadfile('addon/AzerothLiveMap/Bank.lua'))('AzerothLiveMap',ns);emit(300)");
    const f=await feed(rows.slice(-300));assert.equal(f.summary(0).status,0);assert.equal(f.bag(0),null);
  }
});

test('a bank that is viewable but locked keeps cached items rather than reading inaccessible slots',async()=>{
  const f=await feed(await packets("open();emit(1600);C_Bank.CanUseBank=function()return false end;C_Container.GetContainerItemInfo=function()error('Locked bank must not be read')end;ns.BankEvent('BAG_UPDATE_DELAYED');emit(500)"));
  assert.equal(f.summary(0).status,2);assert.equal(f.slot(0,98).info.itemId,13446);
});
test('bank packets pass through plain-strip and artwork pixel capture',async()=>{
  const row=(await packets('open();emit(20)')).find(r=>r.packet.group===0);
  const {encodePacket,drawStrip,decodeBlock,decodeBytes,HEADER}=await import('../app/protocol.js');
  const {drawArtBlock,decodeArtAt}=await import('../app/art.js');
  const art=JSON.parse(readFileSync(path.join(root,'app/elephant-art.json')));
  function bitmap(width,height){const data=new Uint8ClampedArray(width*height*4);return {image:{data,width,height},context:{fillStyle:'#000',fillRect(x,y,w,h){const color=this.fillStyle.startsWith('rgb')?this.fillStyle.match(/[0-9.]+/g).slice(0,3).map(Number):this.fillStyle==='#fff'?[255,255,255]:[0,0,0];for(let row=y;row<y+h;row++)for(let col=x;col<x+w;col++)data.set([...color,255],(row*width+col)*4);}}};}
  const cell=4,plain=bitmap(50*cell,16*cell);
  [encodePacket({questLanes:1,questSession:777}),row.raw].forEach((p,i)=>drawStrip(plain.context,p,0,i*8*cell,cell));
  assert.equal(decodeBlock(plain.image,{x:0,y:0,width:50*cell,height:8*cell})[1].type,'bank');
  const sprite=bitmap(art.width*cell,(art.height+art.footerRows)*cell);
  drawArtBlock(sprite.context,[encodePacket({questLanes:1,questSession:777,artMode:true}),row.raw],art,0,0,0,cell,HEADER);
  assert.equal(decodeArtAt(sprite.image,{x:0,y:art.height*cell,width:50*cell,height:8*cell},art,decodeBytes,HEADER).packets[1].type,'bank');
});

test('the real scheduler reserves bank bandwidth without starving bags, Questie or the other feeds',()=>{
  execFileSync('luajit',['-e',`assert(loadfile('tests/fixtures/tracker-frame.lua'))()
local f=trackerFixture;local ns=f.boot({art=true,fastSync=true});local counts={}
for _,name in ipairs({'MapDataPacket','NativeQuestPacket','CharacterPacket','BagPacket','BankPacket','GuildPacket','QuestLogPacket','QuestiePacket'})do
 counts[name]=0;ns[name]=function()counts[name]=counts[name]+1;return ns.EncodeQuest(0,1,1429,1,0,{0},3)end
end
local events={};ns.BankEvent=function(event)events[event]=true end
f.event('BANKFRAME_OPENED');f.event('BANKFRAME_CLOSED');f.event('BANK_TABS_CHANGED')
assert(events.BANKFRAME_OPENED and events.BANKFRAME_CLOSED and events.BANK_TABS_CHANGED)
local before=f.positionWrites
for i=1,60 do f.frame.scripts.OnUpdate(f.frame,1/60)end
assert(f.positionWrites-before==20,'Bank must preserve position frequency')
for name,count in pairs(counts)do assert(count==10,name..' bandwidth was '..count)end
`],{cwd:root,encoding:'utf8'});
});
