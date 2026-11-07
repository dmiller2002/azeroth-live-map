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
  throw new Error('Timed out: ' + label + '\n' + await evaluate("JSON.stringify({status:document.getElementById('status')?.textContent,helper:document.getElementById('quest-source-status')?.textContent,zone:document.getElementById('zone')?.value,pins:window.__pins?.length})"));
};

async function start() {
  await rm(path.join(profile, 'DevToolsActivePort'), { force: true });
  child = spawn(executable, [...args, '--remote-debugging-port=0', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', '--ozone-platform=x11'], { cwd: root, env: { ...process.env, COMPANION_USER_DATA: profile }, stdio: ['ignore', 'pipe', 'pipe'] });
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
  await send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
  await evaluate(`(()=>{
    const draw=CanvasRenderingContext2D.prototype.drawImage,fill=CanvasRenderingContext2D.prototype.fill,clear=CanvasRenderingContext2D.prototype.clearRect;
    CanvasRenderingContext2D.prototype.drawImage=function(source,...args){
      if(this.canvas.id==='map' && !source?.dataset?.questMarker && args.length===4)window.__mapView={x:args[0],y:args[1],w:args[2],h:args[3]};
      if(this.canvas.id==='map' && source?.dataset?.questMarker){const t=this.getTransform();(window.__pins||=[]).push({shape:source.dataset.questMarker,x:t.e,y:t.f});}
      return draw.call(this,source,...args);
    };
    CanvasRenderingContext2D.prototype.fill=function(...args){if(this.canvas.id==='map' && this.fillStyle==='#b0ffdc'){const t=this.getTransform();window.__player={x:t.e,y:t.f};}return fill.apply(this,args);};
    CanvasRenderingContext2D.prototype.clearRect=function(...args){if(this.canvas.id==='map'){window.__pins=[];window.__player=null;}return clear.apply(this,args);};
    document.getElementById('collapse-sidebar').click();document.getElementById('toggle-quest-log').click();
  })()`);
  const lua=`local ns={};local clock=0;GetTime=function()return clock end;GetServerTime=function()return 777 end
assert(loadfile('tests/fixtures/quest-log.lua'))();questLogFixture.questie();questLogFixture.forever()
assert(loadfile('tests/fixtures/map-layout.lua'))()
for _,name in ipairs({'Compat','Protocol','QuestStream','MapData','Questie','NativeQuests'})do assert(loadfile('addon/AzerothLiveMap/'..name..'.lua'))('AzerothLiveMap',ns)end
local seq,aux=0,0
for frame=1,250 do
 clock=frame*.05;seq=seq+1
 local packets={'['..table.concat(ns.Encode(1429,.2345,.6789,0,seq,clock*1000,4,ns.QuestSession,true),',')..']'}
 for lane=1,4 do
  seq=seq+1;aux=aux+1
  local packet=aux%3==0 and ns.MapDataPacket(1429,seq) or aux%3==1 and ns.QuestiePacket(1429,.2345,.6789,seq,clock) or ns.NativeQuestPacket(1429,.2345,.6789,seq,clock)
  packets[#packets+1]='['..table.concat(packet,',')..']'
 end
 print('['..table.concat(packets,',')..']')
end`;
  const fixture=spawnSync('luajit',['-e',lua],{cwd:root,encoding:'utf8'});assert.equal(fixture.status,0,fixture.stderr);
  const frames=fixture.stdout.trim().split('\n').map(JSON.parse);
  await evaluate(`window.__frames=${JSON.stringify(frames)};window.__captureCalls=0;
    navigator.mediaDevices.getDisplayMedia=async()=>{
      window.__captureCalls++;
      const {drawArtBlock}=await import('/art.js'),{HEADER,checksum}=await import('/protocol.js');
      const art=await(await fetch('/elephant-art.json')).json();
      const source=document.createElement('canvas');source.width=640;source.height=360;const ctx=source.getContext('2d');let frame=0,sequence=0;
      const paint=()=>{
        const batch=window.__frames[frame++%window.__frames.length].map(original=>{
          const bytes=original.slice(0,22);const seq=++sequence%65536;bytes[3]=seq>>8;bytes[4]=seq&255;
          if(bytes[1]===1){const time=frame*50;bytes[13]=Math.floor(time/16777216)%256;bytes[14]=Math.floor(time/65536)%256;bytes[15]=Math.floor(time/256)%256;bytes[16]=time%256;}
          return [...bytes,...checksum(bytes)];
        });
        ctx.fillStyle='#394c40';ctx.fillRect(0,0,640,360);drawArtBlock(ctx,batch,art,frame%8,32,24,2,HEADER);
      };
      paint();window.__paint=setInterval(paint,50);return source.captureStream(20);
    };document.getElementById('connect').click();`);
  await until("document.getElementById('status').textContent==='Live position'",'synthetic player capture');
  await until("document.getElementById('quest-source-status').textContent.includes('Questie') && window.__pins?.length===14",'Questie and city pins in zone view');
  const chooseMap=async id=>{
    await evaluate(`document.getElementById('zone').value='${id}';document.getElementById('zone').dispatchEvent(new Event('change'))`);
    await until(`document.getElementById('zone').value==='${id}' && document.getElementById('map-message').hidden`,'map '+id);
  };
  await chooseMap(947);
  await until("window.__player && document.getElementById('map-layout-status').textContent.includes('aligned')",'player projected onto the full world');
  assert.equal(await evaluate("document.getElementById('whole-map').getAttribute('aria-pressed')"),'true');
  const placement=await evaluate('({player:window.__player,view:window.__mapView})');
  const px=Math.round(.2345*65535)/65535,py=Math.round(.6789*65535)/65535;
  const world={x:.65+(.4+px*.2)*.3,y:.1+(.7+py*.2)*.8};
  assert.ok(Math.abs(placement.player.x-(placement.view.x+world.x*placement.view.w))<1,'Player X must use the native zone/continent/world transforms');
  assert.ok(Math.abs(placement.player.y-(placement.view.y+world.y*placement.view.h))<1,'Player Y must use the native zone/continent/world transforms');
  await evaluate("document.getElementById('quest-source').value='forever';document.getElementById('quest-source').dispatchEvent(new Event('change'))");
  await until("document.getElementById('quest-source-status').textContent.includes('WoW Forever · 2 markers') && window.__pins.length===2",'built-in helper world pins');
  await wait(300);
  let shot=await send('Page.captureScreenshot');await writeFile(path.join(artifacts,'desktop-forever-helper-world.png'),Buffer.from(shot.data,'base64'));
  await evaluate("document.getElementById('quest-source').value='questie';document.getElementById('quest-source').dispatchEvent(new Event('change'))");
  await until("window.__pins.length===14 && document.getElementById('quest-source-status').textContent.includes('Questie')",'switch back to Questie without reconnecting');
  await wait(300);
  shot=await send('Page.captureScreenshot');await writeFile(path.join(artifacts,'desktop-questie-helper-world.png'),Buffer.from(shot.data,'base64'));
  async function clickMap(x,y){
    const point=await evaluate(`(()=>{const box=document.getElementById('map-stage').getBoundingClientRect(),v=window.__mapView;return {x:box.left+v.x+${x}*v.w,y:box.top+v.y+${y}*v.h}})()`);
    await send('Input.dispatchMouseEvent',{type:'mousePressed',...point,button:'left',clickCount:1});
    await send('Input.dispatchMouseEvent',{type:'mouseReleased',...point,button:'left',clickCount:1});
  }
  await clickMap(.8,.5);
  await until("document.getElementById('zone').value==='1415' && document.getElementById('map-message').hidden",'native continent hit target');
  await clickMap(.55,.86);
  await until("document.getElementById('zone').value==='1429' && document.getElementById('map-message').hidden",'native zone hit target');
  await evaluate("document.getElementById('quest-source').value='forever';document.getElementById('quest-source').dispatchEvent(new Event('change'))");
  assert.equal(await evaluate('window.__captureCalls'),1,'Browsing and switching providers must keep the capture session');
  await evaluate("document.getElementById('quests').click()");await until('window.__pins.length===0','hide all markers');
  await evaluate("document.getElementById('quests').click()");await until('window.__pins.length===2','restore selected helper pins');
  await evaluate("document.getElementById('connect').click();clearInterval(window.__paint)");
  await until('!window.__player && window.__pins.length===0','disconnect cleanup');
  assert.deepEqual(errors,[]);assert.deepEqual(blocked,[]);
  await close();await start();
  assert.equal(await evaluate("document.getElementById('quest-source').value"),'forever','Helper selection must survive relaunch');
  assert.equal(await evaluate("document.getElementById('status').textContent"),'Not connected');
  await close();
  console.log('Map QA passed: real Lua packets and pixel capture, native world projection, full overview framing, native continent/zone hit targets, independent Questie/Forever markers, show/hide, saved provider, one capture session, and disconnect cleanup.');
} finally {
  if(socket)socket.close();
  if(child&&child.exitCode===null){child.kill('SIGTERM');await Promise.race([new Promise(resolve=>child.once('exit',resolve)),wait(5000)]);}
  await writeFile(path.join(artifacts,'map-qa.log'),output);
  for(const entry of pending.values()){clearTimeout(entry.timer);entry.reject(new Error('QA closed'));}
  await rm(profile,{recursive:true,force:true,maxRetries:5,retryDelay:200});
}
