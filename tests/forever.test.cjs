const test = require('node:test');
const assert = require('node:assert/strict');
const {execFileSync} = require('node:child_process');
const {readFileSync} = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname,'..');
const base = `local ns={QuestSession=777};local clock=0
GetBuildInfo=function()return '1.60.1','69977','',16001 end
GetTime=function()return clock end
assert(loadfile('addon/AzerothLiveMap/Compat.lua'))('AzerothLiveMap',ns)
assert(ns.IsForever)
assert(loadfile('addon/AzerothLiveMap/Protocol.lua'))('AzerothLiveMap',ns)
`;
async function packets(body, type, count=1000) {
  const output=execFileSync('luajit',['-e',base+body+`
for i=1,${count} do clock=clock+.05;local p=ns.${type}Packet(i,clock)
if p then print('['..table.concat(p,',')..']')end end`],{cwd:root,encoding:'utf8'});
  const {decodeBytes}=await import('../app/protocol.js');
  return output.trim().split('\n').filter(Boolean).map(line=>{
    const decoded=decodeBytes(JSON.parse(line));assert.ok(decoded);return decoded;
  });
}

test('Forever native quest APIs preserve text, objectives, tags, watch state, completion and failure without legacy globals',async()=>{
  const rows=await packets(`
assert(loadfile('tests/fixtures/quest-log.lua'))()
local oldTitle,oldText=GetQuestLogTitle,GetQuestLogQuestText
C_QuestLog.GetInfo=function(index)
 local title,level,tag,header,collapsed,complete,frequency,id=oldTitle(index)
 if title then return {title=title,level=level,isHeader=header,isCollapsed=collapsed,frequency=frequency,questID=id}end
end
C_QuestLog.GetQuestTagInfo=function(id)return id==900103 and {tagName='Group'} or nil end
C_QuestLog.IsComplete=function(id)return id==900102 end
C_QuestLog.IsFailed=function(id)return id==900103 end
C_QuestLog.GetQuestWatchType=function(id)if id==900101 then return 0 end end
GetQuestLogQuestText=function(index)
 assert(type(index)=='number','Forever reader requires the log index')
 local selected=questLogFixture.selection;questLogFixture.selection=index
 local description,overview=oldText();questLogFixture.selection=selected
 return description,overview
end
GetQuestLogTitle=function()error('Removed legacy title API')end
GetQuestLogSelection=function()error('Removed legacy selection API')end
SelectQuestLogEntry=function()error('Never change the native reader selection')end
IsQuestWatched=function()error('Removed legacy watch API')end
assert(loadfile('addon/AzerothLiveMap/QuestLog.lua'))('AzerothLiveMap',ns)
`,'QuestLog');
  const {QuestLogFeed}=await import('../app/quest-log.js');const feed=new QuestLogFeed();
  rows.forEach((p,i)=>feed.accept(p,i*50));
  assert.equal(feed.summary.count,3);
  assert.match(feed.quest(900101).description,/Captain Élan/);
  assert.equal(feed.quest(900101).watched,true);
  assert.equal(feed.quest(900101).objectives[0].fulfilled,1);
  assert.equal(feed.quest(900102).complete,true);
  assert.equal(feed.quest(900103).failed,true);
  assert.equal(feed.quest(900103).tag,'Group');
});

test('Forever skill records use skillID/name/rank and restore collapsed headers',async()=>{
  const rows=await packets(`
assert(loadfile('tests/fixtures/guild.lua'))();AzerothLiveMapDB={}
GetProfessions=nil;GetProfessionInfo=nil
local collapsed=true
C_SkillInfo={GetNumSkillLines=function()return collapsed and 1 or 3 end,
 GetSkillLineInfo=function(i)
  if i==1 then return {name='Professions',isHeader=true,isCollapsed=collapsed}end
  if i==2 then return {name='Mining',skillID=186,rank=275,isHeader=false}end
  return {name='Blacksmithing',skillID=164,rank=260,isHeader=false}
 end,
 ExpandSkillHeader=function()collapsed=false end,CollapseSkillHeader=function()collapsed=true end}
assert(loadfile('addon/AzerothLiveMap/Guild.lua'))('AzerothLiveMap',ns)
ns.UpdateGuild(0);assert(collapsed,'The native Skills UI must be restored')
`,'Guild',400);
  const {GuildFeed}=await import('../app/guild.js');const feed=new GuildFeed();
  rows.forEach((p,i)=>feed.accept(p,i*50));
  const self=feed.members(19950).find(m=>m.name.startsWith('Éowyn'));
  assert.deepEqual(self.professions.map(p=>[p.name,p.rank]),[['Blacksmithing',260],['Mining',275]]);
});

test('restricted or failing map APIs yield an unavailable position without breaking sync',()=>{
  execFileSync('luajit',['-e',base+`
local secret={};issecretvalue=function(v)return rawequal(v,secret)end
C_Map={GetBestMapForUnit=function()return secret end};assert(ns.PlayerPosition()==nil)
C_Map.GetBestMapForUnit=function()return 1412 end
C_Map.GetPlayerMapPosition=function()return {GetXY=function()return secret,.5 end}end
local map,x=ns.PlayerPosition();assert(map==1412 and x==nil)
C_Map.GetPlayerMapPosition=function()error('Map not ready')end;assert(ns.PlayerPosition()==nil)
C_Map.GetPlayerMapPosition=function()return {GetXY=function()return .44,.59 end}end
GetPlayerFacing=function()return secret end
local map,x,y,facing=ns.PlayerPosition();assert(map==1412 and x==.44 and y==.59 and facing==nil)
`],{cwd:root});
});

test('restricted stats do not prevent Forever equipment and native race names from syncing',async()=>{
  const rows=await packets(`
assert(loadfile('tests/fixtures/character.lua'))()
local secret={};issecretvalue=function(v)return rawequal(v,secret)end
UnitStat=function(_,i)if i==5 then error('Spirit unavailable')end;return secret,secret end
UnitHealthMax=function()return secret end
UnitRace=function()return 'New Forever Race','FOREVERRACE',33 end
assert(loadfile('addon/AzerothLiveMap/Character.lua'))('AzerothLiveMap',ns)
`,'Character',500);
  const {CharacterFeed}=await import('../app/character.js');const feed=new CharacterFeed();
  rows.forEach((p,i)=>feed.accept(p,i*50));
  assert.equal(feed.slot(1).info.itemId,16914);
  assert.match(feed.identity.text,/New Forever Race/);
  assert.deepEqual(feed.records.get('stats:1').info.stats,[65535,65535,65535,65535,65535]);
  assert.equal(feed.records.get('stats:2').info.maxHealth,16777215);
});

test('Forever catalog uses native Wowhead artwork and retains a grid for an unverified map alias',async()=>{
  const maps=JSON.parse(readFileSync(path.join(root,'app/maps.json')));
  const {buildMapCatalog}=await import('../app/navigation.js');
  const catalog=buildMapCatalog(maps);
  assert.equal(catalog.length,59);assert.ok(!catalog.some(m=>m.uiMapId===1944));
  for(const id of [2482,2521,2524,2548,2652])assert.match(catalog.find(m=>m.uiMapId===id).url,/\/classicplus\/maps\//);
  assert.equal(catalog.find(m=>m.uiMapId===2665).url,null);
  assert.ok(maps.every(m=>!m.artTransform),'Native artwork must never receive a Classic coordinate transform');
  assert.equal(maps.find(m=>m.uiMapId===2482).height,684);
});

test('a later Forever build remains enabled and its actual version/build is sent to the desktop',async()=>{
  const rows=await packets(`
GetBuildInfo=function()return '1.60.1','70755','',16001 end
assert(loadfile('addon/AzerothLiveMap/Compat.lua'))('AzerothLiveMap',ns);assert(ns.IsForever)
assert(loadfile('tests/fixtures/character.lua'))()
assert(loadfile('addon/AzerothLiveMap/Character.lua'))('AzerothLiveMap',ns)
`,'Character',500);
  const {CharacterFeed}=await import('../app/character.js');const feed=new CharacterFeed();
  rows.forEach((p,i)=>feed.accept(p,i*50));
  assert.match(feed.identity.text,/1\.60\.1\n70755$/);
});


test('Forever model IDs and equipment resource paths use native public assets',async()=>{
  const {modelId,equipmentModelPath}=await import('../app/character-model.js');
  assert.equal(modelId(33,2),65);assert.equal(modelId(33,3),66);
  assert.equal(modelId(34,2),67);assert.equal(modelId(34,3),68);
  assert.equal(modelId(255,2),null);
  assert.equal(equipmentModelPath({slot:1,display:123}),'/_model/meta/armor/1/123.json');
  assert.equal(equipmentModelPath({slot:21,display:1542}),'/_model/meta/item/1542.json');
  const {modelURL,MAX_ASSET_BYTES}=require('../desktop/resources.cjs');
  assert.match(modelURL('azeroth://companion/_model/m2/959310.m2'),/modelviewer\/classicplus\//);
  assert.ok(MAX_ASSET_BYTES>28775314,'Native Forever meshes exceed 16 MiB');
});
