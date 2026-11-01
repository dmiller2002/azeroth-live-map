// Isolated browser QA: real Lua packets through synthetic screen capture.
// No live game, normal browser profile, or user capture session is touched.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdir,writeFile} from 'node:fs/promises';
const artMode=process.argv.includes('--art');
const lua=`
local ns={};local clock=0
GetTime=function()return clock end
assert(loadfile('addon/AzerothLiveMap/Protocol.lua'))('AzerothLiveMap',ns)
assert(loadfile('addon/AzerothLiveMap/Questie.lua'))('AzerothLiveMap',ns)
assert(loadfile('addon/AzerothLiveMap/Character.lua'))('AzerothLiveMap',ns)
assert(loadfile('tests/fixtures/character.lua'))()
ns.QuestSession=777
CharacterQuestPin={UiMapID=1944,x=40,y=60,miniMapIcon=false,
 data={Type='monster',ObjectiveIndex=1,QuestData={name='Character sync test quest'},ObjectiveData={Collected=1,Needed=5}}}
QuestieLoader={ImportModule=function()return {questIdFrames={[123]={CharacterQuestPin='CharacterQuestPin'}}}end}
local sequence=0
for frame=1,500 do
 clock=frame*.1
 if frame==201 then fixture.slots[1]=12345;fixture.slots[16]=nil;fixture.stats[1]=225 end
 if frame==351 then
   ns.QuestSession=778;fixture.name='New Character'
   assert(loadfile('addon/AzerothLiveMap/Character.lua'))('AzerothLiveMap',ns)
 end
 sequence=sequence+1
 local packets={'['..table.concat(ns.Encode(1944,.2345,.6789,0,sequence,clock*1000,4,ns.QuestSession,${artMode}),',')..']'}
 for lane=1,4 do
  sequence=sequence+1
  local packet=lane==4 and ns.CharacterPacket(sequence,clock) or ns.QuestiePacket(1944,.2345,.6789,sequence,clock)
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
const until=async(expression,label)=>{for(let i=0;i<200;i++){if(await evaluate(expression))return;await new Promise(r=>setTimeout(r,100));}throw new Error('Timed out: '+label+'; tooltip='+await evaluate("document.getElementById('equipment-tooltip')?.textContent")+'; errors='+JSON.stringify(errors));};
try{
 await send('Runtime.enable');await send('Page.enable');await send('Page.bringToFront');
 await send('Emulation.setDeviceMetricsOverride',{width:1600,height:1000,deviceScaleFactor:1,mobile:false});
 await send('Page.addScriptToEvaluateOnNewDocument',{source:`
 localStorage.removeItem('azeroth-live-map.preferences.v1');
 window.__frames=${JSON.stringify(frames)};window.__index=0;
 navigator.mediaDevices.getDisplayMedia=async()=>{
   const {drawStrip,HEADER}=await import('/protocol.js');
   const {drawArtBlock}=await import('/art.js');
   const art=await(await fetch('/elephant-art.json')).json();
   const canvas=document.createElement('canvas');canvas.width=640;canvas.height=360;
   const ctx=canvas.getContext('2d');window.__lost=false;
   window.__paint=()=>{
     const row=window.__frames[window.__index++%window.__frames.length];ctx.fillStyle='#394c40';ctx.fillRect(0,0,640,360);
     if(${artMode})drawArtBlock(ctx,row,art,0,32,24,2,HEADER);
     else row.forEach((bytes,lane)=>drawStrip(ctx,bytes,32,24+lane*16,2));
   };
   window.__paint();window.__timer=setInterval(window.__paint,100);window.__stream=canvas.captureStream(30);return window.__stream;
 };`});
 await send('Page.navigate',{url:'http://localhost:8765'});
 await until("document.querySelectorAll('#zone option').length===70",'app ready');
 await evaluate("document.getElementById('toggle-character').click()");
 assert.equal(await evaluate("document.getElementById('character-panel').hidden"),false);
 assert.match(await evaluate("document.getElementById('character-status').textContent"),/Connect WoW/);
 assert.equal(await evaluate("document.querySelectorAll('.equipment-slot').length"),19);
 await evaluate("document.getElementById('connect').click()");
 await until("document.getElementById('character-gear-count').textContent.includes('19/19')",'all equipment slots');
 await until("document.getElementById('character-name').textContent==='Éowyn' && document.querySelector('[data-slot=\"16\"] strong').textContent.includes('Thunderfury')",'real Lua names');
 assert.match(await evaluate("document.getElementById('character-subtitle').textContent"),/Level 65 Undead Warrior · Test Realm/);
 assert.equal(await evaluate("document.getElementById('stat-strength').textContent"),'200');
 assert.equal(await evaluate("document.getElementById('stat-armor').textContent"),'3,480');
 assert.equal(await evaluate("document.getElementById('stat-health').textContent"),'5,420');
 assert.equal(await evaluate("document.getElementById('stat-power-label').textContent"),'Rage');
 assert.match(await evaluate("document.getElementById('quest-list').textContent"),/Character sync test quest/);
 assert.match(await evaluate("document.getElementById('quest-status').textContent"),/1\/1 markers/);
 assert.equal(await evaluate("document.querySelector('[data-slot=\"2\"] strong').textContent"),'Empty');
 assert.match(await evaluate("document.querySelector('[data-slot=\"16\"]').getAttribute('aria-label')"),/Durability 65\/80/);
 assert.equal(await evaluate("document.querySelector('[data-slot=\"16\"]').getAttribute('href')"),'https://www.wowhead.com/tbc/item=19019');
 await until("Array.from(document.querySelectorAll('.equipment-icon img')).some(image=>image.naturalWidth>0)",'actual equipped item icon');
 const sanitized=await evaluate(`(async()=>{
   const {itemDescription}=await import('/equipment-tooltip.js');
   const result=itemDescription('<span class="q2 arbitrary" style="position:fixed" onclick="window.__equipmentInjected=1">Equip: +10 Stamina</span><script>window.__equipmentInjected=1</script><img src="invalid" onerror="window.__equipmentInjected=1"><a href="javascript:alert(1)">Effect text</a><svg onload="window.__equipmentInjected=1"></svg><iframe srcdoc="bad"></iframe>');
   document.body.append(result);
   const state={text:result.textContent,unsafe:result.querySelectorAll('script,img,svg,iframe,[style],[onclick],[href]').length,color:result.querySelector('span').className,injected:!!window.__equipmentInjected};
   result.remove();return state;
 })()`);
 assert.deepEqual(sanitized,{text:'Equip: +10 StaminaEffect text',unsafe:0,color:'q2',injected:false});
 await evaluate("document.querySelector('[data-slot=\"16\"]').focus()");
 await until("!document.getElementById('equipment-tooltip').hidden && document.getElementById('equipment-tooltip').textContent.includes('Chance on hit:')",'detailed equipment tooltip');
 const description=await evaluate("document.getElementById('equipment-tooltip').textContent");
 assert.match(description,/44 - 115 Damage/);assert.match(description,/\+5 Agility/);assert.match(description,/Requires Level 60/);
 assert.match(description,/Durability 65 \/ 80/);assert.doesNotMatch(description,/Durability 125 \/ 125/);
 assert.match(description,/Enchants, gems, random bonuses and active set bonuses are not synced/);
 assert.equal(await evaluate("document.querySelector('[data-slot=\"16\"]').getAttribute('aria-describedby')"),'equipment-tooltip');
 assert.equal(await evaluate("document.getElementById('equipment-tooltip').getBoundingClientRect().right<=innerWidth"),true);
 await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
 await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
 assert.equal(await evaluate("document.getElementById('equipment-tooltip').hidden"),true,'Escape dismisses the tooltip');
 assert.equal(await evaluate("document.getElementById('character-panel').hidden"),false,'dismissing a tooltip keeps the equipment panel open');
 await evaluate("document.getElementById('close-character').focus()");
 const hover=await evaluate("(()=>{const r=document.querySelector('[data-slot=\"16\"]').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()");
 await send('Input.dispatchMouseEvent',{type:'mouseMoved',...hover});
 await until("!document.getElementById('equipment-tooltip').hidden",'mouse hover tooltip');
 await mkdir('artifacts',{recursive:true});
 const screenshot=await send('Page.captureScreenshot',{format:'png'});await writeFile(`artifacts/character-${artMode?'art':'plain'}-synthetic.png`,Buffer.from(screenshot.data,'base64'));
 await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:400,y:300});
 await until("document.getElementById('equipment-tooltip').hidden",'mouse leave dismisses tooltip');
 await evaluate("document.querySelector('[data-slot=\"16\"]').focus()");
 await evaluate("(()=>{const original=window.fetch;window.__failedItemLookups=0;window.fetch=(url,...args)=>{if(String(url).includes('/tbc/tooltip/item/12345')){window.__failedItemLookups++;return Promise.reject(new TypeError('Synthetic item lookup failure'));}return original(url,...args);};window.__index=200;})()");
 await until("document.querySelector('[data-slot=\"1\"] strong').textContent===\"Équipement de l'aventurier\" && document.querySelector('[data-slot=\"16\"] strong').textContent==='Empty'",'replacement item and unequipped main hand');
 await until("document.getElementById('stat-strength').textContent==='225'",'updated attributes');
 assert.equal(await evaluate("document.querySelector('[data-slot=\"16\"]').hasAttribute('href')"),false);
 assert.equal(await evaluate("document.getElementById('equipment-tooltip').hidden"),true,'unequipping the hovered item closes its tooltip');
 await evaluate("document.getElementById('toggle-controls').click()");
 assert.equal(await evaluate("document.getElementById('toggle-character').getAttribute('aria-expanded')"),'true');
 assert.equal(await evaluate("document.getElementById('character-panel').getBoundingClientRect().right<=innerWidth"),true);
 await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
 assert.equal(await evaluate("document.getElementById('character-panel').getBoundingClientRect().width<=390 && document.getElementById('character-panel').scrollWidth<=390"),true);
 const touch=await evaluate(`(()=>{
   const item=document.querySelector('[data-slot="1"]'),prevented=[];
   item.addEventListener('click',event=>{prevented.push(event.defaultPrevented);event.preventDefault();});
   const tap=()=>{item.dispatchEvent(new PointerEvent('pointerdown',{pointerType:'touch',bubbles:true}));item.focus();item.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true}));};
   tap();const tip=document.getElementById('equipment-tooltip'),r=tip.getBoundingClientRect();
   const visible=!tip.hidden,fits=r.left>=0 && r.right<=innerWidth && r.top>=0 && r.bottom<=innerHeight;
   tap();return {prevented,visible,fits};
 })()`);
 assert.deepEqual(touch,{prevented:[true,false],visible:true,fits:true},'first tap reads details, second tap can open the item page');
 await until("document.getElementById('equipment-tooltip').textContent.includes('Detailed item stats are unavailable')",'item lookup failure fallback');
 assert.match(await evaluate("document.getElementById('equipment-tooltip').textContent"),/Équipement de l'aventurier/);
 assert.match(await evaluate("document.getElementById('equipment-tooltip').textContent"),/Durability 65 \/ 80/);
 assert.equal(await evaluate("window.__failedItemLookups"),1,'icons and repeated tooltip opens share the same failed lookup');
 await evaluate("document.getElementById('close-character').click()");
 assert.equal(await evaluate("document.activeElement.id"),'toggle-character');
 await evaluate("document.getElementById('toggle-character').click();document.getElementById('close-character').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))");
 assert.equal(await evaluate("document.getElementById('character-panel').hidden"),true);
 await evaluate("document.getElementById('toggle-character').click();window.__index=350");
 await until("document.getElementById('character-name').textContent==='New Character'",'new addon session clears old character');
 await evaluate("clearInterval(window.__timer)");
 await until("document.getElementById('character-status').textContent.includes('paused')",'frozen capture');
 assert.equal(await evaluate("document.getElementById('character-name').textContent"),'Your character');
 assert.equal(await evaluate("document.querySelectorAll('.equipment-slot[href]').length"),0);
 await evaluate("document.getElementById('connect').click()");
 await until("document.getElementById('character-status').textContent.includes('Connect WoW')",'disconnect cleanup');
 assert.deepEqual(errors,[]);
 console.log(`${artMode?'Animated':'Plain'} character browser QA passed: identity, 19 slots, names, quality, actual icon load, stats, gear changes, empty slots, session replacement, responsive panel, keyboard/focus, stale capture and disconnect cleanup.`);
}finally{socket.close();await fetch(`http://127.0.0.1:9223/json/close/${target.id}`);}
