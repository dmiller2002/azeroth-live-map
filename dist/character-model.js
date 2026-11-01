const PREFIX='/_model/';
const VISIBLE_SLOTS={1:1,3:3,4:4,5:5,6:6,7:7,8:8,9:9,10:10,15:16,16:21,17:22,18:26,19:19};
const STORAGE='azeroth-live-map.model-appearance.v1';
let library=null,itemModels=null;

function script(src){return new Promise((resolve,reject)=>{
  const element=document.createElement('script');element.src=src;element.async=true;
  const timeout=setTimeout(()=>{element.remove();reject(new Error('3D viewer download timed out.'));},15000);
  element.onload=()=>{clearTimeout(timeout);resolve();};element.onerror=()=>{clearTimeout(timeout);element.remove();reject(new Error('3D viewer is unavailable.'));};document.head.append(element);
});}
async function loadLibrary(){
  if(!library)library=(async()=>{
    if(!window.jQuery)await script('./vendor/jquery-3.7.1.min.js');
    window.WH=window.WH||{debug(){},defaultAnimation:'Stand',WebP:{getImageExtension:()=>'.webp'},Wow:{Item:{INVENTORY_TYPE_SHOULDERS:3,INVENTORY_TYPE_ROBE:20,INVENTORY_TYPE_CHEST:5}}};
    if(!window.ZamModelViewer)await script(PREFIX+'viewer.js');
    if(!window.ZamModelViewer)throw new Error('3D viewer did not initialize.');
  })().catch(error=>{library=null;throw error;});
  return library;
}
async function json(path){
  const response=await fetch(path,{signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw new Error('Character model assets are unavailable.');
  return response.json();
}
function appearanceKey(feed){
  const identity=feed.identity,info=identity.info;
  // Save only chosen appearance options, keyed by a character-name hash.
  let hash=2166136261;for(const char of identity.text||'')hash=Math.imul(hash^char.codePointAt(0),16777619)>>>0;
  return `${info.raceId}:${info.sex}:${hash}`;
}
function readAppearance(key){try{return JSON.parse(localStorage.getItem(STORAGE))?.[key]||{};}catch{return {};}}
function saveAppearance(key,choices){try{const all=JSON.parse(localStorage.getItem(STORAGE))||{};all[key]=choices;localStorage.setItem(STORAGE,JSON.stringify(all));}catch{/* Optional display preferences. */}}

export function modelId(race,sex){
  return [1,2,3,4,5,6,7,8,10,11].includes(race) && [2,3].includes(sex)?race*2+(sex===2?-1:0):null;
}
export function equippedModels(feed,mapping){
  const items=[],unknown=[];
  for(const [slot,renderSlot] of Object.entries(VISIBLE_SLOTS)){
    const item=feed.slot(Number(slot))?.info;
    if(!item?.itemId)continue;
    const model=mapping[item.itemId];
    if(!model){unknown.push(item.itemId);continue;}
    items.push({slot:Number(slot)===5 && model[1]===20?20:renderSlot,display:model[0],visual:0});
  }
  return {items,unknown};
}

export function createCharacterModel(){
  const $=id=>document.getElementById(id),stage=$('model-viewport'),status=$('model-status'),form=$('model-appearance-options');
  let viewer=null,loading=false,active=false,epoch=0,identityKey='',gearKey='',failed=false,feed=null,options=[],choices={},key='',paused=false,angle=0,zoom=1;
  let observer=new ResizeObserver(()=>resize());observer.observe(stage);
  function message(text,state){status.textContent=text;stage.dataset.state=state;$('model-retry').hidden=state!=='error';for(const button of document.querySelectorAll('.model-controls button'))button.disabled=state!=='ready';}
  function destroy(){
    epoch++;loading=false;try{viewer?.destroy();}catch{/* A failed renderer still clears its canvas. */}viewer=null;stage.replaceChildren();identityKey='';gearKey='';form.replaceChildren();options=[];
  }
  function resize(){
    if(!viewer || !active)return;
    const r=stage.getBoundingClientRect();if(r.width<1 || r.height<1)return;
    viewer.aspect=r.width/r.height;viewer.options.aspect=viewer.aspect;viewer.renderer?.resize?.(Math.round(r.width),Math.round(r.height));
  }
  function camera(){
    if(!viewer?.renderer)return;
    viewer.renderer.azimuth=angle;
    viewer.setZoom?.(zoom);
    stage.dataset.rotation=String(Math.round(angle*180/Math.PI));stage.dataset.zoom=String(Math.round(zoom*100));
    stage.setAttribute('aria-label',`3D character. Drag to rotate. Scroll to zoom. Arrow keys rotate; plus and minus zoom. Rotation ${stage.dataset.rotation} degrees, zoom ${stage.dataset.zoom} percent.`);
  }
  function rotate(delta){angle=(viewer?.renderer?.azimuth??angle)+delta;camera();}
  function magnify(delta){zoom=Math.max(.55,Math.min(1.8,(viewer?.renderer?.zoom?.target??zoom)+delta));camera();}
  $('model-left').onclick=()=>rotate(-Math.PI/8);$('model-right').onclick=()=>rotate(Math.PI/8);
  $('model-zoom-in').onclick=()=>magnify(.1);$('model-zoom-out').onclick=()=>magnify(-.1);
  $('model-reset').onclick=()=>{angle=0;zoom=1;camera();};
  $('model-pause').onclick=()=>{paused=!paused;viewer?.method('setAnimPaused',[paused]);$('model-pause').setAttribute('aria-pressed',String(paused));$('model-pause').textContent=paused?'Play':'Pause';};
  stage.addEventListener('keydown',event=>{
    if(event.key==='ArrowLeft')rotate(-Math.PI/8);else if(event.key==='ArrowRight')rotate(Math.PI/8);else if(['+','='].includes(event.key))magnify(.1);else if(event.key==='-')magnify(-.1);else return;
    event.preventDefault();
  });
  function applyAppearance(){
    if(!viewer || !feed?.identity?.info)return;
    const info=feed.identity.info;
    viewer.method('setAppearance',[{race:info.raceId,gender:info.sex===2?0:1,options:options.map(option=>({optionId:option.Id,choiceId:choices[option.Id]}))}]);
  }
  function appearanceControls(customizations){
    options=customizations.Options||[];choices=readAppearance(key);form.replaceChildren();
    for(const option of options){
      const allowed=option.Choices||[];if(!allowed.length)continue;
      if(!allowed.some(choice=>choice.Id===choices[option.Id]))choices[option.Id]=allowed[0].Id;
      const label=document.createElement('label'),name=document.createElement('span'),select=document.createElement('select');name.textContent=option.Name;
      for(const [i,choice] of allowed.entries()){const entry=document.createElement('option');entry.value=choice.Id;entry.textContent=choice.Name||`Option ${i+1}`;select.append(entry);}
      select.value=choices[option.Id];select.onchange=()=>{choices[option.Id]=Number(select.value);saveAppearance(key,choices);applyAppearance();};
      label.append(name,select);form.append(label);
    }
  }
  async function gear(){
    if(!viewer || !feed)return;
    const request=epoch;
    const mapping=await(itemModels||(itemModels=json('./item-models.json').catch(error=>{itemModels=null;throw error;})));
    if(request!==epoch || !viewer)return;
    const {items,unknown}=equippedModels(feed,mapping),signature=JSON.stringify(items);
    if(signature!==gearKey){
      for(const slot of Object.values(VISIBLE_SLOTS).concat(20))viewer.method('clearSlots',[String(slot)]);
      if(items.length)viewer.method('setItems',[items]);gearKey=signature;
    }
    message(unknown.length?`3D preview · ${unknown.length} equipped item${unknown.length===1?'':'s'} unavailable in model data`:'3D preview · equipped gear synced','ready');
  }
  async function start(){
    if(loading || !feed?.identity?.info)return;
    loading=true;failed=false;const request=++epoch,info=feed.identity.info,id=modelId(info.raceId,info.sex);
    if(!id){loading=false;failed=true;message('This character’s model is not supported.','error');return;}
    identityKey=`${feed.session}:${info.raceId}:${info.sex}`;key=appearanceKey(feed);
    message('Loading your character’s 3D model…','loading');
    try{
      const [,metadata]=await Promise.all([loadLibrary(),json(PREFIX+`meta/charactercustomization/${id}.json`)]);
      if(request!==epoch || !active)return;
      appearanceControls(metadata);
      const r=stage.getBoundingClientRect();
      viewer=new window.ZamModelViewer({type:2,contentPath:PREFIX,container:window.jQuery(stage),aspect:r.width/r.height,models:{type:16,id},charCustomization:{options:options.map(option=>({optionId:option.Id,choiceId:choices[option.Id]}))},items:[],dataEnv:'tbc',env:'tbc',gameDataEnv:'tbc',hd:false,physics:false});
      angle=0;zoom=1;camera();viewer.method('setAnimPaused',[paused]);
      // Metadata and meshes load asynchronously inside the renderer.
      const deadline=performance.now()+20000;let settled=0;
      while(request===epoch && performance.now()<deadline){
        settled=viewer.renderer?.actors?.length && !Object.keys(viewer.renderer.downloads||{}).length?settled+1:0;
        if(settled>=3)break;
        await new Promise(resolve=>setTimeout(resolve,100));
      }
      if(request!==epoch)return;
      if(!viewer.renderer?.actors?.length || !stage.querySelector('canvas'))throw new Error('Your browser could not create the 3D preview.');
      viewer.method('setAnimPaused',[paused]);loading=false;await gear();resize();
    }catch(error){if(request===epoch){destroy();failed=true;message(error.message||'3D preview unavailable.','error');}}
  }
  $('model-retry').onclick=()=>{failed=false;start();};
  return {update({available,currentFeed}){
    feed=currentFeed;
    const visible=available && !$('character-panel').hidden;
    if(!visible){if(active || viewer || loading)destroy();active=false;failed=false;message(available?'Open Character to view your 3D model.':'Connect WoW to load your character’s model.','waiting');return;}
    active=true;
    if(!feed.identity?.info || !feed.identity.text || Array.from({length:19},(_,i)=>feed.slot(i+1)?.info).some(item=>!item)){message('Waiting for your character and equipment to sync…','waiting');return;}
    const info=feed.identity.info,nextIdentity=`${feed.session}:${info.raceId}:${info.sex}`;
    if(viewer && nextIdentity!==identityKey)destroy();
    if(!viewer && !loading && !failed)start();
    else if(viewer && !loading)gear().catch(()=>message('Equipped-item model data is unavailable.','error'));
  },destroy};
}
