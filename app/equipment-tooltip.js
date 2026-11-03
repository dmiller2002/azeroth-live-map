// One shared request supplies icons and Forever item descriptions.
// The live name, item level and durability always come from the capture.
const details=new Map();
export function getItemDetails(id){
  const existing=details.get(id);
  if(existing && existing.expires>Date.now())return existing.promise;
  const cached={expires:Infinity,promise:null};
  cached.promise=(async()=>{
    try{
      const response=await fetch(`https://nether.wowhead.com/forever/tooltip/item/${id}`,{credentials:'omit',referrerPolicy:'no-referrer',signal:AbortSignal.timeout(6000)});
      if(!response.ok)throw new Error('Item details unavailable');
      const data=await response.json();
      return {
        name:typeof data.name==='string'?data.name:'',
        icon:typeof data.icon==='string' && /^[a-z0-9_]+$/i.test(data.icon)?`https://wow.zamimg.com/images/wow/icons/large/${data.icon.toLowerCase()}.jpg`:null,
        tooltip:typeof data.tooltip==='string' && data.tooltip.length<=60000?data.tooltip:'',
      };
    }catch{cached.expires=Date.now()+30000;return null;}
  })();
  details.set(id,cached);
  return cached.promise;
}

// Rebuild a small formatting allowlist. Remote event handlers, CSS, scripts,
// links, images and embedded content never enter the live document.
export function itemDescription(html){
  const template=document.createElement('template');template.innerHTML=html;
  const allowed=new Set(['TABLE','TBODY','THEAD','TR','TD','TH','SPAN','B','STRONG','I','EM','U','BR','DIV','P','SMALL']);
  const blocked=new Set(['SCRIPT','STYLE','IFRAME','OBJECT','EMBED','SVG','MATH','IMG','VIDEO','AUDIO','FORM','INPUT','BUTTON','LINK','META','TEMPLATE']);
  function copy(node){
    if(node.nodeType===Node.TEXT_NODE)return document.createTextNode(node.textContent);
    if(node.nodeType!==Node.ELEMENT_NODE || blocked.has(node.tagName))return document.createDocumentFragment();
    const target=allowed.has(node.tagName)?document.createElement(node.tagName.toLowerCase()):document.createElement('span');
    for(const name of node.classList)if(/^(q[0-7]?|moneygold|moneysilver|moneycopper|whtt-sellprice)$/.test(name))target.classList.add(name);
    if(['TD','TH'].includes(node.tagName) && /^[1-4]$/.test(node.getAttribute('colspan')||''))target.colSpan=Number(node.getAttribute('colspan'));
    for(const child of node.childNodes)target.append(copy(child));
    return target;
  }
  const result=document.createElement('div');result.className='equipment-item-description';
  for(const node of template.content.childNodes)result.append(copy(node));
  return result;
}

export function createEquipmentTooltip({id='equipment-tooltip'}={}){
  const tooltip=document.createElement('div');tooltip.id=id;tooltip.className='equipment-tooltip';tooltip.role='tooltip';tooltip.hidden=true;
  document.body.append(tooltip);
  let active=null,key='',token=0,timer=null,touch=false;
  const cancel=()=>{clearTimeout(timer);timer=null;};
  function hide(){cancel();active?.link.removeAttribute('aria-describedby');active=null;key='';token++;tooltip.hidden=true;}
  function position(){
    if(!active || tooltip.hidden)return;
    const box=active.link.getBoundingClientRect(),width=tooltip.offsetWidth,height=tooltip.offsetHeight;
    if(box.bottom<0 || box.top>innerHeight){hide();return;}
    const preferred=box.left-width-12>=8?box.left-width-12:box.right+12;
    tooltip.style.left=`${Math.max(8,Math.min(innerWidth-width-8,preferred))}px`;
    tooltip.style.top=`${Math.max(8,Math.min(innerHeight-height-8,box.top))}px`;
  }
  const scheduleHide=()=>{cancel();timer=setTimeout(()=>{if(document.activeElement!==active?.link && !tooltip.matches(':hover'))hide();},180);};
  function render(){
    const entry=active,data=entry?.tooltipData;
    if(!data?.itemId){hide();return;}
    const nextKey=JSON.stringify(data);if(key===nextKey){position();return;}key=nextKey;
    const request=++token;
    tooltip.replaceChildren();tooltip.style.setProperty('--item-color',entry.link.style.getPropertyValue('--item-color'));
    const name=document.createElement('strong');name.className='equipment-tooltip-name';name.textContent=data.name;
    const summary=document.createElement('div');summary.className='equipment-tooltip-summary';summary.textContent=`${data.slot}${data.count?' · Quantity '+data.count:''}${data.itemLevel?' · Item level '+data.itemLevel:''}`;
    const body=document.createElement('div');body.className='equipment-tooltip-body';body.textContent='Loading item details…';
    const durability=document.createElement('div');durability.className='equipment-tooltip-durability';
    if(data.maxDurability)durability.textContent=`Durability ${data.durability} / ${data.maxDurability}`;
    const note=document.createElement('div');note.className='equipment-tooltip-note';note.textContent='Base item details · Wowhead. Enchants, gems, random bonuses and active set bonuses are not synced.';
    tooltip.append(name,summary,body,durability,note);
    if(touch){const hint=document.createElement('div');hint.className='equipment-tooltip-touch';hint.textContent='Tap the item again to open Wowhead.';tooltip.append(hint);}
    tooltip.hidden=false;entry.link.setAttribute('aria-describedby',tooltip.id);position();
    getItemDetails(data.itemId).then(details=>{
      if(token!==request || active!==entry)return;
      body.replaceChildren();
      if(details?.tooltip){
        const description=itemDescription(details.tooltip);
        const title=description.querySelector('b');if(title?.textContent===details.name)title.remove();
        for(const line of description.querySelectorAll('.q'))if(/^Item Level\s/i.test(line.textContent))line.remove();
        const walker=document.createTreeWalker(description,NodeFilter.SHOW_TEXT);
        while(walker.nextNode())walker.currentNode.textContent=walker.currentNode.textContent.replace(/Durability\s+\d+\s*\/\s*\d+/gi,'');
        body.append(description);
      }else body.textContent='Detailed item stats are unavailable. Select the item to open its Wowhead page.';
      position();
    });
  }
  function show(entry,isTouch=false){
    if(!entry.tooltipData?.itemId)return;
    cancel();if(active!==entry){active?.link.removeAttribute('aria-describedby');key='';}
    if(touch!==isTouch)key='';active=entry;touch=isTouch;render();
  }
  tooltip.addEventListener('pointerenter',cancel);tooltip.addEventListener('pointerleave',scheduleHide);
  window.addEventListener('resize',position);
  window.addEventListener('scroll',event=>{if(!tooltip.contains(event.target))position();},true);
  document.addEventListener('pointerdown',event=>{if(active && !active.link.contains(event.target) && !tooltip.contains(event.target))hide();});
  document.addEventListener('keydown',event=>{if(event.key==='Escape' && active){event.preventDefault();event.stopPropagation();hide();}},true);
  return {hide,refresh(entry){if(active===entry)render();},watch(entry){
    let pointerType='mouse',touchWasOpen=false;
    entry.link.addEventListener('pointerdown',event=>{pointerType=event.pointerType;touchWasOpen=active===entry && touch && !tooltip.hidden;});
    entry.link.addEventListener('pointerenter',event=>{if(event.pointerType!=='touch')show(entry);});
    entry.link.addEventListener('pointerleave',scheduleHide);
    entry.link.addEventListener('focus',()=>{if(pointerType!=='touch')show(entry);});
    entry.link.addEventListener('blur',()=>{pointerType='mouse';scheduleHide();});
    entry.link.addEventListener('click',event=>{
      if(pointerType==='touch' && entry.tooltipData?.itemId && !touchWasOpen){
        event.preventDefault();show(entry,true);
      }
    });
  }};
}
