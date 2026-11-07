const test=require('node:test');
const assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
const path=require('node:path');
const root=path.resolve(__dirname,'..');

async function packets(change=''){
  const lua=`local ns={};GetTime=function()return 0 end;GetServerTime=function()return 777 end
assert(loadfile('tests/fixtures/quest-log.lua'))();questLogFixture.questie()
local original=GetQuestLogTitle
C_QuestLog.GetInfo=function(index)
 local title,level,tag,header,_,complete,frequency,id=original(index)
 if title then return {title=title,isHeader=header,questID=id}end
end
C_QuestLog.IsComplete=function(id)return id==900102 end
C_QuestLog.IsFailed=function(id)return id==900103 end
C_QuestLog.GetQuestsOnMap=function(map)
 if map==1429 then return {{questID=900101,x=.25,y=.75},{questID=900103,x=.2,y=.3}}end
 if map==1453 then return {{questID=900102,x=.3,y=.4}}end
 return {}
end
C_QuestLog.GetNextWaypoint=function(id)if id==900101 then return 1429,.25,.75 end end
SelectQuestLogEntry=function()error('Never select the player quest')end
C_QuestLog.SetMapForQuestPOIs=function()error('Never change the game map')end
assert(loadfile('addon/AzerothLiveMap/Compat.lua'))('AzerothLiveMap',ns)
assert(loadfile('addon/AzerothLiveMap/Protocol.lua'))('AzerothLiveMap',ns)
assert(loadfile('addon/AzerothLiveMap/QuestStream.lua'))('AzerothLiveMap',ns)
assert(loadfile('addon/AzerothLiveMap/MapData.lua'))('AzerothLiveMap',ns)
assert(loadfile('addon/AzerothLiveMap/Questie.lua'))('AzerothLiveMap',ns)
assert(loadfile('addon/AzerothLiveMap/NativeQuests.lua'))('AzerothLiveMap',ns)
local sequence=0
local function emit(count)
 for i=1,count do
  sequence=sequence+1
  local packet=i%2==0 and ns.NativeQuestPacket(1429,.5,.5,sequence,sequence*.05)or ns.QuestiePacket(1429,.5,.5,sequence,sequence*.05)
  print('['..table.concat(packet,',')..']')
 end
end
emit(600)
${change}
`;
  const {decodeBytes}=await import('../app/protocol.js');
  return execFileSync('luajit',['-e',lua],{cwd:root,encoding:'utf8'}).trim().split('\n').map(row=>{const packet=decodeBytes(JSON.parse(row));assert.ok(packet);return packet;});
}

test('built-in quest POIs and turn-ins sync independently of Questie and UI selection',async()=>{
  const {QuestSources}=await import('../app/quests.js');const sources=new QuestSources();
  const rows=await packets();let now=0;for(const packet of rows)sources.accept(packet,now+=50);
  assert.equal(sources.current.visible(1429,now).length,13);
  sources.select('forever');let pins=sources.current.visible(1429,now);
  assert.equal(pins.length,1);assert.equal(pins[0].questId,900101);assert.equal(pins[0].objective,0);assert.equal(pins[0].x,Math.round(.25*65535)/65535);
  assert.equal(pins[0].title,'A Watch on the Ridge');assert.equal(pins[0].source,'forever');
  assert.equal(sources.current.visible(1453,now)[0].markerKind,3);
  sources.select('questie');assert.equal(sources.current.visible(1429,now).length,13);
  assert.equal(sources.select('other'),false);assert.equal(sources.accept({type:'quest',source:'__proto__'},now),false);
});

test('native quest removals clear pins without disturbing the received Questie feed',async()=>{
  const rows=await packets("C_QuestLog.GetQuestsOnMap=function()return {}end;C_QuestLog.GetNextWaypoint=function()end;emit(300)");
  const {QuestSources}=await import('../app/quests.js');const sources=new QuestSources();let now=0;
  for(const packet of rows)sources.accept(packet,now+=50);
  sources.select('forever');assert.equal(sources.current.visible(1429,now).length,0);
  sources.select('questie');assert.equal(sources.current.visible(1429,now).length,13);
});

test('the native helper remains usable with Questie absent',async()=>{
  const rows=await packets('QuestieLoader=nil;emit(300)');
  const {QuestSources}=await import('../app/quests.js');const sources=new QuestSources();let now=0;
  for(const packet of rows)sources.accept(packet,now+=50);
  assert.equal(sources.current.status,0);
  sources.select('forever');assert.equal(sources.current.status,1);
  assert.equal(sources.current.visible(1429,now).length,1);
  assert.equal(sources.current.visible(1453,now).length,1);
});

test('native helper API failures are isolated from Questie and report unavailability',async()=>{
  const rows=await packets("C_QuestLog.GetQuestsOnMap=function()error('Not ready')end;emit(160)");
  const {QuestSources}=await import('../app/quests.js');const sources=new QuestSources();let now=0;
  for(const packet of rows)sources.accept(packet,now+=50);
  sources.select('forever');assert.equal(sources.current.status,2);assert.deepEqual(sources.current.visible(1429,now),[]);
  sources.select('questie');assert.equal(sources.current.status,1);assert.equal(sources.current.visible(1429,now).length,13);
});
