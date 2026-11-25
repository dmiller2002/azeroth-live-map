const test=require('node:test');
const {execFileSync}=require('node:child_process');
const path=require('node:path');
function run(body){
  execFileSync('luajit',['-e',"assert(loadfile('tests/fixtures/tracker-frame.lua'))();local f=trackerFixture;"+body],{cwd:path.resolve(__dirname,'..'),encoding:'utf8'});
}
test('a dragged tracker restores its physical pixel position after logout and a new login',()=>run(`
f.boot({units='px',x=1173,y=0,size=3});f.drag(1530,480,true)
f.event('PLAYER_LOGOUT');local saved=f.saved();f.boot(saved)
f.position(1530,480);assert(AzerothLiveMapDB.locked)
`));
test('closing WoW during a drag still saves the latest tracker position',()=>run(`
f.boot({units='px',x=1173,y=0,size=3});f.drag(1630,520,false)
f.event('PLAYER_LOGOUT');f.boot(f.saved());f.position(1630,520)
`));
test('temporary startup bounds and a smaller window do not overwrite the remembered position or size',()=>run(`
f.boot({units='px',x=1800,y=900,size=3})
f.width=1024;f.height=600;f.event('DISPLAY_SIZE_CHANGED')
assert(AzerothLiveMapDB.x==1800 and AzerothLiveMapDB.y==900 and AzerothLiveMapDB.size==3)
f.event('PLAYER_LOGOUT');local saved=f.saved()
f.width=0;f.height=0;f.boot(saved)
assert(AzerothLiveMapDB.x==1800 and AzerothLiveMapDB.y==900)
f.width=2560;f.height=1440;f.event('PLAYER_ENTERING_WORLD');f.position(1800,900)
`));
test('UI scale changes preserve physical position and interrupted drags save before relayout',()=>run(`
f.boot({units='px',x=1000,y=300,size=3})
f.scale=1.25;f.event('UI_SCALE_CHANGED');f.position(1000,300)
f.drag(1200,425,false);f.event('DISPLAY_SIZE_CHANGED');f.position(1200,425)
assert(AzerothLiveMapDB.x==1200 and AzerothLiveMapDB.y==425)
f.event('PLAYER_LOGOUT');f.scale=.64;f.boot(f.saved());f.position(1200,425)
`));
test('logout catches an externally moved tracker and accounts for the UI parent origin',()=>run(`
f.left=40;f.bottom=25;f.boot({units='px',x=1173,y=0,size=3})
f.frame.x=1350;f.frame.y=350
f.event('PLAYER_LOGOUT');f.boot(f.saved());f.position(1350,350)
`));
test('an explicit reset still replaces the remembered position',()=>run(`
f.boot({units='px',x=1800,y=900,size=3});f.command('reset');f.event('PLAYER_LOGOUT')
f.boot(f.saved());f.position(12,12);assert(AzerothLiveMapDB.size==3)
`));

test('sprite/strip commands preserve the sync session, speed and saved position without visible controls',()=>run(`
f.boot({units='px',x=1173,y=0,size=3,art=true,fastSync=true})
assert(not f.handle.shown and not f.frames.AzerothLiveMapModeButton)
assert(not f.frame.mouseEnabled and not f.handle.mouseEnabled)
assert(f.artVisible)
local sequence=f.positionPacket[4]*256+f.positionPacket[5]
f.command('art off')
assert(AzerothLiveMapDB.art==false and AzerothLiveMapDB.locked and AzerothLiveMapDB.fastSync)
assert(not f.artVisible and not f.handle.shown)
assert(f.positionPacket[21]==0 and f.positionPacket[18]==4)
assert(f.positionPacket[4]*256+f.positionPacket[5]>sequence)
f.position(1173,0);assert(AzerothLiveMapDB.x==1173 and AzerothLiveMapDB.y==0 and AzerothLiveMapDB.size==3)
f.event('PLAYER_LOGOUT');f.boot(f.saved())
assert(not AzerothLiveMapDB.art and not f.handle.shown)
f.command('art on');assert(AzerothLiveMapDB.art and f.artVisible and f.positionPacket[21]==225)
f.event('PLAYER_LOGOUT');f.boot(f.saved());assert(AzerothLiveMapDB.art)
`));
test('display commands finish an active drag and show the drag handle only when unlocked',()=>run(`
f.boot({units='px',x=1000,y=300,size=3,art=true});f.drag(1200,425,false)
f.command('art off');assert(not f.frame.moving and not AzerothLiveMapDB.art)
f.position(1200,425);assert(AzerothLiveMapDB.x==1200 and AzerothLiveMapDB.y==425)
f.command('art on');assert(f.artVisible)
f.command('hide');assert(not f.frame.shown and not f.handle.shown)
f.command('show');assert(f.frame.shown and f.handle.shown)
`));
test('the unlocked drag handle stays outside encoded pixels and fits at screen edges',()=>run(`
f.boot({units='px',x=2500,y=1400,size=3,art=true})
local anchor=f.handle.anchor
assert(anchor.relative=='TOPLEFT' and anchor.point=='BOTTOMLEFT' and anchor.y==4)
local hp=f.pixels(f.handle)
assert(f.frame.x+anchor.x*hp>=0 and f.frame.x+(anchor.x+f.handle.width)*hp<=f.width)
f.command('unlock');anchor=f.handle.anchor
assert(f.handle.mouseEnabled and f.handle.width==200)
assert(f.frame.x+anchor.x*hp>=0 and f.frame.x+(anchor.x+f.handle.width)*hp<=f.width)
f.command('art off');anchor=f.handle.anchor
assert((anchor.relative=='TOPLEFT' and anchor.y==4)or(anchor.relative=='BOTTOMLEFT' and anchor.y==-4))
`));

test('unlocked sync artwork and data lanes stay click-through while the handle still moves and saves them',()=>run(`
-- Use the real artwork frames as well as Main.lua's four data lanes. A visible
-- mouse target anywhere in this overlay can swallow a minimap button's click.
MinimapCluster=setmetatable({},{__index=function()error('Default sync must leave the minimap alone')end})
f.boot({units='px',x=2300,y=20,size=2},true)
local function checkInput()
 for _,frame in ipairs(f.createdFrames)do
  if frame~=f.handle then assert(not frame.mouseEnabled,'Sync overlay intercepted clicks: '..tostring(frame.name))end
 end
 assert(f.handle.mouseEnabled==not AzerothLiveMapDB.locked)
end
checkInput()
f.command('unlock');checkInput()
for _,command in ipairs({'art off','sync compact','art on','size 3','sync fast'})do
 f.command(command);checkInput()
end
f.drag(2200,350,true);checkInput();f.position(2200,350)
f.event('UI_SCALE_CHANGED');checkInput()
f.command('lock');checkInput()
f.event('PLAYER_LOGOUT');f.boot(f.saved(),true)
f.position(2200,350);checkInput()
assert(f.positionPacket and AzerothLiveMapDB.locked)
`));

test('fast sync emits 20 visible blocks and 80 data packets per second in both display modes',()=>run(`
for _,art in ipairs({true,false})do
 f.boot({units='px',x=1000,y=300,size=3,art=art,fastSync=true})
 local positions,packets=f.positionWrites,f.auxiliaryWrites
 for i=1,60 do f.frame.scripts.OnUpdate(f.frame,1/60)end
 assert(f.positionWrites-positions==20,'Fast sync must keep fractional frame time and emit 20 updates/sec')
 assert(f.auxiliaryWrites-packets==80,'Fast sync must emit 80 auxiliary packets/sec')
 f.position(1000,300)
end
`));
test('compact sync retains its lower rate and slow game frames never emit invisible catch-up blocks',()=>run(`
f.boot({units='px',art=true,fastSync=false})
local positions,packets=f.positionWrites,f.auxiliaryWrites
for i=1,60 do f.frame.scripts.OnUpdate(f.frame,1/60)end
assert(f.positionWrites-positions==10 and f.auxiliaryWrites-packets==10)
f.command('sync fast');positions=f.positionWrites
f.frame.scripts.OnUpdate(f.frame,1)
assert(f.positionWrites==positions+1,'A one-second stall must emit only the block visible on that frame')
f.frame.scripts.OnUpdate(f.frame,0)
assert(f.positionWrites==positions+1,'No catch-up block may be emitted without new frame time')
for i=1,10 do f.frame.scripts.OnUpdate(f.frame,.05)end
assert(f.positionWrites==positions+11)
f.event('PLAYER_LOGOUT');f.boot(f.saved());assert(AzerothLiveMapDB.fastSync)
`));

test('1.0.3 positions saved in UI units migrate once to the same physical pixels',()=>run(`
-- 2560x1440: one UI unit at effective scale 1 is 1440/768 = 1.875 pixels.
f.boot({x=640,y=384,size=2,art=false})
assert(AzerothLiveMapDB.units=='px')
f.position(1200,720);assert(AzerothLiveMapDB.x==1200 and AzerothLiveMapDB.y==720)
assert(AzerothLiveMapDB.size==4,'Size 2 UI units becomes the nearest whole pixel size')
f.event('PLAYER_LOGOUT');f.boot(f.saved());f.position(1200,720);assert(AzerothLiveMapDB.size==4)
`));
test('each data bit covers whole physical pixels at any UI scale and resolution',()=>run(`
for _,mode in ipairs({{2560,1440,.8},{1920,1080,1},{3840,2160,.71},{1366,768,1.15}})do
 f.width,f.height,f.scale=mode[1],mode[2],mode[3]
 f.boot({units='px',x=50,y=50,art=false})
 assert(math.abs(f.pixels(f.frame)-1)<1e-9,'Strip units must equal physical pixels')
 local size=AzerothLiveMapDB.size
 assert(size==math.floor(size) and size>=3,'Default bit size must be a whole number of pixels')
 assert(math.abs(f.pixels(f.handle)-f.scale*f.height/768)<1e-9,'The handle keeps normal UI size')
 f.command('size 2');assert(AzerothLiveMapDB.size>=2)
 if f.width>2560 then assert(AzerothLiveMapDB.size>=3,'4K captures are downscaled for the strip search') end
 f.command('size 99');assert(AzerothLiveMapDB.size==24)
end
`));
test('unchanged bits are not repainted between updates',()=>run(`
f.boot({units='px',x=50,y=50,art=false,fastSync=true})
local writes=0
local set=getmetatable(f.frame).__index.SetColorTexture
getmetatable(f.frame).__index.SetColorTexture=function(self,...)writes=writes+1 end
f.frame.scripts.OnUpdate(f.frame,.05)
getmetatable(f.frame).__index.SetColorTexture=set
-- Five 192-bit blocks; only bits that differ (sequence, clock, checksum, ...) are written.
assert(writes>0 and writes<200,'Expected only changed bits to be repainted, got '..writes)
`));
