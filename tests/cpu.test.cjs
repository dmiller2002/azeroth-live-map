const test=require('node:test');
const assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const lua=body=>execFileSync('luajit',['-e',body],{cwd:root,encoding:'utf8'}).trim();

test('refresh schedules wait for events, respect the minimum gap and fall back slowly',()=>lua(`
local ns={};assert(loadfile('addon/AzerothLiveMap/Compat.lua'))('AzerothLiveMap',ns)
local s=ns.Schedule(1,10)
assert(s:Due(0),'first call refreshes')
assert(not s:Due(0.5) and not s:Due(5),'no event: no refresh before the fallback')
s:Invalidate();assert(s:Due(5),'an event refreshes on the next packet')
s:Invalidate();assert(not s:Due(5.5),'events closer together than the minimum gap wait')
assert(s:Due(6),'and refresh once the gap has passed')
assert(not s:Due(15.9) and s:Due(16),'idle feeds refresh at the fallback interval')
`));

test('bags are rescanned after bag events, not on every packet',()=>{
  const out=lua(`
local ns={QuestSession=1};local clock=0;GetTime=function()return clock end
assert(loadfile('tests/fixtures/bags.lua'))()
for _,name in ipairs({'Compat','Protocol','Bags'})do assert(loadfile('addon/AzerothLiveMap/'..name..'.lua'))('AzerothLiveMap',ns)end
local reads=0;local info=C_Container.GetContainerItemInfo
C_Container.GetContainerItemInfo=function(...)reads=reads+1;return info(...)end
local function run(seconds)for _=1,seconds*8 do clock=clock+.125;ns.BagPacket(1,clock)end end
run(20);local idle=reads
ns.InvalidateBags();run(1);local afterEvent=reads
print(idle..' '..afterEvent)`);
  const [idle,afterEvent]=out.split(' ').map(Number);
  assert.ok(idle>0,'the first packet reads the bags');
  // 64 slots exist in the fixture; one scan per 20 s instead of twenty.
  assert.ok(idle<=64,`idle bags were scanned ${idle/64} times in 20 s`);
  assert.ok(afterEvent>idle,'a bag event triggers a rescan');
});

test('the closed bank is not republished every second',()=>{
  const out=lua(`
local ns={QuestSession=777};local clock=0;AzerothLiveMapDB={};GetTime=function()return clock end;GetServerTime=function()return 1800000000+math.floor(clock)end
UnitName=function()return 'Éowyn','Test Realm'end;GetRealmName=function()return 'Test Realm'end
assert(loadfile('tests/fixtures/bags.lua'))();assert(loadfile('tests/fixtures/bank.lua'))()
for _,name in ipairs({'Compat','Protocol','Bags','Bank'})do assert(loadfile('addon/AzerothLiveMap/'..name..'.lua'))('AzerothLiveMap',ns)end
local concat,calls=table.concat,0
table.concat=function(...)calls=calls+1;return concat(...)end
for _=1,10 do clock=clock+.1;ns.BankPacket(1,clock)end
local first=calls
for _=1,300 do clock=clock+.1;ns.BankPacket(1,clock)end
print(first..' '..(calls-first))`);
  const [first,later]=out.split(' ').map(Number);
  assert.ok(later<=first,`30 closed seconds did ${later} signature builds after ${first} at startup`);
});

test('/daui cpu reports the addon cost of each part',()=>{
  const out=lua(`
assert(loadfile('tests/fixtures/tracker-frame.lua'))();local f=trackerFixture
local clock,timers,lines=0,{},{}
debugprofilestop=function()clock=clock+.25;return clock end
C_Timer={After=function(_,fn)timers[#timers+1]=fn end}
f.boot({units='px',x=12,y=12,size=3,art=false,fastSync=true})
print=function(text)lines[#lines+1]=text end
f.command('cpu 5')
for _=1,10 do f.frame.scripts.OnUpdate(f.frame,.06)end
assert(#timers==1,'one report is scheduled');timers[1]()
io.write(table.concat(lines,'\\n'))`);
  assert.match(out,/Measuring addon CPU for 5 seconds/);
  assert.match(out,/Addon CPU: [0-9.]+ ms per second, about [0-9.]+% of one CPU core/);
  assert.match(out,/Questie quest pins: [0-9.]+ ms\/s/);
  assert.match(out,/Drawing the strip\/sprite: [0-9.]+ ms\/s/);
});
