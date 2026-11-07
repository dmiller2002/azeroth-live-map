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
  assert.equal(await evaluate("document.getElementById('tab-bags').textContent"),'Bag/bank');
  assert.equal(await evaluate("Array.from(document.querySelectorAll('#split-secondary option')).find(node=>node.value==='bags').textContent"),'Bag/bank');
  const lua=`local ns={};local clock=0;GetTime=function()return clock end;GetServerTime=function()return 1800000000+math.floor(clock)end
UnitName=function()return 'Bank Tester','Test Realm'end;GetRealmName=function()return 'Test Realm'end
AzerothLiveMapDB={};assert(loadfile('tests/fixtures/bags.lua'))();assert(loadfile('tests/fixtures/bank.lua'))()
for _,name in ipairs({'Compat','Protocol','Bags','Bank'})do assert(loadfile('addon/AzerothLiveMap/'..name..'.lua'))('AzerothLiveMap',ns)end
ns.QuestSession=777;local seq=0
local function emit(stage,count)
 for frame=1,count do clock=clock+.05;seq=seq+1
  local batch={'['..table.concat(ns.Encode(1429,.2345,.6789,0,seq,clock*1000,4,777,true),',')..']'}
  for lane=1,4 do seq=seq+1;local p=lane%2==0 and ns.BagPacket(seq,clock)or ns.BankPacket(seq,clock);batch[#batch+1]='['..table.concat(p,',')..']'end
  print(stage..'|['..table.concat(batch,',')..']')
 end
end
emit('unseen',300)
bankFixture.open=true;ns.BankEvent('BANKFRAME_OPENED');emit('open',600)
bankFixture.open=false;ns.BankEvent('BANKFRAME_CLOSED');emit('closed',400)
bankFixture.open=true;bankFixture.slots[20][1]=nil;bankFixture.slots[20][98]={13446,3};bankFixture.types[0]={{ID=20,name='Updated supplies'}}
bagFixture.slots[0][1]=nil;ns.InvalidateBags();ns.BankEvent('BANKFRAME_OPENED');emit('changed',600)`;
  const fixture=spawnSync('luajit',['-e',lua],{cwd:root,encoding:'utf8',maxBuffer:8*1024*1024});assert.equal(fixture.status,0,fixture.stderr);
  const stages={};for(const row of fixture.stdout.trim().split('\n')){const i=row.indexOf('|'),stage=row.slice(0,i);(stages[stage]||=[]).push(JSON.parse(row.slice(i+1)));}
  await evaluate(`window.__stages=${JSON.stringify(stages)};window.__frames=window.__stages.unseen;
    navigator.mediaDevices.getDisplayMedia=async()=>{
      const {drawArtBlock}=await import('/art.js'),{HEADER,checksum}=await import('/protocol.js');
      const art=await(await fetch('/elephant-art.json')).json();
      const source=document.createElement('canvas');source.width=640;source.height=360;const ctx=source.getContext('2d');let frame=0,sequence=0;
      const paint=()=>{
        const batch=window.__frames[frame++%window.__frames.length].map(original=>{
          const bytes=original.slice(0,22),seq=++sequence%65536;bytes[3]=seq>>8;bytes[4]=seq&255;
          if(bytes[1]===1){const time=frame*50;bytes[13]=Math.floor(time/16777216)%256;bytes[14]=Math.floor(time/65536)%256;bytes[15]=Math.floor(time/256)%256;bytes[16]=time%256;}
          return [...bytes,...checksum(bytes)];
        });
        ctx.fillStyle='#394c40';ctx.fillRect(0,0,640,360);drawArtBlock(ctx,batch,art,frame%8,32,24,2,HEADER);
      };
      paint();window.__paint=setInterval(paint,50);return source.captureStream(20);
    };document.getElementById('connect').click();document.getElementById('tab-bags').click();`);
  await until("document.getElementById('bags-status').textContent.includes('Live bags') && document.getElementById('bank-character-status').textContent.includes('Open your bank')",'live bags before first bank visit');
  assert.equal(await evaluate("document.querySelectorAll('.bank-slot').length"),0);
  assert.equal(await evaluate("document.getElementById('bank-account').hidden"),true,'Do not present account storage before it has been available');
  const stage=async name=>evaluate(`window.__frames=window.__stages.${name}`);
  await stage('open');
  await until("document.getElementById('bank-character-summary').textContent==='3 occupied · 111 free · 114 slots' && document.getElementById('bank-account-summary').textContent==='1 occupied · 97 free · 98 slots'",'all personal and account bank slots received');
  assert.equal(await evaluate("document.querySelectorAll('.bank-slot').length"),212);
  await until("document.querySelector('[data-bank=\"0\"][data-slot=\"98\"]').getAttribute('aria-label').includes('Major Healing Potion · Quantity 12')",'bank item name and quantity beyond slot 64');
  assert.equal(await evaluate("document.querySelector('[data-bank=\"16\"][data-slot=\"97\"]').getAttribute('aria-label').includes('Quantity 55')"),true);
  await evaluate("document.getElementById('bags-show-empty').click()");
  assert.equal(await evaluate("getComputedStyle(document.querySelector('[data-bank=\"0\"][data-slot=\"2\"]').parentElement).display"),'none');
  assert.notEqual(await evaluate("getComputedStyle(document.querySelector('[data-bank=\"0\"][data-slot=\"98\"]').parentElement).display"),'none');
  await evaluate("document.getElementById('bags-layout').value='combined';document.getElementById('bags-layout').dispatchEvent(new Event('change'))");
  assert.equal(await evaluate("document.querySelectorAll('#combined-bag-items .bag-slot').length"),64);
  assert.equal(await evaluate("document.querySelectorAll('#bank-storage .bank-slot').length"),212);
  await stage('closed');
  await until("document.getElementById('bank-character-status').textContent.includes('Cached bank · last seen')",'closed bank is explicitly cached');
  assert.equal(await evaluate("document.querySelector('[data-bank=\"0\"][data-slot=\"98\"]').getAttribute('aria-label').includes('Quantity 12')"),true);
  await stage('changed');
  await until("document.getElementById('bank-character-status').textContent.includes('Live bank') && document.getElementById('bank-character-summary').textContent==='1 occupied · 97 free · 98 slots' && document.querySelector('[data-bank=\"0\"][data-slot=\"98\"]').getAttribute('aria-label').includes('Quantity 3')",'reopened bank shows withdrawals and stack changes');
  assert.equal(await evaluate("document.querySelectorAll('.bank-slot').length"),196);
  assert.equal(await evaluate("document.querySelector('#bank-storage section[data-bank=\"1\"]')"),null);
  await until("document.getElementById('bags-summary').textContent.includes('12 occupied')",'normal bags continue updating alongside the bank');
  await evaluate("document.getElementById('bank-character').scrollIntoView({block:'start'})");await wait(300);
  const shot=await send('Page.captureScreenshot');await writeFile(path.join(artifacts,'desktop-bag-bank.png'),Buffer.from(shot.data,'base64'));
  await evaluate("document.getElementById('connect').click();clearInterval(window.__paint)");
  await until("document.querySelectorAll('.bank-slot').length===0 && document.getElementById('bank-character-status').textContent.includes('Connect WoW')",'disconnect clears bank overlays');
  assert.deepEqual(errors,[]);assert.deepEqual(blocked,[]);await close();
  console.log('Bank QA passed: native Lua through artwork capture, Bag/bank and split-view labels, live/cached banks, large tabs, names, stacks, empty toggle, separate bank/combined bags, withdrawals, removed tabs, concurrent bag updates and disconnect cleanup.');
} finally {
  if(socket)socket.close();
  if(child&&child.exitCode===null){child.kill('SIGTERM');await Promise.race([new Promise(resolve=>child.once('exit',resolve)),wait(5000)]);}
  await writeFile(path.join(artifacts,'bank-qa.log'),output);
  for(const entry of pending.values()){clearTimeout(entry.timer);entry.reject(new Error('QA closed'));}
  await rm(profile,{recursive:true,force:true,maxRetries:5,retryDelay:200});
}
