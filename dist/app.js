import {decodeAt, findStrip, Freshness} from './protocol.js';

const $ = id => document.getElementById(id);
const canvas = $('map'), ctx = canvas.getContext('2d');
const stage = $('map-stage'), video = $('capture-video');
const readCanvas = document.createElement('canvas'), readCtx = readCanvas.getContext('2d', {willReadFrequently: true});
const preview = $('capture-preview'), previewCtx = preview.getContext('2d');
const freshness = new Freshness();
let maps = [], mapById = new Map(), selected = 1429, image = null, imageRequest = 0;
let stream = null, roi = null, captureWidth = 0, captureHeight = 0, failures = 0, nextSearch = 0;
let demo = false, demoStart = 0, last = null, trail = [], zoom = 1, pan = {x:0,y:0};
let drag = null, selection = null, mapSize = {w:0,h:0};
let statusOverride = null;

function status(text, detail, kind = '') {
  $('status').textContent = text; $('status-detail').textContent = detail; $('status-dot').className = `dot ${kind}`;
}
function message(text) { $('map-message').hidden = !text; $('map-message').textContent = text || ''; }
function mapName(id) { return mapById.get(id)?.name || `Map ${id}`; }

async function selectMap(id, manual = false) {
  selected = Number(id); if (manual) $('follow').checked = false;
  zoom = 1; pan = {x:0,y:0}; image = null;
  $('zone').value = String(selected);
  const meta = mapById.get(selected);
  $('map-title').textContent = meta?.name || `Map ${selected}`;
  $('map-type').textContent = meta ? `${meta.edition === 'tbc' ? 'BURNING CRUSADE' : 'CLASSIC AZEROTH'} · ZONE MAP` : 'MAP NOT AVAILABLE';
  const request = ++imageRequest;
  if (!meta) { message('Map artwork is not available for this area yet. Your coordinates are still shown at the left.'); draw(); return; }
  message('Loading map…'); draw();
  const img = new Image(); img.referrerPolicy = 'no-referrer';
  img.onload = () => { if (request === imageRequest) { image = img; message(null); draw(); } };
  img.onerror = () => { if (request === imageRequest) message('Map image could not load. Check your connection, then select this zone again.'); };
  img.src = meta.url;
}

function accept(packet, now, simulated = false) {
  if (!freshness.accept(packet, now)) return;
  last = packet;
  if (!packet.valid) { trail = []; draw(); return; }
  if ($('follow').checked && selected !== packet.mapId) selectMap(packet.mapId);
  if (trail.length && trail[trail.length-1].mapId !== packet.mapId) trail = [];
  const previous = trail[trail.length-1];
  if (!previous || Math.hypot(previous.x - packet.x, previous.y - packet.y) > .0008) trail.push({...packet});
  if (trail.length > 1500) trail.shift();
  $('location').textContent = mapName(packet.mapId);
  $('coord-x').textContent = (packet.x * 100).toFixed(1);
  $('coord-y').textContent = (packet.y * 100).toFixed(1);
  status(simulated ? 'Simulated journey' : 'Live position', simulated ? 'Demo data only. This is not your character.' : 'Receiving your location from WoW.', simulated ? 'waiting' : 'live');
  draw();
}

function tickStatus(now) {
  const fresh = freshness.isFresh(now);
  if (demo) {
    $('mode-badge').textContent = 'DEMO · SIMULATED POSITION'; $('mode-badge').className = 'map-badge demo';
    $('updated').textContent = 'Simulated data · not connected to WoW';
  } else if (stream && last && fresh) {
    if (last.valid) {
      status('Live position', 'Receiving your location from WoW.', 'live');
      $('mode-badge').textContent = 'LIVE · CONNECTED TO WOW'; $('mode-badge').className = 'map-badge live';
      $('updated').textContent = 'Position received just now';
    } else {
      status('Position unavailable', 'WoW is not reporting a position in this area.', 'waiting');
      $('mode-badge').textContent = 'CONNECTED · NO POSITION'; $('mode-badge').className = 'map-badge';
      $('coord-x').textContent = $('coord-y').textContent = '—'; $('location').textContent = 'Position unavailable in this area';
      $('updated').textContent = 'Waiting for a valid location';
    }
  } else if (stream && last) {
    status('Signal paused', 'Keep WoW and its position strip visible in the shared source.', 'waiting');
    $('mode-badge').textContent = 'PAUSED · LAST KNOWN POSITION'; $('mode-badge').className = 'map-badge';
    $('updated').textContent = `Last update ${Math.floor((now - freshness.changedAt) / 1000)}s ago`;
  } else if (stream) {
    status('Looking for WoW', 'Keep the addon strip visible. Use /alm show in game.', 'waiting');
    $('mode-badge').textContent = 'CONNECTING · WAITING FOR POSITION'; $('mode-badge').className = 'map-badge';
  } else {
    if (!statusOverride) status('Not connected', 'Bring your journey to a second screen.');
    $('mode-badge').textContent = 'BROWSING · NO LIVE POSITION'; $('mode-badge').className = 'map-badge';
  }
  $('map-hint').textContent = demo ? 'Simulated journey · drag to explore' : !stream ? 'Connect WoW to see your character here' : last?.valid && selected !== last.mapId ? 'Browsing another zone · enable Follow my zone to return' : fresh && last?.valid ? 'Your position · drag to explore' : 'Waiting for a fresh position from WoW';
  draw();
}

function resetPosition() {
  freshness.reset(); last = null; trail = [];
  $('location').textContent = 'Waiting for your character'; $('coord-x').textContent = $('coord-y').textContent = '—';
  $('updated').textContent = 'No position received'; draw();
}
function stopCapture() {
  if (stream) stream.getTracks().forEach(track => track.stop());
  stream = null; video.srcObject = null; roi = null; failures = 0;
  $('connect').innerHTML = 'Connect WoW <span aria-hidden="true">↗</span>';
  $('calibrate').hidden = true; $('calibration-dialog').close();
  resetPosition();
}

$('connect').addEventListener('click', async () => {
  statusOverride = null;
  if (stream) { stopCapture(); return; }
  demo = false; $('demo').textContent = 'Explore a simulated journey'; resetPosition();
  if (!navigator.mediaDevices?.getDisplayMedia) {
    statusOverride = true; status('Screen sharing unavailable', 'Open this page in desktop Chromium using HTTPS or localhost.', 'error'); return;
  }
  $('connect').disabled = true;
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({video:{frameRate:{ideal:10,max:15}},audio:false});
    video.srcObject = stream; await video.play();
    stream.getVideoTracks()[0].addEventListener('ended', () => { stopCapture(); statusOverride = true; status('Sharing stopped', 'Connect WoW again to resume your live position.'); });
    $('connect').innerHTML = 'Disconnect <span aria-hidden="true">×</span>'; $('calibrate').hidden = false;
    nextSearch = 0; roi = null; status('Looking for WoW', 'Keep the addon strip visible. Use /alm show in game.', 'waiting');
  } catch (error) {
    stopCapture(); statusOverride = true;
    status(error.name === 'NotAllowedError' ? 'Sharing not started' : 'Capture unavailable', error.name === 'NotAllowedError' ? 'Select the WoW window or its monitor when you connect.' : 'Try a desktop Chromium tab and check Linux screen-sharing support.', 'error');
  } finally { $('connect').disabled = false; }
});

function readROI(rect) {
  readCanvas.width = 500; readCanvas.height = 80;
  readCtx.imageSmoothingEnabled = false;
  readCtx.drawImage(video, rect.x, rect.y, rect.width, rect.height, 0, 0, 500, 80);
  return decodeAt(readCtx.getImageData(0, 0, 500, 80), {x:0,y:0,width:500,height:80});
}

function captureTick(now) {
  if (!stream || video.readyState < 2 || !video.videoWidth) return;
  if (captureWidth !== video.videoWidth || captureHeight !== video.videoHeight) {
    captureWidth = video.videoWidth; captureHeight = video.videoHeight; roi = null; nextSearch = 0;
  }
  try {
    if (roi) {
      const packet = readROI(roi);
      if (packet) { failures = 0; accept(packet, now); }
      else if (++failures > 8) { roi = null; failures = 0; }
    } else if (now >= nextSearch) {
      nextSearch = now + 1200;
      const scale = Math.min(1, 2560 / captureWidth);
      readCanvas.width = Math.round(captureWidth * scale); readCanvas.height = Math.round(captureHeight * scale);
      readCtx.drawImage(video, 0, 0, readCanvas.width, readCanvas.height);
      const found = findStrip(readCtx.getImageData(0,0,readCanvas.width,readCanvas.height));
      if (found) { roi = Object.fromEntries(Object.entries(found.rect).map(([k,v]) => [k,v / scale])); accept(found.packet, now); }
    }
    if ($('calibration-dialog').open) renderPreview();
  } catch { roi = null; }
}

function renderPreview() {
  preview.width = Math.min(1000, video.videoWidth);
  preview.height = Math.round(preview.width / video.videoWidth * video.videoHeight);
  // Preserve the actual image aspect ratio so pointer coordinates still match
  // pixels for portrait monitors and short browser windows.
  preview.style.width = `${Math.min(1000, innerWidth - 100, innerHeight * .58 * video.videoWidth / video.videoHeight)}px`;
  preview.style.maxHeight = 'none';
  previewCtx.drawImage(video,0,0,preview.width,preview.height);
  if (selection) {
    previewCtx.strokeStyle = '#8ae0be'; previewCtx.lineWidth = 2;
    previewCtx.strokeRect(selection.x,selection.y,selection.endX-selection.x,selection.endY-selection.y);
  }
}
$('calibrate').onclick = () => { selection = null; $('calibration-result').textContent = 'Only this page can see this preview.'; renderPreview(); $('calibration-dialog').showModal(); };
$('close-calibration').onclick = () => $('calibration-dialog').close();
function previewPoint(event) {
  const box = preview.getBoundingClientRect();
  return {x:Math.max(0,Math.min(preview.width,(event.clientX-box.left)/box.width*preview.width)),y:Math.max(0,Math.min(preview.height,(event.clientY-box.top)/box.height*preview.height))};
}
preview.onpointerdown = event => { const p = previewPoint(event); selection = {...p,endX:p.x,endY:p.y}; preview.setPointerCapture(event.pointerId); };
preview.onpointermove = event => { if (selection && preview.hasPointerCapture(event.pointerId)) { const p = previewPoint(event); selection.endX=p.x; selection.endY=p.y; renderPreview(); } };
preview.onpointerup = event => {
  if (!selection || !preview.hasPointerCapture(event.pointerId)) return;
  preview.releasePointerCapture(event.pointerId);
  const scale = video.videoWidth/preview.width;
  const rect = {x:Math.min(selection.x,selection.endX)*scale,y:Math.min(selection.y,selection.endY)*scale,width:Math.abs(selection.endX-selection.x)*scale,height:Math.abs(selection.endY-selection.y)*scale};
  if (rect.width < 50 || rect.height < 8) { $('calibration-result').textContent = 'Select the whole strip, including its black border.'; return; }
  const packet = readROI(rect);
  if (packet) { roi=rect; accept(packet,performance.now()); $('calibration-dialog').close(); }
  else $('calibration-result').textContent = 'Could not read that selection. Include the entire black border, or try /alm size 8 in WoW.';
};

function draw() {
  const {w,h} = mapSize; if (!w || !h) return;
  ctx.clearRect(0,0,w,h); ctx.fillStyle='#0b120e'; ctx.fillRect(0,0,w,h);
  if (!image) return;
  const base = Math.min((w-32)/image.width,(h-85)/image.height);
  const iw=image.width*base*zoom, ih=image.height*base*zoom, ox=(w-iw)/2+pan.x, oy=(h-ih)/2+pan.y;
  ctx.save(); ctx.beginPath(); ctx.rect(ox,oy,iw,ih); ctx.clip();
  ctx.drawImage(image,ox,oy,iw,ih);
  ctx.fillStyle='rgba(14,22,13,.07)'; ctx.fillRect(ox,oy,iw,ih);
  if ($('grid').checked) {
    ctx.strokeStyle='rgba(44,44,23,.3)'; ctx.lineWidth=1; ctx.font='10px system-ui';ctx.fillStyle='#282d17';
    for(let i=1;i<10;i++){const x=ox+iw*i/10,y=oy+ih*i/10;ctx.beginPath();ctx.moveTo(x,oy);ctx.lineTo(x,oy+ih);ctx.moveTo(ox,y);ctx.lineTo(ox+iw,y);ctx.stroke();ctx.fillText(String(i*10),x+4,oy+14);ctx.fillText(String(i*10),ox+4,y-4);}
  }
  if ($('trail').checked && trail.length>1 && last?.mapId===selected) {
    ctx.beginPath();trail.forEach((p,i)=>{if(i===0)ctx.moveTo(ox+p.x*iw,oy+p.y*ih);else ctx.lineTo(ox+p.x*iw,oy+p.y*ih);});
    ctx.strokeStyle='#102e24bb';ctx.lineWidth=5;ctx.stroke();ctx.strokeStyle='#93edc9';ctx.lineWidth=2;ctx.stroke();
  }
  if (last?.valid && last.mapId===selected) {
    const fresh=freshness.isFresh(performance.now());ctx.globalAlpha=fresh?1:.4;
    ctx.translate(ox+last.x*iw,oy+last.y*ih);
    ctx.fillStyle='#8ae0be22';ctx.strokeStyle='#dbffe080';ctx.lineWidth=1;ctx.beginPath();ctx.arc(0,0,20,0,Math.PI*2);ctx.fill();ctx.stroke();
    ctx.rotate(-(last.facing||0));ctx.shadowColor='#102b21';ctx.shadowBlur=7;ctx.fillStyle='#b0ffdc';ctx.strokeStyle='#143b2b';ctx.lineWidth=2.5;
    ctx.beginPath();if(last.facing===null)ctx.arc(0,0,7,0,Math.PI*2);else{ctx.moveTo(0,-14);ctx.lineTo(10,10);ctx.lineTo(0,6);ctx.lineTo(-10,10);ctx.closePath();}ctx.fill();ctx.stroke();
  }
  ctx.restore();
  $('zoom-label').textContent = `${Math.round(zoom*100)}%`;
}

new ResizeObserver(() => {
  const r=stage.getBoundingClientRect(), dpr=Math.min(devicePixelRatio||1,2);
  mapSize={w:r.width,h:r.height};canvas.width=Math.round(r.width*dpr);canvas.height=Math.round(r.height*dpr);ctx.setTransform(dpr,0,0,dpr,0,0);draw();
}).observe(stage);
function zoomBy(factor, x=mapSize.w/2,y=mapSize.h/2){const next=Math.min(5,Math.max(.7,zoom*factor)),ratio=next/zoom;pan={x:x-mapSize.w/2-(x-mapSize.w/2-pan.x)*ratio,y:y-mapSize.h/2-(y-mapSize.h/2-pan.y)*ratio};zoom=next;draw();}
$('zoom-in').onclick=()=>zoomBy(1.25);$('zoom-out').onclick=()=>zoomBy(.8);$('fit').onclick=()=>{zoom=1;pan={x:0,y:0};draw();};
stage.addEventListener('wheel',event=>{event.preventDefault();const r=stage.getBoundingClientRect();zoomBy(Math.exp(-event.deltaY*.001),event.clientX-r.left,event.clientY-r.top);},{passive:false});
stage.addEventListener('pointerdown',event=>{if(event.target!==canvas)return;drag={x:event.clientX,y:event.clientY,pan:{...pan}};stage.setPointerCapture(event.pointerId);});
stage.addEventListener('pointermove',event=>{if(drag){pan={x:drag.pan.x+event.clientX-drag.x,y:drag.pan.y+event.clientY-drag.y};draw();}});
stage.addEventListener('pointerup',()=>drag=null);stage.addEventListener('pointercancel',()=>drag=null);
stage.addEventListener('keydown',event=>{if(event.key==='+'||event.key==='=')zoomBy(1.25);else if(event.key==='-')zoomBy(.8);else if(event.key==='0')$('fit').click();});
$('zone').onchange=event=>selectMap(event.target.value,true);
$('follow').onchange=()=>{if($('follow').checked&&last?.valid)selectMap(last.mapId);};
$('trail').onchange=draw;$('grid').onchange=draw;
$('setup').onclick=()=>$('setup-dialog').showModal();$('close-setup').onclick=()=>$('setup-dialog').close();
$('fullscreen').onclick=async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await document.documentElement.requestFullscreen();}catch{statusOverride=true;status('Fullscreen unavailable','You can maximize your browser window instead.','waiting');}};
$('demo').onclick=()=>{
  stopCapture();statusOverride=null;demo=!demo;resetPosition();$('demo').textContent=demo?'End simulated journey':'Explore a simulated journey';
  if(demo){demoStart=performance.now();$('follow').checked=true;selectMap(1429);}else tickStatus(performance.now());
};

setInterval(()=>{
  const now=performance.now();
  if(demo){const t=(now-demoStart)/12000;accept({valid:true,mapId:1429,x:.44+Math.sin(t)*.13,y:.59+Math.sin(t*.7)*.11,facing:Math.atan2(-.13*Math.cos(t),-.077*Math.cos(t*.7)),sequence:Math.floor(now/100)%65536,clock:Math.floor(now)},now,true);}
  else captureTick(now);
  tickStatus(now);
},150);
window.addEventListener('beforeunload',()=>{if(stream)stream.getTracks().forEach(track=>track.stop());});

try {
  const response=await fetch('./maps.json');if(!response.ok)throw new Error('Map catalog unavailable');
  maps=await response.json();mapById=new Map(maps.map(map=>[map.uiMapId,map]));
  for(const map of maps){const option=document.createElement('option');option.value=map.uiMapId;option.textContent=map.name;$('zone').append(option);}
  selectMap(1429);
} catch {message('The map catalog could not load. Reload the page, or start the local server using the project instructions.');}
