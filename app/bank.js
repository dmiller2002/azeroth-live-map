import {RecordFeed} from './record-feed.js';
import {getItemDetails,createEquipmentTooltip} from './equipment-tooltip.js';

const QUALITY=['#adb2b2','#ededdf','#7ce06e','#6baaff','#c29aff','#ffbd70','#ead28a','#ead28a'];
export class BankFeed extends RecordFeed {
  constructor(){super('bank');}
  summary(group){return this.records.get(60032+group)?.info;}
  bag(index){
    const summary=this.summary(Math.floor(index/16)),record=this.records.get(60000+index);
    return summary && index%16<summary.tabCount && record?.info?.groupEpoch===summary.epoch?record:null;
  }
  slot(bag,slot){
    const descriptor=this.bag(bag)?.info,record=this.records.get(bag*256+slot);
    return descriptor && slot>=1 && slot<=descriptor.slotCount && record?.info?.epoch===descriptor.epoch?record:null;
  }
  progress(group){
    const summary=this.summary(group);let tabs=0,total=0,received=0,used=0;
    for(let index=0;index<(summary?.tabCount||0);index++){
      const bag=group*16+index,info=this.bag(bag)?.info;if(!info)continue;
      tabs++;total+=info.slotCount;
      for(let slot=1;slot<=info.slotCount;slot++){
        const item=this.slot(bag,slot)?.info;if(item){received++;if(item.itemId)used++;}
      }
    }
    return {tabs,total,received,used,free:received-used,complete:Boolean(summary && tabs===summary.tabCount && total===received)};
  }
}

export function createBankPanel(feed){
  const $=id=>document.getElementById(id),cards=new Map(),tooltip=createEquipmentTooltip({id:'bank-item-tooltip'});
  let lastKey='';
  const names=['Bank','Account bank'],keys=['character','account'];
  function paint(entry){
    const {item,record,itemId:id}=entry;
    const name=item?(id?(record.text||entry.details?.name||`Item #${id}`):'Empty slot'):'Syncing slot…';
    entry.link.style.setProperty('--item-color',id?QUALITY[item.quality]||'#d7dfd6':'#425045');
    entry.link.classList.toggle('empty',!id);entry.link.classList.toggle('pending',!item);
    entry.cell.classList.toggle('is-empty',Boolean(item && !id));
    entry.quantity.textContent=id && item.count>1?item.count.toLocaleString():'';entry.label.textContent=name;
    if(id){entry.link.href=`https://www.wowhead.com/forever/item=${id}`;entry.link.tabIndex=0;}
    else{entry.link.removeAttribute('href');entry.link.tabIndex=-1;}
    const location=`${names[Math.floor(entry.bag/16)]} tab ${entry.bag%16+1} · Slot ${entry.slot}`;
    entry.link.setAttribute('aria-label',`${location} · ${name}${id?' · Quantity '+item.count:''}`);
    entry.tooltipData={itemId:id,name,slot:location,count:item?.count,itemLevel:item?.itemLevel,generation:record?.generation};tooltip.refresh(entry);
  }
  $('bags-show-empty').addEventListener('change',()=>{
    $('bank-storage').classList.toggle('hide-empty',!$('bags-show-empty').checked);tooltip.hide();
  });
  return {hideTooltip:()=>tooltip.hide(),update(now,{connected,fresh,demo}){
    const available=connected && fresh && !demo && feed.isFresh(now);
    const key=`${available}:${feed.version}`;
    if($('bags-view').hidden){tooltip.hide();lastKey='';return;}
    if(lastKey===key)return;lastKey=key;
    if(!available)tooltip.hide();
    const shown=new Set();
    for(let group=0;group<2;group++){
      const summary=available?feed.summary(group):null,progress=feed.progress(group),prefix='bank-'+keys[group];
      const known=summary && (summary.status===1 || summary.status===2 || summary.updatedAt>0 || summary.tabCount>0);
      $(prefix).hidden=group===1 && !known;
      const saved=summary?.updatedAt?new Date(summary.updatedAt*1000).toLocaleString():null;
      $(prefix+'-status').textContent=!connected?'Connect WoW to see your bank.':!fresh?'Signal paused. Bank items are hidden until capture resumes.':!summary?'Open your bank in WoW to sync it · requires addon 1.0.3.':summary.status===0?'Open your bank in WoW to record its slots and items.':summary.status===1?'Live bank · contents update while the bank is open.':summary.status===2?`Cached bank · last seen ${saved||'on your last bank visit'}. Open the bank in WoW to refresh.`:summary.status===3?`Bank refresh unavailable.${saved?' Showing cached items from '+saved+'.':''} Try reopening the bank in WoW.`:`Native bank data is unavailable in this client.${saved?' Showing cached items from '+saved+'.':''}`;
      $(prefix+'-summary').textContent=known?`${progress.used} occupied · ${progress.free} free${progress.complete?'':' received'} · ${progress.total} slots${progress.complete?'':' · syncing…'}${summary.limited?' · partial snapshot':''}`:'';
      for(let position=0;position<(summary?.tabCount||0);position++){
        const bag=group*16+position,descriptor=feed.bag(bag),info=descriptor?.info;
        shown.add(bag);let card=cards.get(bag);
        if(!card){
          const section=document.createElement('section');section.className='bag-card';section.dataset.bank=bag;
          const header=document.createElement('header'),copy=document.createElement('div'),label=document.createElement('small'),name=document.createElement('h2'),count=document.createElement('span');
          label.textContent=`${names[group].toUpperCase()} TAB ${position+1}`;name.textContent=`Tab ${position+1}`;count.className='bag-capacity';
          copy.append(label,name);header.append(copy,count);
          const grid=document.createElement('ul');grid.className='bag-grid';grid.setAttribute('aria-label',`${names[group]} tab ${position+1} contents`);
          const empty=document.createElement('p');empty.className='bag-empty-note';section.append(header,grid,empty);$(prefix+'-grid').append(section);
          card={section,name,count,grid,empty,entries:[],layout:''};cards.set(bag,card);
        }
        card.name.textContent=descriptor?.text||`${names[group]} tab ${position+1}`;
        const total=info?.slotCount||0,layout=`${summary.epoch}:${info?.epoch}:${total}`;
        if(card.layout!==layout){
          tooltip.hide();card.layout=layout;card.grid.replaceChildren();card.entries=[];
          for(let slot=1;slot<=total;slot++){
            const cell=document.createElement('li'),link=document.createElement('a');link.className='bag-slot bank-slot';link.target='_blank';link.rel='noopener noreferrer';link.dataset.bank=bag;link.dataset.slot=slot;
            const icon=document.createElement('span');icon.className='bag-item-icon';icon.setAttribute('aria-hidden','true');
            const quantity=document.createElement('span');quantity.className='bag-item-count';quantity.setAttribute('aria-hidden','true');
            const label=document.createElement('span');label.className='sr-only';link.append(icon,quantity,label);cell.append(link);card.grid.append(cell);
            const entry={cell,link,icon,quantity,label,bag,slot,itemId:null,record:null,item:null,details:null};card.entries.push(entry);tooltip.watch(entry);
          }
        }
        let used=0,received=0;
        for(const entry of card.entries){
          entry.record=feed.slot(bag,entry.slot);entry.item=entry.record?.info;
          if(entry.item){received++;if(entry.item.itemId)used++;}
          const id=entry.item?.itemId||0;
          if(entry.itemId!==id){
            entry.itemId=id;entry.details=null;entry.icon.replaceChildren();entry.icon.textContent=id?'✦':'·';
            if(id)getItemDetails(id).then(details=>{
              if(entry.itemId!==id || !entry.link.isConnected)return;entry.details=details;
              if(details?.icon){const image=document.createElement('img');image.alt='';image.referrerPolicy='no-referrer';image.src=details.icon;image.onerror=()=>{if(entry.itemId===id)entry.icon.textContent='✦';};entry.icon.replaceChildren(image);}
              paint(entry);
            });
          }
          paint(entry);
        }
        card.count.textContent=info?`${used}/${total} slots used${received<total?' · syncing…':''}`:'Syncing…';
        card.empty.hidden=Boolean(total);card.empty.textContent=info?'No slots in this bank tab.':'Syncing this bank tab…';
      }
    }
    for(const [bag,card] of cards)if(!shown.has(bag)){card.section.remove();cards.delete(bag);tooltip.hide();}
  }};
}
