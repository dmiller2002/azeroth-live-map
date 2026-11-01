import {getItemDetails, createEquipmentTooltip} from './equipment-tooltip.js';
import {createCharacterModel} from './character-model.js';

export const EQUIPMENT_SLOTS = {
  1:'Head',2:'Neck',3:'Shoulders',4:'Shirt',5:'Chest',6:'Waist',7:'Legs',8:'Feet',9:'Wrists',10:'Hands',
  11:'Finger 1',12:'Finger 2',13:'Trinket 1',14:'Trinket 2',15:'Back',16:'Main hand',17:'Off hand',18:'Ranged / relic',19:'Tabard',
};
const CLASSES = {1:'Warrior',2:'Paladin',3:'Hunter',4:'Rogue',5:'Priest',6:'Death Knight',7:'Shaman',8:'Mage',9:'Warlock',11:'Druid'};
const RACES = {1:'Human',2:'Orc',3:'Dwarf',4:'Night Elf',5:'Undead',6:'Tauren',7:'Gnome',8:'Troll',10:'Blood Elf',11:'Draenei'};
const QUALITY = ['#adb2b2','#ededdf','#7ce06e','#6baaff','#c29aff','#ffbd70','#ead28a','#ead28a'];
const POWER = {0:'Mana',1:'Rage',2:'Focus',3:'Energy',6:'Runic power'};

export class CharacterFeed {
  constructor(){this.reset();}
  reset(){this.records=new Map();this.sequences=new Set();this.sequenceQueue=[];this.receivedAt=-Infinity;this.session=null;this.version=0;}
  accept(packet,now){
    if(packet.type!=='character' || this.sequences.has(packet.sequence))return false;
    if(this.session!==null && packet.session!==this.session)return false;
    this.session=packet.session;
    const key=packet.kind===3?`stats:${packet.index}`:packet.index;
    let record=this.records.get(key);
    if(record && record.generation!==packet.generation){
      if((packet.generation-record.generation+65536)%65536>32768)return false;
      record=null;
    }
    if(!record){record={generation:packet.generation,parts:new Map(),final:null,info:null,text:null};this.records.set(key,record);}
    if(packet.kind===2){
      record.parts.set(packet.fragment,packet.textBytes);
      if(packet.final)record.final=packet.fragment;
      if(record.final!==null){
        const bytes=[];
        for(let i=0;i<=record.final;i++){if(!record.parts.has(i))break;bytes.push(...record.parts.get(i));
          if(i===record.final){const end=bytes.indexOf(0);record.text=new TextDecoder().decode(new Uint8Array(end<0?bytes:bytes.slice(0,end)));}}
      }
    }else record.info=packet;
    this.sequences.add(packet.sequence);this.sequenceQueue.push(packet.sequence);
    if(this.sequenceQueue.length>512)this.sequences.delete(this.sequenceQueue.shift());
    this.receivedAt=now;this.version++;return true;
  }
  isFresh(now){return now-this.receivedAt<6000;}
  get identity(){return this.records.get(0);}
  slot(index){return this.records.get(index);}
}

export function createCharacterPanel(feed){
  const $=id=>document.getElementById(id),slots=new Map();
  const tooltip=createEquipmentTooltip();
  const model=createCharacterModel();
  const columns=[['equipment-left',[1,2,3,15,5,4,19,9]],['equipment-right',[10,6,7,8,11,12,13,14]],['equipment-weapons',[16,17,18]]];
  for(const [container,indices] of columns)for(const index of indices){
    const link=document.createElement('a');link.className='equipment-slot';link.dataset.slot=index;link.target='_blank';link.rel='noopener noreferrer';
    const icon=document.createElement('span');icon.className='equipment-icon';icon.setAttribute('aria-hidden','true');
    const copy=document.createElement('span');copy.className='equipment-copy';
    const label=document.createElement('small');label.textContent=EQUIPMENT_SLOTS[index];
    const name=document.createElement('strong');name.textContent='Waiting…';
    copy.append(label,name);link.append(icon,copy);$(container).append(link);
    const entry={link,icon,name,itemId:null};slots.set(index,entry);tooltip.watch(entry);
  }
  let lastKey='';
  return {hideTooltip:()=>tooltip.hide(),update(now,{connected,fresh,demo}){
    const available=connected && fresh && !demo && feed.isFresh(now);
    model.update({available,currentFeed:feed});
    let state=demo?'Connect WoW to see your real character.':!connected?'Connect WoW to sync your character and equipment.':!fresh?'Signal paused. Character data is hidden until live capture resumes.':!feed.isFresh(now)?'Waiting for character data. Requires addon 0.6.0; /reload after updating.':!feed.identity?.info?'Syncing character details…':'Live character · equipment updates automatically';
    $('character-status').textContent=state;
    const key=`${available}:${feed.version}`;if(lastKey===key)return;lastKey=key;
    const identity=available?feed.identity:null,info=identity?.info;
    const [name,realm]=(identity?.text||'').split('\n');
    $('character-name').textContent=info?(name||'Syncing name…'):'Your character';
    $('character-subtitle').textContent=info?`Level ${info.level} ${RACES[info.raceId]||'Adventurer'} ${CLASSES[info.classId]||''}${realm?' · '+realm:''}`:'Equipment & attributes';
    let received=0,equipped=0;
    for(const [index,entry] of slots){
      const record=available?feed.slot(index):null,item=record?.info,id=item?.itemId||0;
      if(item){received++;if(id)equipped++;}
      entry.name.textContent=item?(id?(record.text||`Item #${id}`):'Empty'):'Waiting…';
      entry.link.style.setProperty('--item-color',item && id?QUALITY[item.quality]||'#d7dfd6':'#7e8b82');
      entry.link.classList.toggle('empty',!id);entry.link.classList.toggle('pending',!item);
      if(id)entry.link.href=`https://www.wowhead.com/tbc/item=${id}`;else entry.link.removeAttribute('href');
      const detail=[EQUIPMENT_SLOTS[index],entry.name.textContent];
      if(id && item.itemLevel)detail.push(`Item level ${item.itemLevel}`);
      if(id && item.maxDurability)detail.push(`Durability ${item.durability}/${item.maxDurability}`);
      if(id)detail.push('Open item details on Wowhead');
      entry.link.setAttribute('aria-label',detail.join(' · '));
      entry.tooltipData={itemId:id,name:entry.name.textContent,slot:EQUIPMENT_SLOTS[index],itemLevel:item?.itemLevel,durability:item?.durability,maxDurability:item?.maxDurability,generation:record?.generation};
      tooltip.refresh(entry);
      if(entry.itemId!==id){
        entry.itemId=id;entry.icon.replaceChildren();entry.icon.textContent=id?'✦':'·';
        if(id)getItemDetails(id).then(details=>{
          const url=details?.icon;
          if(!url || entry.itemId!==id)return;
          const image=document.createElement('img');image.alt='';image.referrerPolicy='no-referrer';image.src=url;
          image.onerror=()=>{if(entry.itemId===id)entry.icon.textContent='✦';};entry.icon.replaceChildren(image);
        });
      }
    }
    $('character-gear-count').textContent=available?`${received}/19 slots synced · ${equipped} equipped`:'Waiting for equipment';
    const primary=available?feed.records.get('stats:1')?.info?.stats:null,defense=available?feed.records.get('stats:2')?.info:null;
    ['strength','agility','stamina','intellect','spirit'].forEach((stat,i)=>$('stat-'+stat).textContent=primary?primary[i].toLocaleString():'—');
    for(const [stat,value] of [['armor',defense?.armor],['health',defense?.maxHealth],['power',defense?.maxPower]])$('stat-'+stat).textContent=value===undefined?'—':value.toLocaleString();
    $('stat-power-label').textContent=info?POWER[info.powerType]||'Power':'Power';
  }};
}
