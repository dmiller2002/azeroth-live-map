const test=require('node:test');
const assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const luaPrelude=`local ns={QuestSession=777};local clock=0
GetTime=function()return clock end
AzerothLiveMapDB={}
assert(loadfile('tests/fixtures/guild.lua'))()
assert(loadfile('addon/AzerothLiveMap/Compat.lua'))('AzerothLiveMap',ns)
assert(loadfile('addon/AzerothLiveMap/Protocol.lua'))('AzerothLiveMap',ns)
assert(loadfile('addon/AzerothLiveMap/Guild.lua'))('AzerothLiveMap',ns)
local sequence=0
local function emit(count)
 for i=1,count do
  clock=clock+.05;sequence=(sequence+1)%65536
  local p=ns.GuildPacket(sequence,clock)
  if p then print(clock..'|['..table.concat(p,',')..']')end
 end
end
ns.UpdateGuild(clock)
`;
async function runLua(body){
  const {decodeBytes}=await import('../app/protocol.js');
  const output=execFileSync('luajit',['-e',luaPrelude+body],{cwd:root,encoding:'utf8'});
  return output.trim().split('\n').filter(Boolean).map(line=>{
    const [time,json]=line.split('|');const packet=decodeBytes(JSON.parse(json));
    assert.ok(packet,`Lua emitted invalid packet: ${json}`);return {now:Number(time)*1000,packet};
  });
}
async function feedPackets(packets){
  const {GuildFeed}=await import('../app/guild.js');const feed=new GuildFeed();
  for(const {packet,now}of packets)feed.accept(packet,now);
  return feed;
}
test('actual Lua guild packets preserve roster, primary professions, and precise locations',async()=>{
  const packets=await runLua('guildFixture.share(ns);emit(400);assert(#guildFixture.messages==0,"Sharing must default off")');
  const feed=await feedPackets(packets),now=packets.at(-1).now,members=feed.members(now);
  assert.equal(feed.guild.text,'HUZZAH Test Guild');assert.equal(members.length,4);
  const alice=members.find(m=>m.name.startsWith('Aelith'));
  assert.deepEqual(alice.professions.map(p=>p.name),['Alchemy','Herbalism']);
  assert.equal(alice.location.mapId,1429);assert.ok(Math.abs(alice.location.x-.35)<.0001);
  assert.equal(members.find(m=>m.name.startsWith('Cora')).professions,null);
  assert.equal(members.find(m=>m.name.startsWith('Borin')).location,null);
  assert.deepEqual(members.find(m=>m.name.startsWith('Éowyn')).professions.map(p=>p.name),['Blacksmithing','Mining']);
  assert.ok(!JSON.stringify(members).includes('private'));
  assert.equal(feed.members(now+31000).find(m=>m.name.startsWith('Aelith')).location,null,'pins expire without new samples');
});
test('guild comms reject nonmembers, wrong channels, wrong prefix, malformed and oversized payloads',async()=>{
  const feed=await feedPackets(await runLua(`
ns.GuildEvent('CHAT_MSG_ADDON','DAUI_GUILD1','L1:1429:123:456','WHISPER','Cora-TestRealm')
ns.GuildEvent('CHAT_MSG_ADDON','OTHER','L1:1429:123:456','GUILD','Cora-TestRealm')
ns.GuildEvent('CHAT_MSG_ADDON','DAUI_GUILD1','L1:1429:123:456','GUILD','Intruder-TestRealm')
ns.GuildEvent('CHAT_MSG_ADDON','DAUI_GUILD1','L1:1429:99999:456','GUILD','Cora-TestRealm')
ns.GuildEvent('CHAT_MSG_ADDON','DAUI_GUILD1','L1:1429:'..string.rep('1',110)..':456','GUILD','Cora-TestRealm')
ns.GuildEvent('CHAT_MSG_ADDON','DAUI_GUILD1','P1:1:999:375:171:999','GUILD','Cora-TestRealm')
emit(400)`));
  const cora=feed.members(20000).find(m=>m.name.startsWith('Cora'));
  assert.equal(cora.location,null);assert.equal(cora.professions,null);
});
test('offline, removed members, changing guilds and sharing withdrawal clear live details',async()=>{
  for(const mutation of ["guildFixture.members[2].online=false", "ns.GuildEvent('CHAT_MSG_ADDON','DAUI_GUILD1','X1','GUILD','Aelith-TestRealm')"]){
    const feed=await feedPackets(await runLua(`guildFixture.share(ns);emit(200);${mutation};ns.GuildEvent('GUILD_ROSTER_UPDATE');emit(200)`));
    const alice=feed.members(20000).find(m=>m.name.startsWith('Aelith'));assert.equal(alice.location,null);assert.equal(alice.professions,null);
  }
  const feed=await feedPackets(await runLua("guildFixture.share(ns);emit(200);table.remove(guildFixture.members,2);ns.GuildEvent('GUILD_ROSTER_UPDATE');emit(300)"));
  assert.equal(feed.members(25000).length,3);assert.ok(!feed.members(25000).some(m=>m.name.startsWith('Aelith')));
  const left=await feedPackets(await runLua("guildFixture.share(ns);emit(200);guildFixture.name=nil;ns.GuildEvent('PLAYER_GUILD_UPDATE');emit(50)"));
  assert.equal(left.guild.info.status,0);assert.deepEqual(left.members(12500),[]);
});
test('sharing is opt in, bounded to guild channel, and stops after opting out',async()=>{
  await runLua(`
emit(100);assert(#guildFixture.messages==0)
ns.SetGuildSharing(true);emit(200)
assert(#guildFixture.messages>0 and #guildFixture.messages<10)
for _,m in ipairs(guildFixture.messages)do assert(m[1]=='DAUI_GUILD1' and m[3]=='GUILD' and #m[2]<=100)end
ns.SetGuildSharing(false);assert(guildFixture.messages[#guildFixture.messages][2]=='X1')
local sent=#guildFixture.messages;emit(200);assert(#guildFixture.messages==sent)
`);
});
test('old sessions, duplicates, old revisions and invalid checksums cannot refresh guild data',async()=>{
  const packets=await runLua('guildFixture.share(ns);emit(400)'),feed=await feedPackets(packets);
  const last=packets.at(-1);
  assert.equal(feed.accept(last.packet,last.now+1000),false);
  assert.equal(feed.accept({...last.packet,session:778,sequence:65000},last.now+1000),false);
  const memberPacket=packets.find(entry=>entry.packet.kind===1).packet;
  assert.equal(feed.accept({...memberPacket,generation:(memberPacket.generation+65535)%65536,sequence:65001},last.now+1000),false);
  assert.equal(feed.isFresh(last.now+7000),false);
  const {decodeBytes,checksum}=await import('../app/protocol.js');
  const bytes=[167,6,0,0,1,3,9,0,1,0,0,2,0,4,0,1,0,0,0,0,0,0];bytes.push(...checksum(bytes));
  assert.ok(decodeBytes(bytes));bytes[11]=255;assert.equal(decodeBytes(bytes),null);
  bytes.splice(22,2,...checksum(bytes.slice(0,22)));assert.equal(decodeBytes(bytes),null);
});
test('Classic skill-line fallback reads localized professions without changing the Skills window',async()=>{
  const packets=await runLua(`
GetProfessions=nil;GetProfessionInfo=nil
GetSpellInfo=function(id)if id==2575 then return 'Bergbau'elseif id==2018 then return 'Schmiedekunst'end end
GetNumSkillLines=function()return 3 end
GetSkillLineInfo=function(i)
 if i==1 then return 'Berufe',true,true,0 end
 if i==2 then return 'Bergbau',false,nil,375 end
 return 'Schmiedekunst',false,nil,360
end
ExpandSkillHeader=function()error('Do not change the Skills window')end
CollapseSkillHeader=ExpandSkillHeader
clock=31;emit(300)
`);
  const feed=await feedPackets(packets),self=feed.members(packets.at(-1).now).find(m=>m.name.startsWith('Éowyn'));
  assert.deepEqual(self.professions.map(p=>[p.name,p.rank]),[['Blacksmithing',360],['Mining',375]]);
});
test('empty modern profession APIs fall back to Classic Enchanting and Tailoring',async()=>{
  const packets=await runLua(`
GetProfessions=function()return nil,nil end
GetNumPrimaryProfessions=function()return 2 end
GetNumSkillLines=function()return 3 end
GetSkillLineInfo=function(i)
 if i==1 then return 'Professions',true,true,0 end
 if i==2 then return 'Enchanting',false,nil,300 end
 return 'Tailoring',false,nil,280
end
clock=31;emit(300)`);
  const feed=await feedPackets(packets),self=feed.members(packets.at(-1).now).find(m=>m.name.startsWith('Éowyn'));
  assert.deepEqual(self.professions.map(p=>[p.name,p.rank]),[['Tailoring',280],['Enchanting',300]]);
});
test('profession names identify Enchanting and Tailoring when modern skill-line IDs are absent',async()=>{
  const packets=await runLua(`
GetProfessionInfo=function(i)if i==1 then return 'Enchanting',nil,300,300 else return 'Tailoring',nil,280,300 end end
clock=31;emit(300)`);
  const feed=await feedPackets(packets),self=feed.members(packets.at(-1).now).find(m=>m.name.startsWith('Éowyn'));
  assert.deepEqual(self.professions.map(p=>[p.name,p.rank]),[['Tailoring',280],['Enchanting',300]]);
});
test('collapsed Classic skill headers are restored after reading professions and after API errors',async()=>{
  for(const fail of [false,true]){
    const rows=await runLua(`
GetProfessions=function()return nil,nil end
GetNumPrimaryProfessions=function()return 2 end
local expanded=false
GetNumSkillLines=function()return expanded and 4 or 2 end
GetSkillLineInfo=function(i)
 if i==1 then return 'Professions',true,expanded,0 end
 if expanded and i==2 then ${fail?"error('Synthetic API failure after expansion')":"return 'Enchanting',false,nil,300"} end
 if expanded and i==3 then return 'Tailoring',false,nil,280 end
 return 'Languages',true,false,0
end
ExpandSkillHeader=function(i)if i==1 then expanded=true end end
CollapseSkillHeader=function(i)if i==1 then expanded=false end end
clock=31;emit(300);assert(not expanded,'Restore collapsed profession header')
`);
    const feed=await feedPackets(rows),self=feed.members(rows.at(-1).now).find(m=>m.name.startsWith('Éowyn'));
    if(fail)assert.equal(self.professions,null);
    else assert.deepEqual(self.professions.map(p=>p.name),['Tailoring','Enchanting']);
  }
});
test('temporarily empty profession data is unknown, retries promptly, and is not reported as none learned',async()=>{
  const rows=await runLua(`
GetProfessions=function()return nil,nil end
GetNumPrimaryProfessions=function()return 2 end
clock=31;emit(100)
GetProfessions=function()return 1,2 end
GetProfessionInfo=function(i)if i==1 then return 'Enchanting',nil,300,300,nil,nil,333 else return 'Tailoring',nil,280,300,nil,nil,197 end end
emit(100)
`);
  const before=await feedPackets(rows.filter(row=>row.now<36000));
  assert.equal(before.members(35000).find(m=>m.name.startsWith('Éowyn')).professions,null);
  const after=await feedPackets(rows);
  assert.deepEqual(after.members(rows.at(-1).now).find(m=>m.name.startsWith('Éowyn')).professions.map(p=>p.name),['Tailoring','Enchanting']);
});
test('empty UnitName realm and TBC Jewelcrafting still produce local profession packets',async()=>{
  const rows=await runLua(`
UnitName=function()return 'Éowyn',''end
GetProfessionInfo=function(i)if i==1 then return 'Jewelcrafting',nil,325,375,nil,nil,755 else return 'Enchanting',nil,300,375,nil,nil,333 end end
clock=31;emit(300)`);
  const feed=await feedPackets(rows),self=feed.members(rows.at(-1).now).find(m=>m.name.startsWith('Éowyn'));
  assert.deepEqual(self.professions.map(p=>p.name),['Enchanting','Jewelcrafting']);
});
