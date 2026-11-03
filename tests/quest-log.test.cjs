const test=require('node:test');
const assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const prelude=`local ns={QuestSession=777};local clock=0
GetTime=function()return clock end
assert(loadfile('tests/fixtures/quest-log.lua'))()
assert(loadfile('addon/AzerothLiveMap/Compat.lua'))('AzerothLiveMap',ns)
assert(loadfile('addon/AzerothLiveMap/Protocol.lua'))('AzerothLiveMap',ns)
assert(loadfile('addon/AzerothLiveMap/QuestLog.lua'))('AzerothLiveMap',ns)
local sequence=0
local function emit(count)
 for i=1,count do
  clock=clock+.05;sequence=(sequence+1)%65536
  local p=ns.QuestLogPacket(sequence,clock)
  if p then print(clock..'|['..table.concat(p,',')..']')end
 end
end
`;
async function packets(body){
  const {decodeBytes}=await import('../app/protocol.js');
  const output=execFileSync('luajit',['-e',prelude+body],{cwd:root,encoding:'utf8',maxBuffer:4*1024*1024});
  return output.trim().split('\n').filter(Boolean).map(line=>{
    const [time,bytes]=line.split('|'),packet=decodeBytes(JSON.parse(bytes));assert.ok(packet,`Invalid Lua packet: ${bytes}`);
    return {now:Number(time)*1000,packet};
  });
}
async function feedFrom(rows){
  const {QuestLogFeed}=await import('../app/quest-log.js');const feed=new QuestLogFeed();
  for(const {packet,now}of rows)feed.accept(packet,now);
  return feed;
}
test('real addon packets carry readable quest text, zone groups, watch state and objective progress without Questie',async()=>{
  const feed=await feedFrom(await packets('emit(900);assert(questLogFixture.selection==4,"Restore the in-game selection")'));
  assert.equal(feed.summary.count,3);assert.equal(feed.quests().length,3);
  const quest=feed.quest(900101);
  assert.equal(quest.title,'A Watch on the Ridge');assert.equal(quest.category,'Elwynn Forest');assert.equal(quest.watched,true);
  assert.match(quest.overview,/Captain Élan/);assert.match(quest.description,/\n\nTake the eastern path/);
  assert.deepEqual(quest.objectives.map(o=>[o.text,o.finished,o.fulfilled,o.required]),[['Ridge scouts found: 1/4',false,1,4],['Signal stones recovered: 3/3',true,3,3]]);
  assert.equal(feed.quest(900102).complete,true);assert.equal(feed.quest(900103).failed,true);
});
test('progress and completion changes arrive while long quest text is still being streamed',async()=>{
  const rows=await packets(`questLogFixture.quests[1].description=string.rep('A long road through the valley. ',200)
emit(30)
questLogFixture.quests[1].objectives[1].text='Ridge scouts found: 4/4'
questLogFixture.quests[1].objectives[1].finished=true
questLogFixture.quests[1].objectives[1].numFulfilled=4
questLogFixture.quests[1].complete=1
ns.InvalidateQuestLog('QUEST_LOG_UPDATE');emit(600)`);
  const feed=await feedFrom(rows),quest=feed.quest(900101);
  assert.equal(quest.complete,true);assert.equal(quest.objectives[0].fulfilled,4);assert.equal(quest.objectives[0].text,'Ridge scouts found: 4/4');
  assert.equal(quest.description,null,'Long story can keep syncing without blocking live progress');
});
test('quest removal, an empty log and a different character cannot retain previous quest details',async()=>{
  const removed=await feedFrom(await packets("emit(700);table.remove(questLogFixture.quests,1);ns.InvalidateQuestLog('QUEST_LOG_UPDATE');emit(500)"));
  assert.equal(removed.quest(900101),undefined);assert.equal(removed.summary.count,2);assert.equal(removed.quest(900102).title,'A Letter for Home');
  const empty=await feedFrom(await packets("emit(400);questLogFixture.quests={};ns.InvalidateQuestLog('QUEST_LOG_UPDATE');emit(50)"));
  assert.equal(empty.summary.count,0);assert.deepEqual(empty.quests(),[]);
  removed.reset();assert.deepEqual(removed.quests(),[]);
});
test('out-of-order text fragments reassemble UTF-8 and older revisions or foreign sessions are rejected',async()=>{
  const rows=await packets('emit(900)'),{QuestLogFeed}=await import('../app/quest-log.js');
  const feed=new QuestLogFeed(),manifest=rows.find(({packet})=>packet.kind===0);
  feed.accept(manifest.packet,manifest.now);
  const metadata=rows.filter(({packet})=>packet.kind!==0 && packet.kind!==2),fragments=rows.filter(({packet})=>packet.kind===2);
  for(const {packet,now}of [...metadata,...fragments.reverse()])feed.accept(packet,now);
  assert.match(feed.quest(900101).description,/Captain Élan/);
  const entry=metadata.find(({packet})=>packet.kind===1).packet;
  assert.equal(feed.accept({...entry,session:778,sequence:65000},50000),false);
  assert.equal(feed.accept({...entry,generation:(entry.generation+65535)%65536,sequence:65001},50000),false);
  assert.equal(feed.isFresh(100000),false);
});
test('API errors restore quest selection and loading screens suppress misleading stale log details',async()=>{
  const failed=await feedFrom(await packets('questLogFixture.fail=true;emit(50);assert(questLogFixture.selection==4)'));
  assert.equal(failed.summary.status,2);assert.deepEqual(failed.quests(),[]);
  const loading=await feedFrom(await packets("emit(500);ns.InvalidateQuestLog('LOADING_SCREEN_ENABLED');emit(30)"));
  assert.equal(loading.summary.status,2);assert.deepEqual(loading.quests(),[]);
  const resumed=await feedFrom(await packets("emit(300);ns.InvalidateQuestLog('LOADING_SCREEN_ENABLED');emit(30);ns.InvalidateQuestLog('PLAYER_ENTERING_WORLD');emit(500)"));
  assert.equal(resumed.summary.status,1);assert.equal(resumed.quest(900101).title,'A Watch on the Ridge');
});
test('text bounds are UTF-8 safe, explicit, and do not treat quest prose as HTML',async()=>{
  const feed=await feedFrom(await packets("questLogFixture.quests[1].description='<b>Read as text</b> '..string.rep('É',6500);emit(4500)"));
  const quest=feed.quest(900101);
  assert.equal(quest.limited,true);assert.ok(Buffer.byteLength(quest.description)<=12288);assert.ok(!quest.description.includes('\uFFFD'));
  assert.match(quest.description,/^<b>Read as text<\/b>/);
});
test('Questie tracking preferences take precedence while unavailable Questie APIs fall back to the native watch list',async()=>{
  const tracked=await feedFrom(await packets("QuestieLoader={ImportModule=function()return {IsTrackedByQuestie=function(id)return id==900102 end}end};emit(900)"));
  assert.equal(tracked.quest(900101).watched,false);assert.equal(tracked.quest(900102).watched,true);
  const fallback=await feedFrom(await packets("QuestieLoader={ImportModule=function()error('Questie is still loading')end};emit(900)"));
  assert.equal(fallback.quest(900101).watched,true);assert.equal(fallback.quest(900102).watched,false);
});

test('accepting and reordering quests preserve every existing slot, story and objective on every packet',async()=>{
  const rows=await packets(`emit(900)
table.insert(questLogFixture.quests,1,{id=900104,title='A New Trail',category='Elwynn Forest',level=62,description='Follow the fresh tracks.',overview='Find the tracks.',objectives={}})
ns.InvalidateQuestLog('QUEST_ACCEPTED');emit(200)`);
  const {QuestLogFeed}=await import('../app/quest-log.js'),feed=new QuestLogFeed();
  let before,records;
  for(let i=0;i<rows.length;i++){
    const {packet,now}=rows[i];feed.accept(packet,now);
    if(i===899){before=feed.quests();records=new Map(feed.records);}
    if(i>=900){
      for(const quest of before){
        const content=value=>JSON.parse(JSON.stringify(value,(key,item)=>key==='sequence'?undefined:item));
        assert.deepEqual(content(feed.quest(quest.questId)),content(quest),'An unrelated quest must stay fully readable throughout the update');
        assert.equal(feed.records.get(quest.slot),records.get(quest.slot));
        assert.equal(feed.records.get(128+quest.slot),records.get(128+quest.slot));
      }
    }
  }
  assert.equal(feed.summary.count,4);assert.equal(feed.quest(900104).description,'Follow the fresh tracks.');
  assert.equal(feed.quest(900104).slot,4,'Insertion in WoW must not renumber existing sync slots');
});

test('accepting a quest preserves an in-flight long description and promptly sends the new quest text',async()=>{
  const rows=await packets(`questLogFixture.quests[1].description=string.rep('A long road. ',800);emit(100)
table.insert(questLogFixture.quests,{id=900104,title='Fresh Tracks',category='Elwynn Forest',level=62,description='New quest story.',overview='Find the trail.',objectives={}})
ns.InvalidateQuestLog('QUEST_ACCEPTED');emit(2400)`);
  const {QuestLogFeed}=await import('../app/quest-log.js'),feed=new QuestLogFeed();let old,parts=0,newAt;
  for(let i=0;i<rows.length;i++){
    const {packet,now}=rows[i];feed.accept(packet,now);
    if(i===99)old=feed.records.get(129);
    if(i>=100){
      assert.equal(feed.records.get(129),old,'Unchanged text must keep its fragment buffer');
      assert.ok(old.parts.size>=parts);parts=old.parts.size;
      if(!newAt && feed.quest(900104)?.description==='New quest story.')newAt=i-100;
    }
  }
  assert.ok(newAt<100,`New text should be prioritized, received after ${newAt} packets`);
  assert.equal(feed.quest(900101).description.length,10400);
});

test('slot reuse and fragments arriving before metadata never attach another quest story or revive a removed quest',async()=>{
  const rows=await packets(`emit(900)
table.remove(questLogFixture.quests,1)
table.insert(questLogFixture.quests,{id=900104,title='A Different Story',category='Elwynn Forest',level=63,description='Only the new story belongs here.',overview='New objective.',objectives={}})
ns.InvalidateQuestLog('QUEST_REMOVED');emit(300)`);
  const {QuestLogFeed}=await import('../app/quest-log.js'),feed=new QuestLogFeed();
  for(const {packet,now}of rows.slice(0,900))feed.accept(packet,now);
  const old=feed.quest(900101),oldPackets=rows.slice(0,900).filter(({packet})=>packet.index===1 || packet.index===129);
  const changes=rows.slice(900),root=changes.find(({packet:p})=>p.kind===1 && p.questId===900104),body=changes.find(({packet:p})=>p.kind===4 && p.index===129);
  for(const {packet,now}of changes.filter(({packet:p})=>p.kind===2 && p.index===129))feed.accept(packet,now);
  assert.equal(feed.quest(900101).description,old.description,'Unidentified fragments must not replace the old story');
  feed.accept(root.packet,root.now);assert.equal(feed.quest(900101),undefined);
  assert.equal(feed.quest(900104).description,null,'The old description belongs to a different slot identity');
  feed.accept(body.packet,body.now);assert.equal(feed.quest(900104).description,'Only the new story belongs here.');
  for(const {packet}of oldPackets)feed.accept({...packet,sequence:50000+packet.sequence},60000);
  assert.equal(feed.quest(900101),undefined);assert.equal(feed.quest(900104).description,'Only the new story belongs here.');
});

test('legacy v7 quest logs remain readable after the incremental protocol update',async()=>{
  const rows=await packets(`local encode=ns.EncodeQuest
ns.EncodeQuest=function(k,s,m,g,i,p)return encode(k,s,m,g,i,p,7)end
questLogFixture.quests={questLogFixture.quests[1]};emit(700)`);
  assert.ok(rows.every(({packet})=>packet.version===7));
  const feed=await feedFrom(rows);assert.match(feed.quest(900101).description,/Captain Élan/);
});

test('abandoning a quest only removes its own slot and leaves remaining stories intact on every packet',async()=>{
  const rows=await packets("emit(900);table.remove(questLogFixture.quests,1);ns.InvalidateQuestLog('QUEST_REMOVED');emit(200)");
  const {QuestLogFeed}=await import('../app/quest-log.js'),feed=new QuestLogFeed();let stories;
  for(let i=0;i<rows.length;i++){
    const {packet,now}=rows[i];feed.accept(packet,now);
    if(i===899)stories=[900102,900103].map(id=>feed.quest(id));
    if(i>=900)for(const old of stories){
      const quest=feed.quest(old.questId);assert.ok(quest);assert.equal(quest.description,old.description);assert.equal(quest.slot,old.slot);assert.equal(quest.title,old.title);
    }
  }
  assert.equal(feed.quest(900101),undefined);assert.equal(feed.summary.count,2);
});
