// Isolated browser checks for arbitrary pane choices and saved layout.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
const target=await(await fetch('http://127.0.0.1:9223/json/new?about:blank',{method:'PUT'})).json();
const socket=new WebSocket(target.webSocketDebuggerUrl);await new Promise(resolve=>socket.addEventListener('open',resolve,{once:true}));
let serial=0;const pending=new Map(),errors=[];
socket.addEventListener('message',event=>{const data=JSON.parse(event.data);if(data.id){const p=pending.get(data.id);pending.delete(data.id);data.error?p.reject(new Error(JSON.stringify(data.error))):p.resolve(data.result);}else if(data.method==='Runtime.exceptionThrown')errors.push(data.params.exceptionDetails);});
const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++serial;pending.set(id,{resolve,reject});socket.send(JSON.stringify({id,method,params}));});
const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw new Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const until=async(expression,label)=>{for(let i=0;i<150;i++){
 try{if(await evaluate(expression))return;}catch(error){if(!/navigated|context.*destroyed|Cannot find context/i.test(error.message))throw error;}
 await wait(100);
}throw new Error('Timed out: '+label);};
const choose=async(id,value)=>evaluate(`(()=>{const s=document.getElementById(${JSON.stringify(id)});s.value=${JSON.stringify(value)};s.dispatchEvent(new Event('change'));})()`);
try{
 await send('Runtime.enable');await send('Page.enable');await send('Page.bringToFront');
 await send('Emulation.setDeviceMetricsOverride',{width:1920,height:1080,deviceScaleFactor:1,mobile:false});
 await send('Page.navigate',{url:'http://localhost:8765'});
 await until("document.querySelectorAll('#zone option').length===70",'app ready');
 await evaluate("localStorage.removeItem('azeroth-live-map.preferences.v1')");
 await evaluate('window.__splitReloadMark=1');
 await send('Page.reload',{ignoreCache:true});
 await until("!window.__splitReloadMark && document.querySelectorAll('#zone option').length===70",'default layout');
 await evaluate("document.getElementById('split-view-toggle').click()");
 const views=['map','character','bags','updates'];
 for(const first of views)for(const second of views){
  if(first===second)continue;
  await choose('split-primary',first);await choose('split-secondary',second);await wait(60);
  const layout=await evaluate(`(()=>{
   const panels=Array.from(document.querySelectorAll('#viewer-panels>[role=tabpanel]')).filter(p=>!p.hidden);
   const byId=new Map(panels.map(p=>[p.id,p.getBoundingClientRect()]));
   const one=document.getElementById(document.querySelector('#tab-'+${JSON.stringify(first)}).getAttribute('aria-controls')).getBoundingClientRect();
   const two=document.getElementById(document.querySelector('#tab-'+${JSON.stringify(second)}).getAttribute('aria-controls')).getBoundingClientRect();
   return {count:panels.length,first:document.getElementById('split-primary').value,second:document.getElementById('split-secondary').value,sideBySide:one.right<=two.left && Math.abs(one.top-two.top)<2,overflow:document.documentElement.scrollWidth>innerWidth,mapVisible:document.body.dataset.mapVisible};
  })()`);
  assert.deepEqual(layout,{count:2,first,second,sideBySide:true,overflow:false,mapVisible:String([first,second].includes('map'))},`${first} + ${second}`);
 }
 await choose('split-primary','map');await choose('split-secondary','bags');
 await evaluate("document.getElementById('zoom-in').click()");
 const zoom=await evaluate("document.getElementById('zoom-label').textContent");
 await evaluate("document.getElementById('split-view-swap').click()");
 assert.equal(await evaluate("document.getElementById('split-primary').value"),'bags');
 assert.equal(await evaluate("document.getElementById('split-secondary').value"),'map');
 assert.equal(await evaluate("document.getElementById('zoom-label').textContent"),zoom,'swapping retains map zoom');
 assert.equal(await evaluate("getComputedStyle(document.querySelector('.options')).display"),'grid','map controls remain visible when Map is second');
 await choose('split-secondary','bags');
 assert.equal(await evaluate("document.getElementById('split-primary').value"),'map','choosing the same view swaps panes');
 assert.equal(await evaluate("document.querySelectorAll('#app-tabs [aria-selected=true]').length"),2);
 await choose('split-primary','character');await choose('split-secondary','bags');
 await evaluate('window.__splitReloadMark=1');
 await send('Page.reload',{ignoreCache:true});
 await until("!window.__splitReloadMark && document.querySelectorAll('#zone option').length===70",'saved layout reload');
 assert.equal(await evaluate("document.body.classList.contains('split-view')"),true);
 assert.equal(await evaluate("document.getElementById('split-primary').value"),'character');
 assert.equal(await evaluate("document.getElementById('split-secondary').value"),'bags');
 assert.equal(await evaluate("document.querySelectorAll('#viewer-panels>[role=tabpanel]:not([hidden])').length"),2);
 await mkdir('artifacts',{recursive:true});
 const shot=await send('Page.captureScreenshot',{format:'png'});await writeFile('artifacts/split-view-layout.png',Buffer.from(shot.data,'base64'));
 for(const width of [900,390]){
  await send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:false});await wait(120);
  assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'),true,`fits ${width}px`);
  assert.equal(await evaluate("(()=>{const a=document.getElementById('character-panel').getBoundingClientRect(),b=document.getElementById('bags-view').getBoundingClientRect();return a.bottom<=b.top && a.width>200 && b.width>200;})()"),true,'narrow windows stack both panes');
 }
 await evaluate("document.getElementById('split-view-toggle').click()");
 assert.equal(await evaluate("document.querySelectorAll('#viewer-panels>[role=tabpanel]:not([hidden])').length"),1);
 assert.equal(await evaluate("document.getElementById('character-panel').hidden"),false);
 assert.equal(await evaluate("document.getElementById('app-tabs').getAttribute('aria-multiselectable')"),'false');
 assert.deepEqual(errors,[]);
 console.log('Split view QA passed: all 12 ordered pairs, swapping and duplicate selection, map sidebar/zoom preservation, saved layout, accessible selected tabs, responsive stacking and single-view recovery.');
}finally{socket.close();await fetch(`http://127.0.0.1:9223/json/close/${target.id}`);}
