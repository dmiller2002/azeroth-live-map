import {decodeAt, decodeBlock, decodeBytes, findStrip, Freshness, HEADER} from './protocol.js';
import {artGeometry, decodeArtAt} from './art.js';
import {loadPreferences, savePreferences} from './prefs.js';
import {QuestFeed, QUEST_KINDS, questColor} from './quests.js';
import {buildMapCatalog, mapViewport, hitTestMap} from './navigation.js';
import {CharacterFeed, createCharacterPanel} from './character.js';

const $ = id => document.getElementById(id);
const canvas = $('map'), ctx = canvas.getContext('2d');
const stage = $('map-stage'), video = $('capture-video');
const readCanvas = document.createElement('canvas'), readCtx = readCanvas.getContext('2d', {willReadFrequently: true});
const preview = $('capture-preview'), previewCtx = preview.getContext('2d');
const freshness = new Freshness();
const questFeed = new QuestFeed();
const characterFeed = new CharacterFeed(), characterPanel = createCharacterPanel(characterFeed);
let questPins = [], questListKey = '', focusedQuest = null;
let maps = [], mapById = new Map(), selected = 1429, image = null, imageRequest = 0;
let stream = null, roi = null, captureWidth = 0, captureHeight = 0, failures = 0, nextSearch = 0;
let demo = false, demoStart = 0, last = null, trail = [], zoom = 1, pan = {x:0,y:0};
let drag = null, selection = null, mapSize = {w:0,h:0};
let viewport = null, mapChildren = [], hoveredMap = null;
let statusOverride = null;
let lastCaptureKey = null;
let artAsset = null, roiArt = false;
const artReady = fetch('./elephant-art.json').then(response=>response.ok?response.json():null).then(asset=>artAsset=asset).catch(()=>null);
const preferences = loadPreferences();
for (const key of ['follow','trail','grid','quests']) $(key).checked = preferences[key];

function setMapOnly(enabled, save = true) {
  document.body.classList.toggle('map-only', enabled);
  $('controls-panel').inert = enabled;
  $('toggle-controls').setAttribute('aria-expanded', String(!enabled));
  $('toggle-controls').textContent = enabled ? 'Show controls' : 'Hide controls';
  $('quick-connection').hidden = !enabled;
  if (save) savePreferences({mapOnly:enabled});
}
setMapOnly(preferences.mapOnly, false);
$('toggle-controls').onclick = () => setMapOnly(!document.body.classList.contains('map-only'));
$('quick-connect').onclick = () => $('connect').click();
$('wow-minimap').onclick = () => { $('minimap-copy-status').textContent='';$('minimap-dialog').showModal(); };
$('close-minimap').onclick = () => $('minimap-dialog').close();
for(const action of ['hide','show']){
  $(`copy-minimap-${action}`).onclick = async () => {
    const input=$(`minimap-${action}-command`);
    try{
      if(!navigator.clipboard?.writeText)throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(input.value);
      $('minimap-copy-status').textContent=`${action==='hide'?'Hide':'Show'} command copied. Paste into WoW chat and press Enter.`;
    }catch{
      input.focus();input.select();
      $('minimap-copy-status').textContent='Clipboard unavailable. Copy the selected command, then paste it into WoW chat and press Enter.';
    }
  };
}

function status(text, detail, kind = '') {
  $('status').textContent = text; $('status-detail').textContent = detail; $('status-dot').className = `dot ${kind}`;
  $('quick-status').textContent = text; $('quick-status').title = detail; $('quick-status-dot').className = `dot ${kind}`;
}
function message(text) { $('map-message').hidden = !text; $('map-message').textContent = text || ''; }
function mapName(id) { return mapById.get(id)?.name || `Map ${id}`; }

async function selectMap(id, manual = false) {
  selected = Number(id); if (manual) $('follow').checked = false;
  if (manual) savePreferences({zone:selected, follow:false});
  zoom = 1; pan = {x:0,y:0}; image = null; viewport = null;
  hoveredMap = null; stage.style.cursor = ''; drag = null;
  $('quest-tooltip').hidden = true; $('area-tooltip').hidden = true;
  $('zoom-label').textContent = '100%';
  $('zone').value = String(selected);
  const meta = mapById.get(selected);
  $('map-title').textContent = meta?.name || `Map ${selected}`;
  $('map-type').textContent = meta ? `${meta.edition === 'tbc' ? 'BURNING CRUSADE' : 'CLASSIC AZEROTH'} · ${meta.kind.toUpperCase()} MAP` : 'MAP NOT AVAILABLE';
  mapChildren = maps.filter(map => map.parentId === selected && (map.polygon || map.entrance));
  updateNavigation(meta);
  const request = ++imageRequest;
  if (!meta) { message('Map artwork is not available for this area yet. Your coordinates are still shown at the left.'); draw(); return; }
  message('Loading map…'); draw();
  const img = new Image(); img.referrerPolicy = 'no-referrer';
  img.onload = () => { if (request === imageRequest) { image = img; message(null); draw(); } };
  img.onerror = () => { if (request === imageRequest) message('Map image could not load. Check your connection, then select this zone again.'); };
  img.src = meta.url;
}

function updateNavigation(meta) {
  const path = [], seen = new Set();
  // Unknown live maps can still return to the world browser.
  for (let map = meta || mapById.get(946); map && !seen.has(map.uiMapId); map = mapById.get(map.parentId)) {
    seen.add(map.uiMapId); path.unshift(map);
  }
  $('map-path').replaceChildren();
  for (const map of path) {
    const button = document.createElement('button');
    button.textContent = map.name;
    if (map.uiMapId === selected) button.setAttribute('aria-current','location');
    button.onclick = () => selectMap(map.uiMapId,true);
    $('map-path').append(button);
  }
  const parent = mapById.get(meta?.parentId ?? (meta ? null : 946));
  $('map-up').disabled = !parent;
  $('map-up').title = parent ? `Go up to ${parent.name} (right-click or Backspace)` : 'At the outermost map';
  $('map-up').setAttribute('aria-label',parent ? `Go up to ${parent.name}` : 'At the outermost map');
}

function navigateUp() {
  const meta = mapById.get(selected);
  const parentId = meta ? meta.parentId : 946;
  if (mapById.has(parentId)) selectMap(parentId,true);
}
$('map-up').onclick = navigateUp;

function accept(packet, now, simulated = false) {
  if (packet.type === 'quest') { questFeed.accept(packet, now); return; }
  if (packet.type === 'character') {
    if(last && packet.session===last.questSession)characterFeed.accept(packet,now);
    return;
  }
  if (!freshness.accept(packet, now)) return;
  if(last && packet.questSession!==last.questSession){questFeed.reset();characterFeed.reset();focusedQuest=null;}
  if (last && packet.mapId !== last.mapId) focusedQuest = null;
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
  characterPanel.update(now,{connected:Boolean(stream),fresh,demo});
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
  $('quick-coordinates').textContent = `X ${$('coord-x').textContent} · Y ${$('coord-y').textContent}`;
  $('quick-connect').textContent = stream ? 'Disconnect ×' : 'Connect WoW ↗';
  $('quick-connect').disabled = $('connect').disabled;
  updateQuests(now);
  draw();
}

function currentQuests(now) {
  if (demo || !stream || !last || !freshness.isFresh(now) || !mapById.has(selected) || !$('quests').checked) return [];
  return questFeed.visible(selected, now);
}

function updateQuests(now) {
  const markers = currentQuests(now);
  const zone = questFeed.zone(selected), progress = questFeed.progress(now);
  let text;
  if (!$('quests').checked) text = 'Questie layer hidden.';
  else if (demo) text = 'Connect WoW for your real Questie markers.';
  else if (!stream) text = 'Connect WoW to receive Questie markers.';
  else if (!last || !freshness.isFresh(now)) text = 'Waiting for a live signal; quest markers are hidden.';
  else if (!mapById.has(selected)) text = 'Quest markers need map artwork for this zone.';
  else if (!questFeed.isFresh(now)) text = 'Waiting for Questie data. Keep every data row visible and update the companion addon.';
  else if (questFeed.status === 0) text = 'Questie is not loaded. Enable it in WoW, then /reload.';
  else if (questFeed.status === 2) text = 'Questie is loading or its marker format is unsupported. Try /reload.';
  else if (['cosmic','world','continent'].includes(mapById.get(selected)?.kind)) text = 'Open a zone to see its quest markers.';
  else if (questFeed.version===2 && !zone) text = 'Update the companion addon for all-zone quest sync.';
  else if (!zone) text = 'This zone has not arrived yet, or Questie has no markers here.';
  else if (!zone.count) text = 'No Questie markers in this zone. Questie’s map filters apply.';
  else text = `${markers.length}/${zone.count} markers${markers.length < zone.count ? ' · syncing…' : ' · synced'}${zone.limited ? ' · protocol limit reached' : ''}`;
  $('quest-status').textContent = text;
  $('quest-sync').textContent = stream && !demo && questFeed.isFresh(now) && questFeed.status===1
    ? `${questFeed.version===3?'All zones':'Legacy sync'}: ${progress.received}/${progress.expected} pins · ${progress.zones}/${progress.zoneCount} zones · ${progress.named}/${progress.received} named · ${progress.rate} packets/s`
    : '';
  if (!markers.length) $('quest-tooltip').hidden = true;
  const key = JSON.stringify(markers.map(m => [m.questId,m.title,m.markerKind,m.objective,m.collected,m.needed]));
  if (key === questListKey) return;
  questListKey = key;
  $('quest-list').replaceChildren();
  const groups = new Map();
  for (const marker of markers) {
    const id = `${marker.questId}:${marker.markerKind}:${marker.objective}`;
    if (!groups.has(id)) groups.set(id, marker);
  }
  for (const marker of groups.values()) {
    const button = document.createElement('button'); button.className = 'quest-entry';
    button.style.setProperty('--quest-color', questColor(marker.questId));
    const title = document.createElement('span'); title.textContent = marker.title;
    const detail = document.createElement('small');
    detail.textContent = `${QUEST_KINDS[marker.markerKind]}${marker.markerKind === 2 && marker.objective ? ` ${marker.objective}` : ''}${marker.needed ? ` · ${marker.collected}/${marker.needed}` : ''}`;
    button.append(title,detail);
    button.onclick = () => { focusedQuest = marker.questId; pan = {x:0,y:0}; zoom = 1; draw(); };
    button.title = `Highlight ${marker.title} on the map`;
    $('quest-list').append(button);
  }
}

function resetPosition() {
  freshness.reset(); last = null; trail = [];
  lastCaptureKey = null;
  questFeed.reset(); characterFeed.reset(); focusedQuest = null; questPins = []; $('quest-tooltip').hidden = true;
  $('location').textContent = 'Waiting for your character'; $('coord-x').textContent = $('coord-y').textContent = '—';
  $('updated').textContent = 'No position received'; updateQuests(performance.now()); draw();
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
  $('quick-connect').disabled = true;
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({video:{frameRate:{ideal:30,max:30}},audio:false});
    video.srcObject = stream; await video.play();
    stream.getVideoTracks()[0].addEventListener('ended', () => { stopCapture(); statusOverride = true; status('Sharing stopped', 'Connect WoW again to resume your live position.'); });
    $('connect').innerHTML = 'Disconnect <span aria-hidden="true">×</span>'; $('calibrate').hidden = false;
    nextSearch = 0; roi = null; status('Looking for WoW', 'Keep the addon strip visible. Use /alm show in game.', 'waiting');
  } catch (error) {
    stopCapture(); statusOverride = true;
    status(error.name === 'NotAllowedError' ? 'Sharing not started' : 'Capture unavailable', error.name === 'NotAllowedError' ? 'Select the WoW window or its monitor when you connect.' : 'Try a desktop Chromium tab and check Linux screen-sharing support.', 'error');
  } finally { $('connect').disabled = false; $('quick-connect').disabled = false; }
});

function readROI(rect) {
  readCanvas.width = 500; readCanvas.height = 80;
  readCtx.imageSmoothingEnabled = false;
  readCtx.drawImage(video, rect.x, rect.y, rect.width, rect.height, 0, 0, 500, 80);
  return decodeAt(readCtx.getImageData(0, 0, 500, 80), {x:0,y:0,width:500,height:80});
}

function readDataBlock(rect, isArt = roiArt) {
  if(isArt){
    if(!artAsset)return [];
    const box=artGeometry(rect,artAsset);
    if(box.y<0 || box.x<0 || box.x+box.width>video.videoWidth+1 || box.y+box.height>video.videoHeight+1)return [];
    const cell=10;
    readCanvas.width=artAsset.width*cell;readCanvas.height=(artAsset.height+artAsset.footerRows)*cell;
    readCtx.imageSmoothingEnabled=false;
    readCtx.drawImage(video,box.x,box.y,box.width,box.height,0,0,readCanvas.width,readCanvas.height);
    return decodeArtAt(readCtx.getImageData(0,0,readCanvas.width,readCanvas.height),
      {x:0,y:artAsset.height*cell,width:500,height:80},artAsset,decodeBytes,HEADER)?.packets||[];
  }
  const first = readROI(rect);
  if (!first) return [];
  if (!first.questLanes) return [first];
  const height = rect.height * (first.questLanes + 1);
  if (rect.y + height > video.videoHeight + 1) return [first];
  readCanvas.width=500;readCanvas.height=80*(first.questLanes+1);
  readCtx.imageSmoothingEnabled=false;
  readCtx.drawImage(video,rect.x,rect.y,rect.width,height,0,0,readCanvas.width,readCanvas.height);
  return decodeBlock(readCtx.getImageData(0,0,readCanvas.width,readCanvas.height),{x:0,y:0,width:500,height:80});
}

function acceptBlock(packets,now) {
  if (!packets.length) return;
  const key=`${packets[0].type||'position'}:${packets[0].sequence}:${packets[0].clock??''}`;
  if (key===lastCaptureKey) return;
  lastCaptureKey=key;
  for(const packet of packets)accept(packet,now);
}

function captureTick(now) {
  if (!stream || video.readyState < 2 || !video.videoWidth) return;
  if (captureWidth !== video.videoWidth || captureHeight !== video.videoHeight) {
    captureWidth = video.videoWidth; captureHeight = video.videoHeight; roi = null; nextSearch = 0;
  }
  try {
    if (roi) {
      const packets = readDataBlock(roi);
      if (packets.length) { failures = 0; acceptBlock(packets, now); }
      else if (++failures > 8) { roi = null; failures = 0; }
    } else if (now >= nextSearch) {
      nextSearch = now + 1200;
      const scale = Math.min(1, 2560 / captureWidth);
      readCanvas.width = Math.round(captureWidth * scale); readCanvas.height = Math.round(captureHeight * scale);
      readCtx.drawImage(video, 0, 0, readCanvas.width, readCanvas.height);
      const found = findStrip(readCtx.getImageData(0,0,readCanvas.width,readCanvas.height),artAsset);
      if (found) { roiArt=Boolean(found.art);roi = Object.fromEntries(Object.entries(found.rect).map(([k,v]) => [k,v / scale])); acceptBlock(readDataBlock(roi), now); }
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
  let packets = readDataBlock(rect,false), detectedRect=rect, detectedArt=false;
  if(!packets.length){
    // Accept a selection around the entire taller block as well as just its
    // top row. Search the crop for the original position-row header.
    readCanvas.width=Math.ceil(rect.width);readCanvas.height=Math.ceil(rect.height);
    readCtx.drawImage(video,rect.x,rect.y,rect.width,rect.height,0,0,readCanvas.width,readCanvas.height);
    const found=findStrip(readCtx.getImageData(0,0,readCanvas.width,readCanvas.height),artAsset);
    if(found){detectedArt=Boolean(found.art);detectedRect={...found.rect,x:rect.x+found.rect.x,y:rect.y+found.rect.y};packets=readDataBlock(detectedRect,detectedArt);}
  }
  if (packets.length) { roiArt=detectedArt;roi=detectedRect; acceptBlock(packets,performance.now()); $('calibration-dialog').close(); }
  else $('calibration-result').textContent = 'Could not read that selection. Include the entire black border, or try /alm size 8 in WoW.';
};

function draw() {
  questPins = [];
  const {w,h} = mapSize; if (!w || !h) return;
  ctx.clearRect(0,0,w,h); ctx.fillStyle='#0b120e'; ctx.fillRect(0,0,w,h);
  if (!image) return;
  viewport = mapViewport(w,h,image.width,image.height,zoom,pan);
  const {w:iw,h:ih,x:ox,y:oy} = viewport;
  ctx.save(); ctx.beginPath(); ctx.rect(ox,oy,iw,ih); ctx.clip();
  ctx.drawImage(image,ox,oy,iw,ih);
  ctx.fillStyle='rgba(14,22,13,.07)'; ctx.fillRect(ox,oy,iw,ih);
  if (hoveredMap?.polygon) {
    ctx.beginPath();
    hoveredMap.polygon.forEach(([x,y],i) => i ? ctx.lineTo(ox+x*iw,oy+y*ih) : ctx.moveTo(ox+x*iw,oy+y*ih));
    ctx.closePath(); ctx.fillStyle='#ffe6a52b'; ctx.fill();
    ctx.strokeStyle='#fff1b9bb'; ctx.lineWidth=2; ctx.stroke();
  }
  for (const child of mapChildren.filter(map => map.entrance)) {
    const x=ox+child.entrance.x*iw,y=oy+child.entrance.y*ih;
    ctx.beginPath();ctx.arc(x,y,12,0,Math.PI*2);
    ctx.fillStyle=hoveredMap===child?'#ffe8ac':'#273522';ctx.fill();ctx.strokeStyle='#e0c389';ctx.lineWidth=2;ctx.stroke();
    ctx.font='bold 16px system-ui';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillStyle=hoveredMap===child?'#273522':'#ffe8ac';ctx.fillText('↗',x,y);
  }
  if ($('grid').checked) {
    ctx.strokeStyle='rgba(44,44,23,.3)'; ctx.lineWidth=1; ctx.font='10px system-ui';ctx.fillStyle='#282d17';
    for(let i=1;i<10;i++){const x=ox+iw*i/10,y=oy+ih*i/10;ctx.beginPath();ctx.moveTo(x,oy);ctx.lineTo(x,oy+ih);ctx.moveTo(ox,y);ctx.lineTo(ox+iw,y);ctx.stroke();ctx.fillText(String(i*10),x+4,oy+14);ctx.fillText(String(i*10),ox+4,y-4);}
  }
  if ($('trail').checked && trail.length>1 && last?.mapId===selected) {
    ctx.beginPath();trail.forEach((p,i)=>{if(i===0)ctx.moveTo(ox+p.x*iw,oy+p.y*ih);else ctx.lineTo(ox+p.x*iw,oy+p.y*ih);});
    ctx.strokeStyle='#102e24bb';ctx.lineWidth=5;ctx.stroke();ctx.strokeStyle='#93edc9';ctx.lineWidth=2;ctx.stroke();
  }
  for (const marker of currentQuests(performance.now())) {
    const x = ox + marker.x * iw, y = oy + marker.y * ih;
    questPins.push({...marker, screenX:x, screenY:y});
    ctx.save(); ctx.translate(x,y);
    ctx.globalAlpha = focusedQuest && marker.questId !== focusedQuest ? .35 : 1;
    ctx.shadowColor = '#09130c'; ctx.shadowBlur = 4;
    ctx.fillStyle = questColor(marker.questId); ctx.strokeStyle = '#14201b'; ctx.lineWidth = 2;
    ctx.beginPath();
    if (marker.markerKind === 2) { ctx.moveTo(0,-7); ctx.lineTo(7,0); ctx.lineTo(0,7); ctx.lineTo(-7,0); ctx.closePath(); }
    else ctx.arc(0,0,10,0,Math.PI*2);
    ctx.fill(); ctx.stroke();
    if (marker.markerKind !== 2) { ctx.shadowBlur = 0; ctx.fillStyle='#14201b'; ctx.font='bold 15px system-ui'; ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.fillText(marker.markerKind === 1 ? '!' : '?',0,0); }
    if (focusedQuest === marker.questId) { ctx.strokeStyle='#fff8d2'; ctx.lineWidth=2; ctx.beginPath(); ctx.arc(0,0,14,0,Math.PI*2); ctx.stroke(); }
    ctx.restore();
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
stage.addEventListener('contextmenu',event=>{
  if (event.target !== canvas && event.target !== stage) return;
  event.preventDefault(); navigateUp();
});
stage.addEventListener('pointerdown',event=>{
  if(event.target!==canvas || event.button!==0 || drag)return;
  drag={pointerId:event.pointerId,x:event.clientX,y:event.clientY,pan:{...pan},moved:false};
  stage.setPointerCapture(event.pointerId);
});
stage.addEventListener('pointermove',event=>{
  const tooltip = $('quest-tooltip'); tooltip.hidden = true; $('area-tooltip').hidden = true;
  if(drag){
    if (drag.pointerId !== event.pointerId) return;
    if (Math.hypot(event.clientX-drag.x,event.clientY-drag.y)>5) drag.moved=true;
    if (drag.moved) { hoveredMap=null;stage.style.cursor='grabbing';pan={x:drag.pan.x+event.clientX-drag.x,y:drag.pan.y+event.clientY-drag.y};draw(); }
    return;
  }
  const r=stage.getBoundingClientRect(), x=event.clientX-r.left, y=event.clientY-r.top;
  const marker=questPins.find(pin=>Math.hypot(pin.screenX-x,pin.screenY-y)<13);
  const child=event.target===canvas && image ? hitTestMap(mapChildren,x,y,viewport) : null;
  if (hoveredMap !== child) { hoveredMap=child;draw(); }
  stage.style.cursor=child || marker ? 'pointer' : '';
  if(marker){
    tooltip.style.borderColor=questColor(marker.questId);
    tooltip.textContent=`${marker.title} · ${QUEST_KINDS[marker.markerKind]}${marker.markerKind === 2 && marker.objective ? ` ${marker.objective}` : ''}${marker.needed ? ` · ${marker.collected}/${marker.needed}` : ''} · ${(marker.x*100).toFixed(1)}, ${(marker.y*100).toFixed(1)}`;
    tooltip.style.left=`${Math.max(8,Math.min(r.width-250,x+16))}px`;tooltip.style.top=`${Math.max(8,y-50)}px`;tooltip.hidden=false;
  } else if (child) {
    const areaTooltip=$('area-tooltip');areaTooltip.textContent=`${child.name} · Click to open`;
    areaTooltip.style.left=`${Math.max(8,Math.min(r.width-230,x+16))}px`;areaTooltip.style.top=`${Math.max(8,y-42)}px`;areaTooltip.hidden=false;
  }
});
stage.addEventListener('pointerleave',()=>{$('quest-tooltip').hidden=true;$('area-tooltip').hidden=true;hoveredMap=null;stage.style.cursor='';draw();});
stage.addEventListener('pointerup',event=>{
  if (!drag || drag.pointerId !== event.pointerId || event.button!==0) return;
  const moved=drag.moved || Math.hypot(event.clientX-drag.x,event.clientY-drag.y)>5;
  drag=null;
  if(stage.hasPointerCapture(event.pointerId))stage.releasePointerCapture(event.pointerId);
  stage.style.cursor='';
  if (moved || !image) return;
  const r=stage.getBoundingClientRect(),x=event.clientX-r.left,y=event.clientY-r.top;
  const marker=questPins.find(pin=>Math.hypot(pin.screenX-x,pin.screenY-y)<13);
  if (marker) { focusedQuest=marker.questId;draw();return; }
  const child=hitTestMap(mapChildren,x,y,viewport);
  if(child)selectMap(child.uiMapId,true);
});
for (const event of ['pointercancel','lostpointercapture']) stage.addEventListener(event,()=>{drag=null;stage.style.cursor='';});
stage.addEventListener('keydown',event=>{
  if (event.target!==stage && event.target!==canvas) return;
  if(event.key==='+'||event.key==='=')zoomBy(1.25);else if(event.key==='-')zoomBy(.8);else if(event.key==='0')$('fit').click();
  else if(event.key==='Backspace' || (event.altKey && event.key==='ArrowUp')) {event.preventDefault();navigateUp();}
});
$('zone').onchange=event=>selectMap(event.target.value,true);
$('follow').onchange=()=>{savePreferences({follow:$('follow').checked});if($('follow').checked&&last?.valid)selectMap(last.mapId);};
for (const key of ['trail','grid','quests']) $(key).onchange=()=>{savePreferences({[key]:$(key).checked});$('quest-tooltip').hidden=true;updateQuests(performance.now());draw();};
$('setup').onclick=()=>$('setup-dialog').showModal();$('close-setup').onclick=()=>$('setup-dialog').close();
$('fullscreen').onclick=async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await document.documentElement.requestFullscreen();}catch{statusOverride=true;status('Fullscreen unavailable','You can maximize your browser window instead.','waiting');}};
$('demo').onclick=()=>{
  stopCapture();statusOverride=null;demo=!demo;resetPosition();$('demo').textContent=demo?'End simulated journey':'Explore a simulated journey';
  if(demo){demoStart=performance.now();$('follow').checked=true;selectMap(1429);}else tickStatus(performance.now());
};

setInterval(()=>{
  const now=performance.now();
  if(demo){const t=(now-demoStart)/12000;accept({valid:true,mapId:1429,x:.44+Math.sin(t)*.13,y:.59+Math.sin(t*.7)*.11,facing:Math.atan2(-.13*Math.cos(t),-.077*Math.cos(t*.7)),sequence:Math.floor(now/100)%65536,clock:Math.floor(now)},now,true);}
  else if (!video.requestVideoFrameCallback) captureTick(now);
  tickStatus(now);
},150);
// Decode each delivered capture frame, independently of the slower UI refresh.
// Repeated/frozen frames cannot refresh either the position or quest feed.
if(video.requestVideoFrameCallback){
  const onFrame=now=>{if(!demo)captureTick(now);video.requestVideoFrameCallback(onFrame);};
  video.requestVideoFrameCallback(onFrame);
}
window.addEventListener('beforeunload',()=>{if(stream)stream.getTracks().forEach(track=>track.stop());});

try {
  await artReady;
  const response=await fetch('./maps.json');if(!response.ok)throw new Error('Map catalog unavailable');
  maps=buildMapCatalog(await response.json());mapById=new Map(maps.map(map=>[map.uiMapId,map]));
  for (const [label,kinds] of [['World & continents',['cosmic','world','continent']],['Zones & cities',['zone','city']],['Battlegrounds',['battleground']]]) {
    const group=document.createElement('optgroup');group.label=label;
    for(const map of maps.filter(map=>kinds.includes(map.kind))){const option=document.createElement('option');option.value=map.uiMapId;option.textContent=map.name;group.append(option);}
    $('zone').append(group);
  }
  selectMap(mapById.has(preferences.zone) ? preferences.zone : 1429);
} catch {message('The map catalog could not load. Reload the page, or start the local server using the project instructions.');}
