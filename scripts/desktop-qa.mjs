// Run the real Electron app with an isolated profile and synthetic addon capture.
// This test never opens the OS screen picker or captures the user's desktop.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL('../', import.meta.url));
const profile = await mkdtemp(path.join(tmpdir(), 'drunks-companion-qa-'));
const executable = process.env.COMPANION_EXECUTABLE || require('electron');
const args = process.env.COMPANION_EXECUTABLE ? [] : [root];
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const artifacts = path.join(root, 'artifacts');
await mkdir(artifacts, { recursive: true });
let child, socket, serial = 0, output = '';
const pending = new Map(), errors = [], blocked = [];
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++serial;
  const timer = setTimeout(() => { pending.delete(id); reject(new Error('CDP timeout: ' + method)); }, 20000);
  pending.set(id, { resolve, reject, timer }); socket.send(JSON.stringify({ id, method, params }));
});
const evaluate = async expression => {
  const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, userGesture: true });
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
  return result.result.value;
};
const until = async (expression, label, timeout = 25000) => {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { if (await evaluate(expression)) return; await wait(100); }
  throw new Error('Timed out: ' + label + '\n' + await evaluate("document.getElementById('status')?.textContent"));
};

async function start() {
  await rm(path.join(profile, 'DevToolsActivePort'), { force: true });
  child = spawn(executable, [...args, '--remote-debugging-port=0', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'], { cwd: root, env: { ...process.env, COMPANION_USER_DATA: profile }, stdio: ['ignore', 'pipe', 'pipe'] });
  output = '';
  child.stdout.on('data', chunk => { output += chunk; }); child.stderr.on('data', chunk => { output += chunk; });
  let port;
  for (let i = 0; i < 150; i++) {
    if (child.exitCode !== null) throw new Error('Electron exited: ' + output);
    try { port = Number((await readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]); if (port) break; } catch { /* Startup. */ }
    await wait(100);
  }
  assert.ok(port, 'Electron must open its debugging endpoint: ' + output);
  let target;
  for (let i = 0; i < 100; i++) {
    const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    target = targets.find(item => item.type === 'page' && item.url.startsWith('azeroth://companion/'));
    if (target) break;
    await wait(100);
  }
  assert.ok(target, 'The bundled companion window must open: ' + output);
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (message.id) {
      const request = pending.get(message.id); if (!request) return;
      pending.delete(message.id); clearTimeout(request.timer);
      message.error ? request.reject(new Error(JSON.stringify(message.error))) : request.resolve(message.result);
    } else if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails);
    else if (message.method === 'Log.entryAdded' && /content security policy/i.test(message.params.entry.text)) blocked.push(message.params.entry.text);
  });
  await send('Runtime.enable'); await send('Page.enable'); await send('Log.enable');
  await until("document.querySelectorAll('#zone option').length === 59 && window.companion && !document.getElementById('ui-scale').disabled", 'application readiness');
}

async function close() {
  const process = child;
  await send('Page.close');
  for (let i = 0; i < 100 && process.exitCode === null; i++) await wait(100);
  assert.equal(process.exitCode, 0, 'Closing the window must exit cleanly: ' + output);
  socket.close(); socket = null; child = null;
}

try {
  await start();
  assert.equal(await evaluate('isSecureContext'), true);
  assert.match(await evaluate('document.title'), /WoW Forever Edition/);
  assert.equal(await evaluate("document.querySelector('.edition').textContent.trim()"),'WOW FOREVER EDITION');
  assert.equal(await evaluate('typeof require'), 'undefined'); assert.equal(await evaluate('typeof process'), 'undefined');
  assert.deepEqual(await evaluate('Object.keys(window.companion).sort()'), ['checkForUpdates', 'downloadUpdate', 'getUIScale', 'getUpdateState', 'installUpdate', 'onUIScaleChanged', 'onUpdateChanged', 'openReleases', 'saveAddon', 'setUIScale', 'version']);
  const updatePhase = await evaluate("(async()=> (await window.companion.getUpdateState()).phase)()");
  assert.ok(['idle', 'unsupported'].includes(updatePhase));
  assert.equal(await evaluate("document.getElementById('companion-update').textContent"), updatePhase === 'idle' ? 'Check for updates' : 'Packaged app required');
  assert.equal(await evaluate("document.getElementById('status').textContent"), 'Not connected');
  assert.equal(await evaluate("document.getElementById('sidebar-sync-text').textContent"),'Sync · Offline');
  assert.equal(await evaluate("document.getElementById('install-app')"), null);
  assert.equal(await evaluate("document.querySelector('#controls-panel .quest-panel')"),null);
  assert.equal(await evaluate("document.getElementById('setup')"),null);
  assert.equal(await evaluate("document.getElementById('demo')"),null);
  for(const [theme,background]of [['light','rgb(244, 245, 239)'],['dark','rgb(16, 17, 20)'],['original','rgb(17, 24, 23)']]){
    await evaluate(`document.querySelector('.theme-options [data-theme="${theme}"]').click()`);
    assert.equal(await evaluate('document.documentElement.dataset.theme'),theme);
    assert.equal(await evaluate('getComputedStyle(document.body).backgroundColor'),background);
    assert.equal(await evaluate("document.querySelectorAll('.theme-options [aria-pressed=true]').length"),1);
    if(theme==='light')assert.equal(await evaluate("getComputedStyle(document.getElementById('map-title')).color"),'rgb(62, 50, 28)','Map heading must remain readable on the light background');
  }
  const basePixelRatio = await evaluate('devicePixelRatio');
  await evaluate("document.getElementById('ui-scale').click()");
  assert.equal(await evaluate("document.getElementById('ui-scale-dialog').open"), true);
  await evaluate("document.getElementById('ui-scale-slider').value='125';document.getElementById('ui-scale-slider').dispatchEvent(new Event('input'));document.getElementById('ui-scale-slider').dispatchEvent(new Event('change'))");
  await until("document.getElementById('ui-scale').textContent.includes('125%')", 'UI scale applied');
  await until(`Math.abs(devicePixelRatio / ${basePixelRatio} - 1.25) < 0.02`, 'native interface rendering at 125%');
  const scaleShot = await send('Page.captureScreenshot'); await writeFile(path.join(artifacts, 'desktop-ui-scale.png'), Buffer.from(scaleShot.data, 'base64'));
  await evaluate("document.getElementById('ui-scale-more').click()");
  await until("document.getElementById('ui-scale-value').value === '130%'", 'scale increase');
  await evaluate("document.getElementById('ui-scale-less').click()");
  await until("document.getElementById('ui-scale-value').value === '125%'", 'scale decrease');
  for (const value of [50, 200]) {
    await evaluate(`window.companion.setUIScale(${value})`);
    await until(`document.getElementById('ui-scale-value').value === '${value}%'`, 'scale endpoint');
    assert.ok(await evaluate("(() => { const r=document.getElementById('ui-scale-reset').getBoundingClientRect();return r.left>=0 && r.right<=innerWidth && r.top>=0 && r.bottom<=innerHeight; })()"), 'The reset control must remain reachable at both scale limits');
  }
  await evaluate("document.getElementById('ui-scale-reset').click()");
  await until("document.getElementById('ui-scale-value').value === '100%'", 'scale reset');
  for (const [key, code, keyCode, expected] of [['=', 'Equal', 187, 105], ['-', 'Minus', 189, 100], ['-', 'Minus', 189, 95], ['0', 'Digit0', 48, 100]]) {
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, modifiers: 2, windowsVirtualKeyCode: keyCode });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, modifiers: 2, windowsVirtualKeyCode: keyCode });
    await until(`document.getElementById('ui-scale-value').value === '${expected}%'`, `keyboard scale shortcut ${key}, expected ${expected}%`);
  }
  await evaluate("document.getElementById('close-ui-scale').click()");
  // Device emulation pins devicePixelRatio, so enable it only after checking
  // Electron's native zoom on the real window dimensions.
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  const expandedWidth = await evaluate("document.querySelector('main').getBoundingClientRect().width");
  await evaluate("document.getElementById('collapse-sidebar').focus();document.getElementById('collapse-sidebar').click()");
  assert.equal(await evaluate("getComputedStyle(document.getElementById('controls-panel')).display"), 'none');
  assert.equal(await evaluate("document.getElementById('controls-panel').inert"), true);
  assert.equal(await evaluate("document.activeElement.id"), 'toggle-controls', 'Focus must move to the visible reopen control');
  assert.equal(await evaluate("document.getElementById('toggle-controls').getAttribute('aria-expanded')"), 'false');
  assert.equal(await evaluate("document.getElementById('toggle-controls').textContent"), 'Show sidebar');
  assert.equal(await evaluate("document.getElementById('quick-connection').hidden"), false);
  assert.ok(await evaluate("document.querySelector('main').getBoundingClientRect().width") >= expandedWidth + 245, 'Collapsing the sidebar must reclaim its width');
  for (const name of ['character', 'bags', 'guild', 'updates', 'map']) {
    await evaluate(`document.getElementById('tab-${name}').click()`);
    assert.equal(await evaluate("getComputedStyle(document.getElementById('controls-panel')).display"), 'none', 'All tabs retain the expanded main view');
  }
  const sidebarShot = await send('Page.captureScreenshot'); await writeFile(path.join(artifacts, 'desktop-sidebar-collapsed.png'), Buffer.from(sidebarShot.data, 'base64'));
  await evaluate("document.getElementById('toggle-controls').click()");
  assert.equal(await evaluate("document.getElementById('controls-panel').inert"), false);
  assert.equal(await evaluate("document.querySelector('main').getBoundingClientRect().width"), expandedWidth);
  // Observe the real draw calls so coverage checks include the renderer and its
  // resize handling, rather than only testing the viewport math in isolation.
  await evaluate(`(() => {
    const original=CanvasRenderingContext2D.prototype.drawImage;
    CanvasRenderingContext2D.prototype.drawImage=function(source,...args){
      if(source instanceof HTMLVideoElement)window.__captureDecode={width:this.canvas.width,height:this.canvas.height};
      if(this.canvas.id==='map' && (source instanceof HTMLImageElement || source instanceof HTMLCanvasElement) && !source?.dataset?.questMarker && args.length===4){
        const box=document.getElementById('map-stage').getBoundingClientRect();
        window.__mapDraw={x:args[0],y:args[1],w:args[2],h:args[3],imageWidth:source.naturalWidth||source.width,imageHeight:source.naturalHeight||source.height,boxWidth:box.width,boxHeight:box.height};
      }
      if(this.canvas.id==='map' && source?.dataset?.questMarker){
        window.__pinDrawCount=(window.__pinDrawCount||0)+1;
        const transform=this.getTransform();
        window.__questDraws ||= {};
        window.__questDraws[source.dataset.questMarker]={x:transform.e,y:transform.f,w:args[2],h:args[3],alpha:this.globalAlpha};
      }
      return original.call(this,source,...args);
    };
    const clear=CanvasRenderingContext2D.prototype.clearRect;
    CanvasRenderingContext2D.prototype.clearRect=function(...args){
      if(this.canvas.id==='map'){
        if(window.__syncRegression && window.__pinDrawCount<13)window.__syncRegression.push('Existing map pins disappeared');
        window.__pinDrawCount=0;window.__guildDraws=[];
      }
      return clear.apply(this,args);
    };
    const fill=CanvasRenderingContext2D.prototype.fill;
    CanvasRenderingContext2D.prototype.fill=function(...args){
      if(this.canvas.id==='map' && this.fillStyle==='#8bc9ff'){
        const transform=this.getTransform();window.__guildDraw={x:transform.e,y:transform.f};(window.__guildDraws ||= []).push(window.__guildDraw);
      }
      return fill.apply(this,args);
    };
    document.getElementById('fit').click();
  })()`);
  const assertMapFill = async label => {
    await until("window.__mapDraw && document.getElementById('map-message').hidden && (()=>{const v=window.__mapDraw;return v.x<=.01 && v.y<=.01 && v.x+v.w>=v.boxWidth-.01 && v.y+v.h>=v.boxHeight-.01;})()", label);
    const view=await evaluate('window.__mapDraw');
    assert.ok(Math.abs(view.w/view.h-view.imageWidth/view.imageHeight)<.00001,'Map artwork must keep its proportions');
  };
  for (const [width,height] of [[1440,1000],[1800,720],[900,1000],[1440,1000]]) {
    await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
    await wait(200);await assertMapFill('map box coverage after resizing');
  }
  const filledMap=await send('Page.captureScreenshot');await writeFile(path.join(artifacts,'desktop-map-fill.png'),Buffer.from(filledMap.data,'base64'));
  await evaluate("document.getElementById('split-view-toggle').click()");
  await wait(200);await assertMapFill('map box coverage in split view');
  const splitMap=await send('Page.captureScreenshot');await writeFile(path.join(artifacts,'desktop-map-fill-split.png'),Buffer.from(splitMap.data,'base64'));
  await evaluate("document.getElementById('whole-map').click()");
  await until("document.getElementById('whole-map').getAttribute('aria-pressed')==='true'", 'Whole map control');
  for (const width of [1180,1440]) {
    await send('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:false});
    await wait(200);
    const view=await evaluate('window.__mapDraw');
    assert.ok(view.x>=-.01 && view.y>=-.01 && view.x+view.w<=view.boxWidth+.01 && view.y+view.h<=view.boxHeight+.01,'Whole map must retain all artwork after a pane resize');
  }
  await evaluate("document.getElementById('fit').click();document.getElementById('zoom-in').click()");
  await assertMapFill('zoomed map coverage');
  const dragPoint=await evaluate("(()=>{const r=document.getElementById('map').getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2,endX:r.right-12,endY:r.bottom-75};})()");
  await send('Input.dispatchMouseEvent',{type:'mousePressed',x:dragPoint.x,y:dragPoint.y,button:'left',clickCount:1});
  await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:dragPoint.endX,y:dragPoint.endY,button:'left',buttons:1});
  await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:dragPoint.endX,y:dragPoint.endY,button:'left',clickCount:1});
  await assertMapFill('map coverage after dragging to the edge');
  await evaluate("document.getElementById('split-view-toggle').click();document.getElementById('zone').value='1415';document.getElementById('zone').dispatchEvent(new Event('change'))");
  await until("document.getElementById('zone').value==='1415' && document.getElementById('map-message').hidden", 'continent map load');
  await evaluate("document.getElementById('whole-map').click()");
  await wait(100);
  // Offline browsing uses the picker; geographic hit targets arrive from WoW
  // and are exercised with real native packets in map-qa.mjs.
  await evaluate("document.getElementById('zone').value='1429';document.getElementById('zone').dispatchEvent(new Event('change'))");
  await until("document.getElementById('zone').value==='1429' && document.getElementById('map-message').hidden",'offline zone navigation');
  await evaluate("document.getElementById('follow').checked=true;document.getElementById('follow').dispatchEvent(new Event('change'));document.getElementById('fit').click()");
  await assertMapFill('default fill after navigation');
  assert.equal(await evaluate("(async () => (await fetch('/_model/https://example.com')).status)()"), 404);
  assert.equal(await evaluate("(async () => (await fetch('/desktop/main.cjs')).status)()"), 404);
  for (const view of ['character', 'bags', 'guild', 'updates', 'map']) {
    await evaluate(`document.getElementById('tab-${view}').click()`);
    assert.equal(await evaluate(`document.getElementById('tab-${view}').getAttribute('aria-selected')`), 'true');
  }

  // Plain and artwork transports use the actual addon encoders, with synthetic game APIs.
  for (const id of [1412,1423,1433,1453,2482,2521,2524,2548,2652]) {
    await evaluate(`document.getElementById('zone').value='${id}';document.getElementById('zone').dispatchEvent(new Event('change'))`);
    await until("document.getElementById('map-message').hidden && document.getElementById('map-type').textContent.includes('WOW FOREVER')", 'native Forever map artwork');
    assert.equal(await evaluate('window.__mapDraw.imageWidth'),1024);
  }
  for (const id of [2665]) {
    await evaluate(`document.getElementById('zone').value='${id}';document.getElementById('zone').dispatchEvent(new Event('change'))`);
    await until("document.getElementById('map-type').textContent.includes('COORDINATE GRID') && document.getElementById('map-message').textContent.includes('native Forever coordinates')", 'new Forever zone coordinate grid');
  }
  const gridShot=await send('Page.captureScreenshot');await writeFile(path.join(artifacts,'desktop-forever-grid.png'),Buffer.from(gridShot.data,'base64'));
  await evaluate("document.getElementById('zone').value='1429';document.getElementById('zone').dispatchEvent(new Event('change'))");
  await until("document.getElementById('map-message').hidden", 'return from Forever map grid');
  const lua = `local ns={};local clock=0;GetTime=function()return clock end;GetBuildInfo=function()return '1.60.1','69977','',16001 end
for _,name in ipairs({'Compat','Protocol','QuestStream','Questie','QuestLog','Character','Bags','Guild'})do assert(loadfile('addon/AzerothLiveMap/'..name..'.lua'))('AzerothLiveMap',ns)end
assert(loadfile('tests/fixtures/character.lua'))();assert(loadfile('tests/fixtures/bags.lua'))();assert(loadfile('tests/fixtures/guild.lua'))();assert(loadfile('tests/fixtures/quest-log.lua'))();questLogFixture.questie();ns.QuestSession=777;AzerothLiveMapDB={}
-- Classic can expose empty modern profession APIs even with learned skills.
GetProfessions=function()return nil,nil end;GetNumPrimaryProfessions=function()return 2 end
GetNumSkillLines=function()return 3 end
GetSkillLineInfo=function(i)if i==1 then return 'Professions',true,true,0 elseif i==2 then return 'Enchanting',false,nil,300 else return 'Tailoring',false,nil,280 end end
local seq,aux=0,0
for frame=1,1800 do clock=frame*.05;seq=seq+1
if frame==601 then
 table.insert(questLogFixture.quests,1,{id=900104,title='Fresh Tracks',category='Elwynn Forest',level=62,description='Follow the fresh tracks along the ridge.',overview='Find the trail.',objectives={}})
 _G.NewQuestPin={data={Type='monster',Icon=1,QuestData={name='Fresh Tracks'}},miniMapIcon=false,UiMapID=1429,x=25,y=60}
 QuestieLoader:ImportModule('QuestieMap').questIdFrames[900104]={'NewQuestPin'}
 ns.InvalidateQuestLog('QUEST_ACCEPTED')
elseif frame==1201 then
 table.remove(questLogFixture.quests,1);QuestieLoader:ImportModule('QuestieMap').questIdFrames[900104]=nil
 ns.InvalidateQuestLog('QUEST_REMOVED')
end
ns.UpdateGuild(clock);if frame%50==1 then guildFixture.share(ns)end
local packets={'['..table.concat(ns.Encode(1429,.2345,.6789,0,seq,clock*1000,4,777,true),',')..']'}
for lane=1,4 do seq=seq+1;aux=aux+1;local packet
if aux%8==0 then packet=ns.CharacterPacket(seq,clock)
elseif aux%8==2 then packet=ns.BagPacket(seq,clock)
elseif aux%8==1 or aux%8==5 then packet=ns.GuildPacket(seq,clock)
elseif aux%8==3 or aux%8==6 or aux%8==7 then packet=ns.QuestLogPacket(seq,clock)
else packet=ns.QuestiePacket(1429,.2345,.6789,seq,clock)end
packets[#packets+1]='['..table.concat(packet,',')..']'end
print('['..table.concat(packets,',')..']')end`;
  const fixture = spawnSync('luajit', ['-e', lua], { cwd: root, encoding: 'utf8', timeout: 5000 });
  assert.equal(fixture.status, 0, fixture.stderr);
  const allFrames = fixture.stdout.trim().split('\n').map(JSON.parse);
  const frames=allFrames.slice(0,600),acceptedFrames=allFrames.slice(600,1200),removedFrames=allFrames.slice(1200);
  await evaluate(`window.__frames=${JSON.stringify(frames)};window.__captureCalls=0;
    navigator.mediaDevices.getDisplayMedia=async()=>{
      window.__captureCalls++;
      const {drawArtBlock}=await import('/art.js'),{HEADER,drawStrip,checksum}=await import('/protocol.js');
      const art=await(await fetch('/elephant-art.json')).json();
      const source=document.createElement('canvas');source.width=640;source.height=360;const ctx=source.getContext('2d');let i=0;
      const paint=()=>{
        ctx.fillStyle='#394c40';ctx.fillRect(0,0,640,360);
        const packets=window.__frames[i%window.__frames.length],pose=i++%8;
        if(window.__plainSync){
          const position=packets[0].slice(0,22);position[20]=0;position[21]=0;position.push(...checksum(position));
          [position,...packets.slice(1)].forEach((packet,lane)=>drawStrip(ctx,packet,32,24+lane*16,2));
        }else drawArtBlock(ctx,packets,art,pose,32,24,2,HEADER);
      };
      paint();window.__paintFrame=paint;window.__paint=setInterval(paint,50);window.__stream=source.captureStream(20);return window.__stream;
    };document.getElementById('connect').click();`);
  await until("document.getElementById('status').textContent === 'Live position'", 'decoded synthetic location');
  await until("document.getElementById('sidebar-sync-text').textContent==='Sync · Live'",'live sidebar sync status');
  assert.equal(await evaluate("document.getElementById('coord-x').textContent"), '23.5');
  assert.equal(await evaluate("document.getElementById('coord-y').textContent"), '67.9');
  await evaluate('window.companion.setUIScale(110)');
  await until("document.getElementById('ui-scale').textContent.includes('110%')", 'scaling during capture');
  assert.equal(await evaluate('window.__captureCalls'), 1, 'Scaling must not reconnect the capture');
  assert.equal(await evaluate("document.getElementById('capture-video').srcObject.getVideoTracks()[0].readyState"), 'live');
  await evaluate('window.companion.setUIScale(100)');
  await evaluate("document.getElementById('tab-bags').click()");
  await until("document.getElementById('bags-status').textContent.includes('Live bags')", 'complete synthetic inventory');
  assert.equal(await evaluate("document.querySelectorAll('.bag-slot').length"), 64);
  assert.match(await evaluate("document.getElementById('bags-summary').textContent"), /13 occupied/);
  await evaluate("document.getElementById('split-view-toggle').click();document.getElementById('split-secondary').value='map';document.getElementById('split-secondary').dispatchEvent(new Event('change'))");
  const shot = await send('Page.captureScreenshot'); await writeFile(path.join(artifacts, 'desktop-bags-and-map.png'), Buffer.from(shot.data, 'base64'));
  await evaluate("document.getElementById('tab-guild').click()");
  await until("document.querySelectorAll('#guild-roster tr').length===4 && document.getElementById('guild-name').textContent==='HUZZAH Test Guild'", 'guild roster from addon pixels');
  await until("document.getElementById('guild-roster').textContent.includes('Alchemy 375')",'shared guild professions');
  await until("Array.from(document.querySelectorAll('#guild-roster tr')).some(row=>row.textContent.includes('Éowyn') && row.textContent.includes('Enchanting 300') && row.textContent.includes('Tailoring 280'))",'local Classic Enchanting and Tailoring despite empty modern APIs');
  assert.match(await evaluate("document.getElementById('guild-roster').textContent"),/Not shared/);
  assert.match(await evaluate("document.getElementById('guild-roster').textContent"),/last seen/);
  await evaluate("document.getElementById('guild-search').value='Alchemy';document.getElementById('guild-search').dispatchEvent(new Event('input'))");
  assert.equal(await evaluate("document.querySelectorAll('#guild-roster tr').length"),1);
  await until("!document.querySelector('#guild-roster button').disabled",'fresh guild coordinates');
  await evaluate("document.querySelector('#guild-roster button').focus()");
  await wait(600);
  assert.equal(await evaluate("document.activeElement===document.querySelector('#guild-roster button')"),true,'Guild updates must preserve keyboard focus');
  await evaluate("document.querySelector('#guild-roster button').click()");
  await until("document.getElementById('zone').value==='1429' && document.getElementById('map-message').hidden",'guild member zone map');
  assert.equal(await evaluate("document.getElementById('follow').checked"),false);
  assert.equal(await evaluate('document.body.dataset.activeTab'),'map');
  await evaluate("document.getElementById('split-secondary').value='guild';document.getElementById('split-secondary').dispatchEvent(new Event('change'))");
  await wait(200);
  assert.ok(await evaluate("(()=>{const v=window.__mapDraw;return window.__guildDraws.some(p=>Math.abs(p.x-(v.x+22937/65535*v.w))<.01 && Math.abs(p.y-(v.y+29491/65535*v.h))<.01);})()"),'The guild pin must use the map artwork coordinates');
  const guildShot=await send('Page.captureScreenshot');await writeFile(path.join(artifacts,'desktop-guild-and-map.png'),Buffer.from(guildShot.data,'base64'));
  await evaluate("document.getElementById('guild-search').value='';document.getElementById('guild-search').dispatchEvent(new Event('input'));document.getElementById('guild-online-only').click()");
  assert.equal(await evaluate("document.querySelectorAll('#guild-roster tr').length"),3);
  await evaluate("document.getElementById('split-secondary').value='map';document.getElementById('split-secondary').dispatchEvent(new Event('change'))");
  await evaluate("document.getElementById('tab-map').click();document.getElementById('split-view-toggle').click()");
  assert.equal(await evaluate("document.getElementById('tab-quests')"),null,'Map and Quests must be a single tab');
  assert.equal(await evaluate("document.getElementById('map-view').contains(document.getElementById('quests-view'))"),true);
  await until("document.querySelectorAll('.quest-log-entry').length===3",'quest list beside map');
  await until("['pickup','sword','bag','gear','search','talk'].every(shape=>window.__questDraws?.[shape])",'Questie symbols drawn from addon icon types');
  assert.ok(await evaluate("(()=>{const p=window.__questDraws.bag,v=window.__mapDraw;return Math.abs(p.x-(v.x+.3*v.w))<.03 && Math.abs(p.y-(v.y+.35*v.h))<.03 && p.w===24;})()"),'Quest icons must keep their world coordinates and a fixed readable size');
  const markerShot=await send('Page.captureScreenshot');await writeFile(path.join(artifacts,'desktop-questie-markers.png'),Buffer.from(markerShot.data,'base64'));
  // Click the real sword at the accepted quest's coordinates; its tooltip and
  // reader must still work with the new artwork and map/quest split layout.
  const sword=await evaluate("(()=>{const r=document.getElementById('map-stage').getBoundingClientRect(),v=window.__mapDraw;return {x:r.left+v.x+.46*v.w,y:r.top+v.y+.51*v.h};})()");
  await send('Input.dispatchMouseEvent',{type:'mouseMoved',...sword});
  assert.match(await evaluate("document.getElementById('quest-tooltip').textContent"),/A Watch on the Ridge.*Ridge scouts found/);
  await send('Input.dispatchMouseEvent',{type:'mousePressed',...sword,button:'left',clickCount:1});
  await send('Input.dispatchMouseEvent',{type:'mouseReleased',...sword,button:'left',clickCount:1});
  await until("document.querySelectorAll('.quest-log-entry').length===3 && document.getElementById('quest-reader-description').textContent.includes('Captain Élan')",'readable accepted quest story from addon pixels');
  assert.match(await evaluate("document.getElementById('quest-reader-overview').textContent"),/recover three signal stones/);
  await until("document.getElementById('quest-reader-objectives').textContent.includes('Ridge scouts found: 1/4') && document.getElementById('quest-reader-objectives').textContent.includes('Signal stones recovered: 3/3')",'actual objective wording and counts');
  assert.equal(await evaluate("document.querySelectorAll('#quest-reader-objectives .is-complete').length"),1);
  await evaluate("document.getElementById('quest-reader-back').click()");
  assert.equal(await evaluate("document.getElementById('quest-reader').hidden"),true);
  assert.equal(await evaluate("document.getElementById('quest-browser-view').hidden"),false);
  await evaluate("document.getElementById('quest-log-search').value='Letter';document.getElementById('quest-log-search').dispatchEvent(new Event('input'))");
  assert.equal(await evaluate("document.querySelectorAll('.quest-log-entry').length"),1);
  await evaluate("document.querySelector('.quest-log-entry').click()");
  assert.equal(await evaluate("document.getElementById('quest-reader-title').textContent"),'A Letter for Home');
  assert.equal(await evaluate("document.getElementById('quest-reader-state').textContent"),'Ready for turn-in');
  await evaluate("document.getElementById('quest-reader-back').click()");
  await evaluate("document.getElementById('quest-log-search').value='';document.getElementById('quest-log-search').dispatchEvent(new Event('input'));document.getElementById('quest-log-filter').value='tracked';document.getElementById('quest-log-filter').dispatchEvent(new Event('change'))");
  assert.equal(await evaluate("document.querySelectorAll('.quest-log-entry').length"),1);
  await evaluate("document.querySelector('.quest-log-entry').click()");
  await until("document.getElementById('quest-reader-title').textContent==='A Watch on the Ridge' && !document.getElementById('quest-reader-map').disabled",'Questie locations for accepted quest');
  assert.ok(await evaluate("window.__questDraws.sword.alpha===1 && window.__questDraws.pickup.alpha<.5"),'Selecting a quest must preserve its symbols and dim unrelated markers');
  await evaluate("document.getElementById('quest-reader-back').focus()");await wait(500);
  assert.equal(await evaluate("document.activeElement===document.getElementById('quest-reader-back')"),true,'Quest updates must preserve keyboard focus');
  assert.equal(await evaluate('document.body.dataset.activeTab'),'map','Reading a quest keeps the map open');
  assert.ok(await evaluate("(()=>{const m=document.getElementById('map-stage').getBoundingClientRect(),q=document.getElementById('quests-view').getBoundingClientRect();return m.width>300 && q.width>=300 && m.right<=q.left && q.right<=innerWidth;})()"),'Map and quest reader must sit beside each other');
  const questShot=await send('Page.captureScreenshot');await writeFile(path.join(artifacts,'desktop-quest-log.png'),Buffer.from(questShot.data,'base64'));
  for(const theme of ['light','dark','original']){
    await evaluate(`document.querySelector('.theme-options [data-theme="${theme}"]').click()`);
    await wait(200);
    assert.equal(await evaluate('window.__captureCalls'),1,'Theme changes must preserve live capture');
    assert.equal(await evaluate("document.getElementById('capture-video').srcObject.getVideoTracks()[0].readyState"),'live');
    const themeShot=await send('Page.captureScreenshot');await writeFile(path.join(artifacts,`desktop-theme-${theme}.png`),Buffer.from(themeShot.data,'base64'));
  }
  await evaluate("document.getElementById('quest-reader-map').click()");
  assert.equal(await evaluate('document.body.dataset.activeTab'),'map');
  assert.equal(await evaluate("document.getElementById('zone').value"),'1429');
  await wait(200);
  const trackerShot=await send('Page.captureScreenshot');await writeFile(path.join(artifacts,'desktop-quest-tracker.png'),Buffer.from(trackerShot.data,'base64'));
  await evaluate(`(()=>{
    const filter=document.getElementById('quest-log-filter');filter.value='all';filter.dispatchEvent(new Event('change'));
    const nodes=Array.from(document.querySelectorAll('.quest-log-entry'));
    const title=document.getElementById('quest-reader-title').textContent,story=document.getElementById('quest-reader-description').textContent;
    window.__syncRegression=[];
    window.__questSyncObserver=new MutationObserver(()=>{
      if(nodes.some(node=>!node.isConnected))window.__syncRegression.push('Existing quest entries were removed');
      if(document.getElementById('quest-reader-title').textContent!==title || document.getElementById('quest-reader-description').textContent!==story || document.getElementById('quest-reader-content').hidden)window.__syncRegression.push('Existing quest reader was reset');
    });
    window.__questSyncObserver.observe(document.getElementById('quests-view'),{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['hidden']});
  })()`);
  await evaluate(`window.__frames=${JSON.stringify(acceptedFrames)}`);
  await until("document.querySelector('.quest-log-entry[data-quest-id=\"900104\"]')?.textContent.includes('Fresh Tracks') && document.getElementById('quest-log-status').textContent.includes('4/4')",'accepting a quest without restarting sync');
  assert.equal(await evaluate("document.activeElement===document.getElementById('quest-reader-back')"),true,'Accepting a quest must preserve reader focus');
  await evaluate(`window.__frames=${JSON.stringify(removedFrames)}`);
  await until("document.querySelectorAll('.quest-log-entry').length===3 && !document.querySelector('.quest-log-entry[data-quest-id=\"900104\"]') && document.getElementById('quest-log-status').textContent.includes('3/3')",'removing just the changed quest');
  assert.deepEqual(await evaluate('window.__syncRegression'),[],'Quest additions/removals must preserve the existing reader, list and map pins throughout capture');
  await evaluate('window.__plainSync=true');
  await until("window.__captureDecode?.width===500 && window.__captureDecode?.height===400",'switching from sprite to regular strip during capture');
  assert.equal(await evaluate("document.getElementById('sidebar-sync-text').textContent"),'Sync · Live');
  await evaluate('window.__plainSync=false');
  await until("window.__captureDecode?.width===640 && window.__captureDecode?.height===680",'switching from regular strip back to sprite during capture');
  assert.equal(await evaluate('window.__captureCalls'),1,'Changing addon display modes must preserve the desktop capture');
  assert.deepEqual(await evaluate('window.__syncRegression'),[],'Changing display modes must retain received quests and map pins');
  await evaluate('window.__questSyncObserver.disconnect();window.__syncRegression=null');
  await evaluate("document.getElementById('toggle-quest-log').click()");
  assert.equal(await evaluate("document.getElementById('quests-view').hidden"),true);
  await evaluate("document.getElementById('toggle-quest-log').click()");
  assert.equal(await evaluate("document.getElementById('quests-view').hidden"),false);
  await evaluate("document.getElementById('split-view-toggle').click();document.getElementById('split-secondary').value='bags';document.getElementById('split-secondary').dispatchEvent(new Event('change'))");
  await evaluate("document.getElementById('tab-character').click()");
  await until("document.getElementById('character-panel').textContent.includes('Éowyn')", 'synthetic character identity');
  await until("document.getElementById('app-mode').textContent.includes('1.60.1 (69977)')",'actual connected game version');
  assert.match(await evaluate("document.getElementById('character-panel').textContent"), /Netherwind Crown/);
  await until("document.getElementById('model-viewport').dataset.state === 'ready'", '3D character model', 40000);
  await wait(1500);
  const characterShot = await send('Page.captureScreenshot'); await writeFile(path.join(artifacts, 'desktop-character-and-map.png'), Buffer.from(characterShot.data, 'base64'));
  await evaluate('clearInterval(window.__paint)');
  await until("document.getElementById('sidebar-sync-text').textContent==='Sync · Paused'",'paused sidebar sync status for frozen frames');
  await evaluate('window.__paint=setInterval(window.__paintFrame,50)');
  await until("document.getElementById('sidebar-sync-text').textContent==='Sync · Live'",'sidebar sync resumes with fresh frames');
  assert.equal(await evaluate('window.__captureCalls'), 1, 'Changing tabs must preserve the capture session');
  await evaluate("document.getElementById('connect').click();clearInterval(window.__paint)");
  await until("document.getElementById('status').textContent === 'Not connected'", 'disconnect cleanup');
  await until("document.getElementById('sidebar-sync-text').textContent==='Sync · Offline'",'offline sidebar sync status after disconnect');
  assert.equal(await evaluate("document.getElementById('capture-video').srcObject"), null);
  await until("document.querySelectorAll('#guild-roster tr').length===0",'guild cleanup after disconnect');
  await until("document.querySelectorAll('.quest-log-entry').length===0 && document.getElementById('quest-reader-content').hidden",'quest log cleanup after disconnect');
  await evaluate("document.getElementById('tab-map').click();document.getElementById('grid').click()");
  const grid = await evaluate("document.getElementById('grid').checked");
  await evaluate("document.getElementById('toggle-quest-log').click()");
  assert.equal(await evaluate("document.getElementById('quests-view').hidden"),true);
  await evaluate("(()=>{const key='azeroth-live-map.preferences.v1',saved=JSON.parse(localStorage.getItem(key));localStorage.setItem(key,JSON.stringify({...saved,activeTab:'quests',secondaryTab:'map',splitView:true}));})()");
  assert.deepEqual(errors, [], 'No uncaught renderer errors'); assert.deepEqual(blocked, [], 'No blocked required resources');
  await evaluate('window.companion.setUIScale(125)');
  await evaluate("document.querySelector('.theme-options [data-theme=dark]').click()");
  await until("document.getElementById('ui-scale').textContent.includes('125%')", 'saved UI scale');
  await evaluate("document.getElementById('collapse-sidebar').click()");
  await wait(300);
  await close();
  const savedWindow = JSON.parse(await readFile(path.join(profile, 'window.json'), 'utf8'));
  assert.ok(savedWindow.width >= 900, 'Window size must persist');
  assert.equal(savedWindow.uiScale, 125, 'UI scale must be saved with window preferences');
  await start();
  assert.equal(await evaluate("getComputedStyle(document.getElementById('controls-panel')).display"), 'none', 'Sidebar collapse must survive relaunch');
  assert.equal(await evaluate("document.getElementById('toggle-controls').textContent"), 'Show sidebar');
  await evaluate("document.getElementById('toggle-controls').click()");
  assert.equal(await evaluate("document.getElementById('controls-panel').inert"), false);
  assert.equal(await evaluate('document.documentElement.dataset.theme'),'dark','Theme must survive relaunch');
  assert.equal(await evaluate("document.querySelector('.theme-options [data-theme=dark]').getAttribute('aria-pressed')"),'true');
  assert.equal(await evaluate('document.body.dataset.activeTab'),'map','An old Quests selection must migrate to the combined tab');
  assert.equal(await evaluate("document.body.classList.contains('split-view')"),false,'An old Map/Quests split must migrate to one view');
  assert.equal(await evaluate("document.getElementById('quests-view').hidden"),true,'Quest panel visibility must survive relaunch');
  await evaluate("document.getElementById('toggle-quest-log').click()");
  assert.equal(await evaluate("document.getElementById('quests-view').hidden"),false);
  assert.equal(await evaluate('window.companion.getUIScale()'), 125, 'UI scale must survive relaunch');
  assert.match(await evaluate("document.getElementById('ui-scale').textContent"), /125%/);
  assert.ok(Math.abs(await evaluate('devicePixelRatio') / basePixelRatio - 1.25) < 0.02, 'Relaunch must restore the actual rendering scale');
  assert.equal(await evaluate("document.getElementById('grid').checked"), grid, 'Display settings must survive relaunch');
  assert.equal(await evaluate("document.getElementById('status').textContent"), 'Not connected', 'Capture must require a new connection after relaunch');
  await close();
  console.log('Desktop QA passed: map framing, panning, resizing, split view, navigation, UI scaling, saved preferences, 59 maps, synthetic HUZZAH capture, character, 64 bag slots, guild roster, guild pins, readable quest stories, objective progress, tracked quests, quest search, incremental quest acceptance/removal, sprite/strip switching, Questie symbols, pin tooltips/clicks, Questie navigation, keyboard focus, disconnect, clean shutdown.');
} finally {
  if (socket) socket.close();
  if (child && child.exitCode === null) {
    child.kill('SIGTERM');
    await Promise.race([new Promise(resolve => child.once('exit', resolve)), wait(5000)]);
  }
  await writeFile(path.join(artifacts, 'electron-qa.log'), output);
  for (const entry of pending.values()) { clearTimeout(entry.timer); entry.reject(new Error('QA closed')); }
  await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
