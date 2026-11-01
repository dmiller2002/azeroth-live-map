// Actual Lua emitters through an isolated synthetic screen capture.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdir,writeFile} from 'node:fs/promises';
const artMode=process.argv.includes('--art');
const splitMode=process.argv.includes('--split');
const lua=`local ns={};local clock=0
GetTime=function()return clock end
for _,name in ipairs({'Protocol','Questie','Character','Bags'})do assert(loadfile('addon/AzerothLiveMap/'..name..'.lua'))('AzerothLiveMap',ns) end
assert(loadfile('tests/fixtures/character.lua'))();assert(loadfile('tests/fixtures/bags.lua'))()
ns.QuestSession=777
BagQuestPin={UiMapID=1944,x=40,y=60,miniMapIcon=false,data={Type='monster',ObjectiveIndex=1,QuestData={name='Bag sync quest'},ObjectiveData={Collected=1,Needed=5}}}
QuestieLoader={ImportModule=function()return {questIdFrames={[123]={BagQuestPin='BagQuestPin'}}}end}
local sequence=0
for frame=1,1000 do
 clock=frame*.1
 if frame==501 then
  bagFixture.slots[0][2][2]=3;bagFixture.slots[0][8]=bagFixture.slots[0][3];bagFixture.slots[0][3]=nil
  bagFixture.sizes[1]=4;bagFixture.bagIDs[1]=4496;bagFixture.names[1]='Small Brown Pouch';bagFixture.slots[1]={[1]={13446,2}}
  ns.InvalidateBags()
 end
 if frame==751 then
  ns.QuestSession=778;bagFixture.slots[0]={[1]={22829,2}}
  assert(loadfile('addon/AzerothLiveMap/Bags.lua'))('AzerothLiveMap',ns)
 end
 sequence=sequence+1
 local packets={'['..table.concat(ns.Encode(1944,.2345,.6789,0,sequence,clock*1000,4,ns.QuestSession,${artMode}),',')..']'}
 for lane=1,4 do
  sequence=sequence+1
  local packet=lane==2 and ns.BagPacket(sequence,clock) or lane==4 and ns.CharacterPacket(sequence,clock) or ns.QuestiePacket(1944,.2345,.6789,sequence,clock)
  packets[#packets+1]='['..table.concat(packet,',')..']'
 end
 print('['..table.concat(packets,',')..']')
end`;
const emitted=spawnSync('luajit',['-e',lua],{encoding:'utf8',timeout:5000});assert.equal(emitted.status,0,emitted.stderr);
const frames=emitted.stdout.trim().split('\n').map(line=>JSON.parse(line));
const target=await(await fetch('http://127.0.0.1:9223/json/new?about:blank',{method:'PUT'})).json();
const socket=new WebSocket(target.webSocketDebuggerUrl);await new Promise(resolve=>socket.addEventListener('open',resolve,{once:true}));
let serial=0;const pending=new Map(),errors=[];
socket.addEventListener('message',event=>{const data=JSON.parse(event.data);if(data.id){const p=pending.get(data.id);pending.delete(data.id);data.error?p.reject(new Error(JSON.stringify(data.error))):p.resolve(data.result);}else if(data.method==='Runtime.exceptionThrown')errors.push(data.params.exceptionDetails);});
const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++serial;pending.set(id,{resolve,reject});socket.send(JSON.stringify({id,method,params}));});
const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw new Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
const until=async(expression,label)=>{for(let i=0;i<300;i++){if(await evaluate(expression))return;await new Promise(resolve=>setTimeout(resolve,100));}throw new Error('Timed out: '+label+'; '+await evaluate("document.getElementById('bags-status').textContent"));};
const slot=(bag,index)=>`document.querySelector('.bag-slot[data-bag="${bag}"][data-slot="${index}"]')`;
try{
 await send('Runtime.enable');await send('Page.enable');await send('Page.bringToFront');
 await send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
 await send('Page.addScriptToEvaluateOnNewDocument',{source:`
 localStorage.removeItem('azeroth-live-map.preferences.v1');
 window.__frames=${JSON.stringify(frames)};window.__index=0;
 navigator.mediaDevices.getDisplayMedia=async()=>{
  const {drawStrip,HEADER}=await import('/protocol.js'),{drawArtBlock}=await import('/art.js');
  const art=await(await fetch('/elephant-art.json')).json();let ticks=0;
  const canvas=document.createElement('canvas');canvas.width=640;canvas.height=360;const ctx=canvas.getContext('2d');
  window.__paint=()=>{
   const packets=window.__frames[window.__index++%window.__frames.length];ctx.fillStyle='#394c40';ctx.fillRect(0,0,640,360);
   if(${artMode})drawArtBlock(ctx,packets,art,ticks++%8,32,24,2,HEADER);
   else packets.forEach((packet,lane)=>drawStrip(ctx,packet,32,24+lane*16,2));
  };
  window.__paint();window.__timer=setInterval(window.__paint,100);return canvas.captureStream(30);
 };`});
 await send('Page.navigate',{url:'http://localhost:8765'});
 await until("document.querySelectorAll('#zone option').length===70",'app ready');
 await evaluate("document.getElementById('tab-bags').click()");
 if(splitMode){
  await evaluate("document.getElementById('split-view-toggle').click();document.getElementById('split-primary').value='map';document.getElementById('split-primary').dispatchEvent(new Event('change'))");
  assert.equal(await evaluate("document.body.dataset.activeTab"),'map');
  assert.equal(await evaluate("document.getElementById('split-secondary').value"),'bags');
 }
 assert.equal(await evaluate("document.getElementById('bags-view').hidden"),false);
 assert.match(await evaluate("document.getElementById('bags-status').textContent"),/Connect WoW/);
 await evaluate("document.getElementById('connect').click()");
 await until("document.getElementById('bags-status').textContent.includes('Live bags')",'all live slots');
 assert.equal(await evaluate("document.querySelectorAll('.bag-slot').length"),64);
 assert.match(await evaluate("document.getElementById('bags-summary').textContent"),/13 occupied · 51 free · 64 total/);
 assert.match(await evaluate(`${slot(0,2)}.getAttribute('aria-label')`),/Quantity 12/);
 assert.equal(await evaluate(`${slot(0,2)}.querySelector('.bag-item-count').textContent`),'12');
 assert.match(await evaluate("document.querySelector('.bag-card[data-bag=\"2\"]').textContent"),/No bag equipped/);
 await until(`${slot(0,6)}.getAttribute('aria-label').includes('Étoffe de l’aventurier')`,'live UTF-8 item names');
 await until(`${slot(0,2)}.querySelector('img')?.naturalWidth>0`,'actual item icon');
 await evaluate(`${slot(0,2)}.focus()`);
 await until("!document.getElementById('bag-item-tooltip').hidden && document.getElementById('bag-item-tooltip').textContent.includes('Restores')",'bag item hover details');
 assert.match(await evaluate("document.getElementById('bag-item-tooltip').textContent"),/Quantity 12/);
 await evaluate("document.getElementById('bags-layout').value='combined';document.getElementById('bags-layout').dispatchEvent(new Event('change'))");
 assert.equal(await evaluate("document.getElementById('combined-bag').hidden"),false);
 assert.equal(await evaluate("document.querySelectorAll('#combined-bag-items .bag-slot').length"),64,'all slots move into one bag');
 assert.equal(await evaluate("Array.from(document.querySelectorAll('.bag-card[data-bag]')).every(card=>card.hidden)"),true);
 assert.equal(await evaluate("document.getElementById('bag-item-tooltip').hidden"),true,'switching views dismisses tooltips');
 await evaluate(`${slot(0,2)}.focus()`);
 await new Promise(resolve=>setTimeout(resolve,350));
 assert.equal(await evaluate("document.activeElement===document.querySelector('#combined-bag-items .bag-slot[data-bag=\"0\"][data-slot=\"2\"]')"),true,'live refresh preserves item focus');
 await until("!document.getElementById('bag-item-tooltip').hidden",'combined bag tooltip');
 assert.match(await evaluate("document.getElementById('bag-item-tooltip').textContent"),/Backpack · Slot 2/,'combined view retains original location');
 await evaluate("document.getElementById('bags-show-empty').click()");
 await evaluate("document.getElementById('bags-layout').value='separate';document.getElementById('bags-layout').dispatchEvent(new Event('change'))");
 assert.equal(await evaluate("document.querySelectorAll('.bag-card[data-bag=\"0\"] .bag-slot').length"),16);
 assert.equal(await evaluate("document.getElementById('combined-bag-items').children.length"),0);
 assert.equal(await evaluate("document.getElementById('combined-bag').hidden"),true);
 await evaluate("document.getElementById('bags-layout').value='combined';document.getElementById('bags-layout').dispatchEvent(new Event('change'))");
 assert.equal(await evaluate("Array.from(document.querySelectorAll('.bag-slot')).filter(node=>node.getBoundingClientRect().width>0).length"),13);
 await evaluate("document.getElementById('bags-show-empty').click()");
 await mkdir('artifacts',{recursive:true});
 const screenshot=await send('Page.captureScreenshot',{format:'png'});await writeFile(`artifacts/bags-${artMode?'art':'plain'}-synthetic.png`,Buffer.from(screenshot.data,'base64'));
 await evaluate("document.getElementById('tab-map').click()");
 assert.equal(await evaluate("document.getElementById('bag-item-tooltip').hidden"),true);
 await until("document.getElementById('character-gear-count').textContent.includes('19/19')",'character feed alongside bags');
 assert.match(await evaluate("document.getElementById('quest-list').textContent"),/Bag sync quest/);
 await evaluate('window.__index=500');
 await new Promise(resolve=>setTimeout(resolve,3500));
 await evaluate("document.getElementById('tab-bags').click()");
 await until(`${slot(0,2)}?.getAttribute('aria-label').includes('Quantity 3')`,'stack updates while Bags is hidden');
 await until("document.querySelector('.bag-card[data-bag=\"1\"] h2').textContent==='Small Brown Pouch'",'bag replacement name');
 assert.equal(await evaluate("document.querySelectorAll('.bag-slot[data-bag=\"1\"]').length"),4);
 assert.equal(await evaluate("document.querySelectorAll('#combined-bag-items .bag-slot').length"),52,'combined bag removes replaced bag slots');
 assert.equal(await evaluate(`${slot(0,3)}.hasAttribute('href')`),false,'moved item clears its old slot');
 assert.equal(await evaluate(`${slot(0,8)}.getAttribute('href')`),'https://www.wowhead.com/tbc/item=27854');
 if(splitMode){
  await evaluate("document.getElementById('split-secondary').value='character';document.getElementById('split-secondary').dispatchEvent(new Event('change'))");
  await until("document.getElementById('model-viewport').dataset.state==='ready' && document.querySelector('#model-viewport canvas')",'3D character renders in second pane');
  await evaluate("window.__splitModelCanvas=document.querySelector('#model-viewport canvas');document.getElementById('tab-map').click()");
  await new Promise(resolve=>setTimeout(resolve,400));
  assert.equal(await evaluate("window.__splitModelCanvas===document.querySelector('#model-viewport canvas')"),true,'model stays alive while visible in second pane');
  await evaluate("document.getElementById('split-secondary').value='updates';document.getElementById('split-secondary').dispatchEvent(new Event('change'))");
  await until("!document.querySelector('#model-viewport canvas')",'hidden Character releases 3D renderer');
  await evaluate("document.getElementById('split-secondary').value='bags';document.getElementById('split-secondary').dispatchEvent(new Event('change'))");
 }
 await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:false});
 assert.equal(await evaluate('document.documentElement.scrollWidth<=390'),true,'mobile layout fits');
 await evaluate(`${slot(0,2)}.focus()`);
 assert.equal(await evaluate('document.activeElement.dataset.bag'),'0');
 await evaluate(`(()=>{const item=${slot(0,2)};item.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerType:'touch'}));item.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true}));})()`);
 await until("!document.getElementById('bag-item-tooltip').hidden",'touch details');
 assert.equal(await evaluate("(()=>{const r=document.getElementById('bag-item-tooltip').getBoundingClientRect();return r.left>=0 && r.right<=innerWidth && r.top>=0 && r.bottom<=innerHeight;})()"),true,'touch tooltip fits');
 await evaluate('window.__index=750');
 await until(`${slot(0,1)}?.href.endsWith('item=22829')`,'session replacement clears old inventory');
 await evaluate('clearInterval(window.__timer)');
 await until("document.getElementById('bags-status').textContent.includes('paused')",'frozen capture hides bags');
 assert.equal(await evaluate("document.querySelectorAll('.bag-slot[href]').length"),0);
 await evaluate("document.getElementById('connect').click()");
 await until("document.getElementById('bags-status').textContent.includes('Connect WoW')",'disconnect cleanup');
 assert.equal(await evaluate("JSON.parse(localStorage.getItem('azeroth-live-map.preferences.v1')).activeTab"),splitMode?'map':'bags');
 assert.equal(await evaluate("JSON.parse(localStorage.getItem('azeroth-live-map.preferences.v1')).bagView"),'combined');
 assert.equal(await evaluate("localStorage.getItem('azeroth-live-map.preferences.v1').includes('Hearthstone')"),false,'live inventory is not persisted');
 assert.deepEqual(errors,[]);
 console.log(`${artMode?'HUZZAH':'Plain'} bags browser QA passed: separate/combined views, retained focus and original slot tooltips, empty filtering, view preference, five bags, 64 slots, quantities, actual icons/tooltips, hidden-tab sync, bag replacement, moved items, Character/Questie coexistence, touch/mobile, session replacement and stale/disconnect cleanup.`);
}finally{socket.close();await fetch(`http://127.0.0.1:9223/json/close/${target.id}`);}
