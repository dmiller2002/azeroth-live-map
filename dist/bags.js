import {RecordFeed} from './record-feed.js';
import {getItemDetails,createEquipmentTooltip} from './equipment-tooltip.js';
import {loadPreferences,savePreferences} from './prefs.js';

const QUALITY=['#adb2b2','#ededdf','#7ce06e','#6baaff','#c29aff','#ffbd70','#ead28a','#ead28a'];
export class BagFeed extends RecordFeed {
  constructor(){super('bags');}
  bag(index){return this.records.get(512+index);}
  slot(bag,slot){
    const descriptor=this.bag(bag)?.info,record=this.records.get(bag*64+slot);
    return descriptor && slot<=descriptor.slotCount && record?.info?.epoch===descriptor.epoch?record:null;
  }
  progress(){
    let bags=0,total=0,received=0,used=0;
    for(let bag=0;bag<=4;bag++){
      const info=this.bag(bag)?.info;if(!info)continue;
      bags++;total+=info.slotCount;
      for(let slot=1;slot<=info.slotCount;slot++){
        const item=this.slot(bag,slot)?.info;
        if(item){received++;if(item.itemId)used++;}
      }
    }
    return {bags,total,received,used,free:received-used,complete:bags===5 && received===total};
  }
}

export function createBagsPanel(feed){
  const $=id=>document.getElementById(id),cards=new Map();
  const tooltip=createEquipmentTooltip({id:'bag-item-tooltip'});
  let view=loadPreferences().bagView;
  $('bags-layout').value=view;
  for(let bag=0;bag<=4;bag++){
    const section=document.createElement('section');section.className='bag-card';section.dataset.bag=bag;
    const header=document.createElement('header'),copy=document.createElement('div');
    const label=document.createElement('small');label.textContent=bag===0?'BACKPACK':`BAG ${bag}`;
    const name=document.createElement('h2');name.textContent=bag===0?'Backpack':`Bag slot ${bag}`;
    const count=document.createElement('span');count.className='bag-capacity';count.textContent='Waiting…';
    copy.append(label,name);header.append(copy,count);
    const grid=document.createElement('ul');grid.className='bag-grid';grid.setAttribute('aria-label',bag===0?'Backpack contents':`Bag ${bag} contents`);
    const empty=document.createElement('p');empty.className='bag-empty-note';empty.textContent='Waiting for bag data…';
    section.append(header,grid,empty);$('bags-grid').append(section);
    cards.set(bag,{section,name,count,grid,empty,entries:[],layout:''});
  }
  function placeItems(){
    const combined=view==='combined';
    $('bags-grid').classList.toggle('is-combined',combined);
    $('combined-bag').hidden=!combined;
    for(const card of cards.values())card.section.hidden=combined;
    const lists=combined?[[...cards.values()].flatMap(card=>card.entries)]:[...cards.values()].map(card=>card.entries);
    lists.forEach((entries,list)=>{
      const target=combined?$('combined-bag-items'):[...cards.values()][list].grid;
      entries.forEach((entry,index)=>{
        // Keep existing nodes in place during live updates to preserve focus.
        if(target.children[index]!==entry.cell)target.insertBefore(entry.cell,target.children[index]||null);
      });
    });
  }
  $('bags-layout').addEventListener('change',()=>{
    view=$('bags-layout').value==='combined'?'combined':'separate';
    savePreferences({bagView:view});tooltip.hide();placeItems();
  });
  placeItems();
  function paint(entry){
    const {record,item}=entry,id=entry.itemId;
    const name=item?(id?(record.text||entry.details?.name||`Item #${id}`):'Empty slot'):'Syncing slot…';
    entry.link.style.setProperty('--item-color',id?QUALITY[item.quality]||'#d7dfd6':'#425045');
    entry.link.classList.toggle('empty',!id);entry.link.classList.toggle('pending',!item);
    entry.cell.classList.toggle('is-empty',Boolean(item && !id));
    entry.quantity.textContent=id && item.count>1?item.count.toLocaleString():'';
    entry.label.textContent=name;
    if(id){entry.link.href=`https://www.wowhead.com/tbc/item=${id}`;entry.link.tabIndex=0;}
    else{entry.link.removeAttribute('href');entry.link.tabIndex=-1;}
    const location=`${entry.bag===0?'Backpack':'Bag '+entry.bag} · Slot ${entry.slot}`;
    entry.link.setAttribute('aria-label',`${location} · ${name}${id?' · Quantity '+item.count:''}`);
    entry.tooltipData={itemId:id,name,slot:location,count:item?.count,itemLevel:item?.itemLevel,generation:record?.generation};
    tooltip.refresh(entry);
  }
  $('bags-show-empty').addEventListener('change',()=>{
    $('bags-grid').classList.toggle('hide-empty',!$('bags-show-empty').checked);tooltip.hide();
  });
  let lastKey='';
  return {hideTooltip:()=>tooltip.hide(),update(now,{connected,fresh,demo}){
    const available=connected && fresh && !demo && feed.isFresh(now),progress=feed.progress();
    $('bags-status').textContent=demo?'Connect WoW to see the items in your bags.':!connected?'Connect WoW to sync your backpack and equipped bags.':!fresh?'Signal paused. Bag contents are hidden until live capture resumes.':!feed.isFresh(now)?'Waiting for bag data. Requires addon 0.7.0; /reload after updating.':progress.complete?'Live bags · contents update automatically':`Syncing bags · ${progress.received}/${progress.total} slots · ${progress.bags}/5 bags`;
    $('bags-summary').textContent=available?`${progress.used} occupied · ${progress.free} free${progress.complete?'':' received'} · ${progress.total} total slots`:'Your backpack and four equipped bags';
    $('combined-bag-capacity').textContent=available?`${progress.used}/${progress.total} slots used${progress.complete?'':' · syncing…'}`:'Waiting…';
    $('combined-bag-empty').hidden=available && progress.total>0;
    $('combined-bag-empty').textContent=available?'Syncing your bag slots…':'Waiting for bag data…';
    const visible=document.body.dataset.activeTab==='bags';
    if(!visible){tooltip.hide();lastKey='';return;}
    const key=`${available}:${feed.version}`;if(key===lastKey)return;lastKey=key;
    if(!available)tooltip.hide();
    for(const [bag,card] of cards){
      const descriptor=available?feed.bag(bag):null,info=descriptor?.info,total=info?.slotCount||0;
      card.name.textContent=descriptor?.text || (bag===0?'Backpack':total?`Bag ${bag}`:`Bag slot ${bag}`);
      const layout=`${available}:${info?.epoch}:${total}`;
      if(card.layout!==layout){
        tooltip.hide();card.layout=layout;
        for(const entry of card.entries)entry.cell.remove();
        card.grid.replaceChildren();card.entries=[];
        for(let slot=1;slot<=total;slot++){
          const cell=document.createElement('li'),link=document.createElement('a');link.className='bag-slot';link.target='_blank';link.rel='noopener noreferrer';link.dataset.bag=bag;link.dataset.slot=slot;
          const icon=document.createElement('span');icon.className='bag-item-icon';icon.setAttribute('aria-hidden','true');
          const quantity=document.createElement('span');quantity.className='bag-item-count';quantity.setAttribute('aria-hidden','true');
          const label=document.createElement('span');label.className='sr-only';
          link.append(icon,quantity,label);cell.append(link);card.grid.append(cell);
          const entry={cell,link,icon,quantity,label,bag,slot,itemId:null,record:null,item:null,details:null};
          card.entries.push(entry);tooltip.watch(entry);
        }
      }
      let occupied=0,received=0;
      for(const entry of card.entries){
        entry.record=feed.slot(bag,entry.slot);entry.item=entry.record?.info;
        if(entry.item){received++;if(entry.item.itemId)occupied++;}
        const id=entry.item?.itemId||0;
        if(entry.itemId!==id){
          entry.itemId=id;entry.details=null;entry.icon.replaceChildren();entry.icon.textContent=id?'✦':'·';
          if(id)getItemDetails(id).then(details=>{
            if(entry.itemId!==id || !entry.link.isConnected)return;
            entry.details=details;
            if(details?.icon){
              const image=document.createElement('img');image.alt='';image.referrerPolicy='no-referrer';image.src=details.icon;
              image.onerror=()=>{if(entry.itemId===id)entry.icon.textContent='✦';};entry.icon.replaceChildren(image);
            }
            paint(entry);
          });
        }
        paint(entry);
      }
      card.count.textContent=info?`${occupied}/${total} slots used${received<total?' · syncing…':''}`:'Waiting…';
      card.empty.hidden=Boolean(total);
      card.empty.textContent=info?(bag===0?'Backpack data is not ready yet.':'No bag equipped.'):available?'Syncing this bag…':'Waiting for bag data…';
    }
    placeItems();
  }};
}
