// Real Lua quest packets rasterized into a synthetic capture, then decoded by
// the browser. No game/screen-sharing session is touched by this QA script.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdir,writeFile} from 'node:fs/promises';
const artMode=process.argv.includes('--art');
const yuv420=process.argv.includes('--yuv420');

const lua=`
local ns={}; local clock=100
GetTime=function()return clock end
assert(loadfile('addon/AzerothLiveMap/Protocol.lua'))('AzerothLiveMap',ns)
assert(loadfile('addon/AzerothLiveMap/Questie.lua'))('AzerothLiveMap',ns)
ns.QuestSession=777
local qm={questIdFrames={}}
QuestieLoader={ImportModule=function()return qm end}
for zone=1,3 do for quest=1,7 do for spawn=1,10 do
  local id=1000+quest;local name='pin'..zone..'_'..quest..'_'..spawn
  _G[name]={UiMapID=({1429,1944,1946})[zone],x=20+spawn*3,y=20+quest*6,miniMapIcon=false,
    ShouldBeHidden=function()return false end,data={Type='monster',ObjectiveIndex=1,
      QuestData={name='Quête '..quest},ObjectiveData={Collected=3,Needed=8}}}
  qm.questIdFrames[id]=qm.questIdFrames[id] or {};qm.questIdFrames[id][name]=name
end end end
local seq=0
for frame=1,400 do
  clock=100+frame*.1
  if frame==251 then for _,names in pairs(qm.questIdFrames)do for name in pairs(names)do if _G[name].UiMapID==1429 then names[name]=nil end end end end
  local packets={}
  seq=seq+1;packets[1]='['..table.concat(ns.Encode(1944,.2345,.6789,0,seq,clock*1000,4,777,${artMode?'true':'false'}),',')..']'
  for lane=1,4 do seq=seq+1;packets[#packets+1]='['..table.concat(ns.QuestiePacket(1944,.2345,.6789,seq,clock),',')..']' end
  print('['..table.concat(packets,',')..']')
end
`;
const emitted=spawnSync('luajit',['-e',lua],{encoding:'utf8',timeout:5000});
assert.equal(emitted.status,0,emitted.stderr);
const frames=emitted.stdout.trim().split('\n').map(row=>JSON.parse(row));
const target=await(await fetch('http://127.0.0.1:9223/json/new?about:blank',{method:'PUT'})).json();
const socket=new WebSocket(target.webSocketDebuggerUrl);
await new Promise(resolve=>socket.addEventListener('open',resolve,{once:true}));
let serial=0;const pending=new Map(),errors=[];
socket.addEventListener('message',event=>{
  const data=JSON.parse(event.data);
  if(data.id){const request=pending.get(data.id);pending.delete(data.id);if(data.error)request.reject(new Error(JSON.stringify(data.error)));else request.resolve(data.result);}
  else if(data.method==='Runtime.exceptionThrown')errors.push(data.params.exceptionDetails);
});
const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++serial;pending.set(id,{resolve,reject});socket.send(JSON.stringify({id,method,params}));});
const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw new Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const until=async(expression,label)=>{for(let i=0;i<250;i++){if(await evaluate(expression))return;await wait(100);}throw new Error('Timed out: '+label+'; '+await evaluate("document.getElementById('quest-status')?.textContent+' / '+document.getElementById('quest-sync')?.textContent"));};
try{
  await send('Runtime.enable');await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride',{width:1440,height:960,deviceScaleFactor:1,mobile:false});
  await send('Page.addScriptToEvaluateOnNewDocument',{source:`
    localStorage.removeItem('azeroth-live-map.preferences.v1');
    window.__frames=${JSON.stringify(frames)};window.__index=0;
    window.__strip={x:100,y:50,cell:${artMode&&yuv420?2.8:2}};window.__lostLane=-1;window.__artMode=${artMode};
    navigator.mediaDevices.getDisplayMedia=async()=>{
      const {drawStrip}=await import('/protocol.js');
      const {HEADER}=await import('/protocol.js');
      const {drawArtBlock}=await import('/art.js');
      const art=await(await fetch('/elephant-art.json')).json();let ticks=0;
      const c=document.createElement('canvas');c.width=640;c.height=360;
      const ctx=c.getContext('2d');
      const convertVideo=()=>{
        const rgb=ctx.getImageData(0,0,640,360).data,uvSize=320*180,planes=new Uint8Array(640*360+2*uvSize);
        for(let y=0;y<360;y+=2)for(let x=0;x<640;x+=2){
          let cb=0,cr=0;
          for(let dy=0;dy<2;dy++)for(let dx=0;dx<2;dx++){
            const p=(y+dy)*640+x+dx,i=p*4,r=rgb[i],g=rgb[i+1],b=rgb[i+2],yy=.299*r+.587*g+.114*b;
            planes[p]=Math.round(16+219/255*yy);cb+=(b-yy)/(2*(1-.114));cr+=(r-yy)/(2*(1-.299));
          }
          const p=y/2*320+x/2;planes[640*360+p]=Math.round(128+224/255*cb/4);planes[640*360+uvSize+p]=Math.round(128+224/255*cr/4);
        }
        const frame=new VideoFrame(planes,{format:'I420',codedWidth:640,codedHeight:360,timestamp:Math.floor(performance.now()*1000),
          colorSpace:{primaries:'bt709',transfer:'bt709',matrix:'smpte170m',fullRange:false}});
        ctx.drawImage(frame,0,0);frame.close();
      };
      window.__paint=()=>{
        const row=window.__frames[window.__index++%window.__frames.length];
        ctx.fillStyle='#394c40';ctx.fillRect(0,0,c.width,c.height);
        if(window.__artMode){
          let tick=ticks++%art.durations.reduce((sum,n)=>sum+n,0),frame=0;
          while(tick>=art.durations[frame]){tick-=art.durations[frame];frame++;}
          drawArtBlock(ctx,row,art,frame,window.__strip.x,window.__strip.y,window.__strip.cell,HEADER);
        }else row.forEach((bytes,lane)=>{if(lane!==window.__lostLane)drawStrip(ctx,bytes,window.__strip.x,window.__strip.y+lane*8*window.__strip.cell,window.__strip.cell);});
        if(${yuv420})convertVideo();
      };
      window.__paint();window.__timer=setInterval(window.__paint,100);
      window.__stream=c.captureStream(30);return window.__stream;
    };`});
  await send('Page.navigate',{url:'http://localhost:8765'});
  await until("document.querySelectorAll('#zone option').length===70",'app ready');
  const started=Date.now();
  await evaluate("document.getElementById('connect').click()");
  await until("document.getElementById('quest-sync').textContent.includes('210/210 pins') && document.getElementById('quest-sync').textContent.includes('210/210 named')",'all 210 pins/titles across three zones');
  const seconds=(Date.now()-started)/1000;
  assert.ok(seconds<16,`fast optical sync took ${seconds}s`);
  console.log(`210 pins and titles across three zones decoded from capture in ${seconds.toFixed(2)} seconds.`);
  await evaluate("(()=>{const zone=document.getElementById('zone');zone.value='1429';zone.dispatchEvent(new Event('change'));})()");
  await until("document.getElementById('quest-status').textContent.includes('70/70') && document.getElementById('map-message').hidden",'remote Elwynn markers without visiting in game');
  assert.equal(await evaluate("document.getElementById('location').textContent"),'Hellfire Peninsula');
  assert.equal(await evaluate("document.getElementById('quest-list').children.length"),7);
  assert.equal(await evaluate("document.getElementById('follow').checked"),false);
  await mkdir('artifacts',{recursive:true});
  const screenshot=await send('Page.captureScreenshot',{format:'png'});await writeFile(artMode?'artifacts/elephant-live-synthetic.png':'artifacts/all-zone-quests.png',Buffer.from(screenshot.data,'base64'));
  // Move the full 100×80 data block to the bottom-right screen edge.
  await evaluate(`window.__strip={x:540,y:${artMode?224:280},cell:2}`);
  await wait(3000);
  await until("document.getElementById('status').textContent==='Live position' && parseInt(document.getElementById('quest-sync').textContent.split(' · ').at(-1))>0",'taller block reacquired at edge');
  await evaluate("document.getElementById('calibrate').click()");
  const selection=await evaluate(`(()=>{const r=document.getElementById('capture-preview').getBoundingClientRect();return {x1:r.left+538/640*r.width,y1:r.top+${artMode?222:278}/360*r.height,x2:r.right,y2:r.bottom};})()`);
  await send('Input.dispatchMouseEvent',{type:'mousePressed',x:selection.x1,y:selection.y1,button:'left',buttons:1,clickCount:1});
  await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:selection.x2,y:selection.y2,button:'left',buttons:1});
  await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:selection.x2,y:selection.y2,button:'left',buttons:0,clickCount:1});
  await until("!document.getElementById('calibration-dialog').open",'manual selection around entire five-row block');
  // Force the removed-zone segment of the actual Lua stream.
  await evaluate("window.__index=250");
  await until("document.getElementById('quest-status').textContent.includes('No Questie markers')",'remote zone deletion');
  await until("document.getElementById('quest-sync').textContent.includes('140/140 pins')",'overall totals reflect remote removal');
  await evaluate("(()=>{const zone=document.getElementById('zone');zone.value='1946';zone.dispatchEvent(new Event('change'));})()");
  await until("document.getElementById('quest-status').textContent.includes('70/70')",'sibling zone retained after remote deletion');
  await evaluate("clearInterval(window.__timer)");
  await until("document.getElementById('status').textContent==='Signal paused'",'frozen multi-lane capture');
  assert.equal(await evaluate("document.getElementById('quest-list').children.length"),0);
  await evaluate("document.getElementById('connect').click()");
  assert.equal(await evaluate("window.__stream.getTracks().every(track=>track.readyState==='ended')"),true);
  assert.equal(await evaluate("document.getElementById('quest-sync').textContent"),'');
  assert.deepEqual(errors,[]);
  console.log(`${artMode?'Animated elephant':'Plain strip'}${yuv420?' through native I420 video conversion':''} browser QA passed: actual Lua v3 packets, four simultaneous quest packets, remote-zone pins, shared UTF-8 names, live rate/progress, complete-block edge relocation and manual calibration, removed remote zone, retained sibling zone, frozen capture, disconnect cleanup.`);
}finally{socket.close();}
