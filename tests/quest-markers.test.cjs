const test=require('node:test');
const assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
const path=require('node:path');
const root=path.resolve(__dirname,'..');

async function snapshot(change=''){
  const {decodeBytes}=await import('../app/protocol.js');
  const {QuestFeed}=await import('../app/quests.js');
  const lua=`local ns={};GetTime=function()return 0 end;GetServerTime=function()return 777 end
assert(loadfile('tests/fixtures/quest-log.lua'))();questLogFixture.questie()
assert(loadfile('addon/AzerothLiveMap/Compat.lua'))('AzerothLiveMap',ns)
assert(loadfile('addon/AzerothLiveMap/Protocol.lua'))('AzerothLiveMap',ns)
assert(loadfile('addon/AzerothLiveMap/Questie.lua'))('AzerothLiveMap',ns)
local sequence=0
local function emit(count)
 for i=1,count do sequence=sequence+1;local p=ns.QuestiePacket(1429,.5,.5,sequence,sequence*.05);print('['..table.concat(p,',')..']') end
end
emit(500)
${change}
`;
  const output=execFileSync('luajit',['-e',lua],{cwd:root,encoding:'utf8'}),feed=new QuestFeed();
  let now=0;const rows=[];
  for(const row of output.trim().split('\n')){
    const packet=decodeBytes(JSON.parse(row));assert.ok(packet,'The desktop must decode every real addon packet');
    assert.equal(packet.version,10);feed.accept(packet,now+=50);rows.push({packet,now});
  }
  return {feed,now,rows};
}

test('Questie icon types survive real addon encoding, pixel packet decoding and the multi-zone feed',async()=>{
  const {questMarkerStyle}=await import('../app/quest-markers.js');
  const {feed,now}=await snapshot();
  const pins=feed.visible(1429,now);
  assert.equal(pins.length,13);assert.equal(feed.visible(1453,now).length,1);
  assert.equal(pins.find(p=>p.questId===900101).title,'A Watch on the Ridge');
  assert.equal(pins.find(p=>p.questId===900101).collected,1);
  assert.deepEqual(pins.filter(p=>p.questId>910000).sort((a,b)=>a.questId-b.questId).map(p=>[p.iconType,questMarkerStyle(p).shape]),
    [[6,'pickup'],[2,'bag'],[4,'gear'],[3,'search'],[5,'talk'],[10,'pickup'],[11,'turnin'],[7,'pickup'],[12,'turnin'],[13,'pickup'],[15,'pickup']]);
  assert.notDeepEqual(questMarkerStyle({markerKind:1,iconType:6}).palette,questMarkerStyle({markerKind:1,iconType:10}).palette);
});

test('icon changes replace cached pins and missing/custom icon textures use the Questie objective type',async()=>{
  const {feed,now}=await snapshot("_G.DAUITestQuestPin1.data.Icon=2;_G.DAUITestSymbol2.data.Icon='custom/icon';_G.DAUITestSymbol3.data.Icon=999;emit(500)");
  const pins=feed.visible(1429,now);
  assert.equal(pins.filter(p=>p.questId===900101).length,1);
  assert.equal(pins.find(p=>p.questId===900101).iconType,2);
  assert.equal(pins.find(p=>p.questId===910002).iconType,2);
  assert.equal(pins.find(p=>p.questId===910003).iconType,4);
});

test('older addons keep pickup, objective and turn-in markers and invalid packed kinds are rejected',async()=>{
  const {checksum,decodeBytes}=await import('../app/protocol.js');
  const {questMarkerStyle}=await import('../app/quest-markers.js');
  for(const version of [2,3,8]){
    for(const kind of [1,2,3]){
      const raw=[167,version,1,0,1,7,152,0,1,0,1,0,0,42,128,0,128,0,kind,1,0,4];
      const packet=decodeBytes([...raw,...checksum(raw)]);
      assert.equal(packet.markerKind,kind);assert.equal(packet.questId,42);
      assert.equal(questMarkerStyle(packet).shape,({1:'pickup',2:'search',3:'turnin'})[kind]);
      raw[1]=8;raw[18]=4*6;
      assert.equal(decodeBytes([...raw,...checksum(raw)]),null);
    }
  }
});

test('adding a Questie pin preserves all existing pins and revisions on every packet',async()=>{
  const {rows}=await snapshot(`_G.NewQuestPin={data={Type='monster',Icon=1,QuestData={name='Fresh Tracks'}},miniMapIcon=false,UiMapID=1429,x=25,y=60}
QuestieLoader:ImportModule('QuestieMap').questIdFrames[900104]={'NewQuestPin'};emit(200)`);
  const {QuestFeed}=await import('../app/quests.js'),feed=new QuestFeed();let original;
  for(let i=0;i<rows.length;i++){
    const {packet,now}=rows[i];feed.accept(packet,now);
    if(i===499)original=feed.visible(1429,now);
    if(i>=500)for(const pin of original){
      const current=feed.visible(1429,now).find(p=>p.questId===pin.questId);
      assert.ok(current,'Existing map pins must stay visible while a new pin arrives');
      assert.equal(current.index,pin.index);assert.equal(current.generation,pin.generation);assert.equal(current.title,pin.title);
    }
  }
  assert.equal(feed.visible(1429,rows.at(-1).now).length,14);
});

test('a dropped removal is repaired by repeats and delayed pins cannot revive a removed marker',async()=>{
  const {rows}=await snapshot("QuestieLoader:ImportModule('QuestieMap').questIdFrames[900101]=nil;emit(200)");
  const {QuestFeed}=await import('../app/quests.js'),feed=new QuestFeed();let missed=false,old;
  for(let i=0;i<rows.length;i++){
    const {packet,now}=rows[i];
    if(i<500 && packet.questId===900101 && packet.kind===1)old=packet;
    if(i>=500 && packet.kind===4 && !missed){missed=true;continue;}
    feed.accept(packet,now);
  }
  assert.ok(missed);assert.ok(!feed.visible(1429,rows.at(-1).now).some(p=>p.questId===900101));
  assert.equal(feed.visible(1429,rows.at(-1).now).length,12);
  assert.equal(feed.accept({...old,sequence:60000},rows.at(-1).now+1),false);
});
