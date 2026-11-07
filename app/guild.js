import {RecordFeed} from './record-feed.js';
import {loadPreferences,savePreferences} from './prefs.js';

const PROFESSIONS={171:'Alchemy',164:'Blacksmithing',333:'Enchanting',202:'Engineering',182:'Herbalism',165:'Leatherworking',186:'Mining',393:'Skinning',197:'Tailoring',755:'Jewelcrafting'};
const CLASSES={1:'Warrior',2:'Paladin',3:'Hunter',4:'Rogue',5:'Priest',7:'Shaman',8:'Mage',9:'Warlock',11:'Druid'};
export const GUILD_LOCATION_TTL=30000;
export class GuildFeed extends RecordFeed {
  constructor(){super('guild');}
  reset(){super.reset();this.epoch=null;}
  accept(packet,now){
    if(packet.type!=='guild' || (this.session!==null && packet.session!==this.session) || this.sequences.has(packet.sequence))return false;
    if(packet.kind===0 && this.epoch!==null && packet.epoch!==this.epoch){
      if((packet.epoch-this.epoch+65536)%65536>32768)return false;
      super.reset();
    }
    if(packet.kind===0)this.epoch=packet.epoch;
    else if(packet.kind!==2 && packet.epoch!==this.epoch)return false;
    // Separate index ranges keep locations and professions independent of the
    // slower roster text. RecordFeed's kind 3 is reserved for character stats.
    const accepted=super.accept({...packet,kind:packet.kind===3 || packet.kind===4?1:packet.kind},now);
    if(accepted && packet.kind!==2){
      const record=this.records.get(packet.index);
      record.updatedAt=now;
      if(packet.kind===3)record.locationAt=now-packet.age*1000;
    }
    return accepted;
  }
  get guild(){return this.records.get(0);}
  members(now){
    const summary=this.guild?.info;
    if(!summary || summary.status!==2)return [];
    const result=[];
    for(let index=1;index<=summary.count;index++){
      const record=this.records.get(index),info=record?.info;
      if(info?.epoch!==summary.epoch || !record.text)continue;
      const [name,rank,zone]=record.text.split('\n');
      const skills=this.records.get(1024+index),location=this.records.get(2048+index);
      const known=info.online && skills?.info?.epoch===summary.epoch && skills.info.known && now-skills.updatedAt<90000;
      const located=info.online && location?.info?.epoch===summary.epoch && location.info.valid && now-location.locationAt<GUILD_LOCATION_TTL;
      result.push({...info,index,name,rank,zone,className:CLASSES[info.classId]||'Adventurer',
        professions:known?skills.info.professions.filter(p=>p.id).map(p=>({...p,name:PROFESSIONS[p.id]||`Profession ${p.id}`})):null,
        location:located?{...location.info,updatedAt:location.locationAt}:null});
    }
    return result;
  }
}

export function createGuildPanel(feed,{showOnMap,mapName,canMap}){
  const $=id=>document.getElementById(id);
  const preferences=loadPreferences(),collator=new Intl.Collator(undefined,{numeric:true,sensitivity:'base'});
  let sortColumn=preferences.guildSort,sortDirection=preferences.guildSortDirection;
  let current=[],lastKey='';
  const rows=new Map();
  const search=$('guild-search'),onlineOnly=$('guild-online-only');
  const sortButtons=Array.from(document.querySelectorAll('[data-guild-sort]'));
  function value(member){
    if(sortColumn==='status')return Number(member.online);
    if(sortColumn==='professions')return member.professions===null?null:member.professions.length?member.professions.map(p=>`${p.name} ${p.rank}`).join(' · '):'None learned';
    if(sortColumn==='location')return (member.location?mapName(member.location.mapId):member.zone)||null;
    return member.name;
  }
  function compare(a,b){
    const av=value(a),bv=value(b),byName=collator.compare(a.name,b.name)||a.index-b.index;
    if(av===null || bv===null)return av===bv?byName:av===null?1:-1;
    const result=sortColumn==='status'?av-bv:collator.compare(av,bv);
    return (sortDirection==='ascending'?result:-result)||byName;
  }
  function updateHeaders(){
    for(const button of sortButtons){
      const active=button.dataset.guildSort===sortColumn;
      button.closest('th').setAttribute('aria-sort',active?sortDirection:'none');
      button.querySelector('.guild-sort-indicator').textContent=active?(sortDirection==='ascending'?'↑':'↓'):'↕';
      button.title=active?`Sorted ${sortDirection}. Click to reverse.`:'Click to sort this column.';
    }
  }
  function render(){
    const query=search.value.trim().toLocaleLowerCase();
    const visible=current.filter(member=>(!onlineOnly.checked || member.online) &&
      [member.name,member.className,member.zone,...(member.professions||[]).map(p=>p.name)].join(' ').toLocaleLowerCase().includes(query)).sort(compare);
    const roster=$('guild-roster'),shown=new Set();
    const focused=roster.contains(document.activeElement)?document.activeElement:null;
    for(const [position,member] of visible.entries()){
      let entry=rows.get(member.index);
      if(!entry){
        const row=document.createElement('tr');row.dataset.member=member.index;
        const identity=document.createElement('td'),name=document.createElement('strong'),detail=document.createElement('small');
        const status=document.createElement('td'),professions=document.createElement('td'),location=document.createElement('td');
        const action=document.createElement('td'),button=document.createElement('button');button.className='toolbar-button';button.textContent='Show on map';
        button.onclick=()=>{const live=feed.members(performance.now()).find(m=>m.index===member.index);if(live?.location)showOnMap(live);};
        identity.append(name,detail);action.append(button);row.append(identity,status,professions,location,action);
        entry={row,name,detail,status,professions,location,button};rows.set(member.index,entry);
      }
      const {row,name,detail,status,professions,location,button}=entry;
      name.textContent=member.name;detail.textContent=`Level ${member.level} ${member.className}${member.rank?` · ${member.rank}`:''}`;
      status.textContent=member.online?'Online':'Offline';status.className=member.online?'guild-online':'guild-offline';
      professions.textContent=member.professions===null?'Not shared':member.professions.length?member.professions.map(p=>`${p.name} ${p.rank}`).join(' · '):'None learned';
      location.textContent=member.location?`${mapName(member.location.mapId)} · ${(member.location.x*100).toFixed(1)}, ${(member.location.y*100).toFixed(1)}`:member.zone?`${member.zone}${member.online?' · zone only':' · last seen'}`:'Location unavailable';
      button.disabled=!member.location || !canMap(member.location.mapId);
      button.title=!member.location?'Requires fresh coordinates from this member.':!canMap(member.location.mapId)?'Map artwork is unavailable for this area.':`Show ${member.name} on the map`;
      button.setAttribute('aria-label',`Show ${member.name} on map`);
      if(roster.children[position]!==row)roster.insertBefore(row,roster.children[position]||null);
      shown.add(row);
    }
    for(const row of Array.from(roster.children))if(!shown.has(row))row.remove();
    for(const [index,entry]of rows)if(!shown.has(entry.row))rows.delete(index);
    if(focused?.isConnected && document.activeElement!==focused)focused.focus({preventScroll:true});
    $('guild-empty').hidden=visible.length>0;
    $('guild-empty').textContent=current.length?'No members match your filters.':'Waiting for guild members…';
    $('guild-table').hidden=visible.length===0;
    $('guild-results').textContent=current.length?`${visible.length} of ${current.length} received members shown`:'';
  }
  for(const button of sortButtons)button.addEventListener('click',()=>{
    const column=button.dataset.guildSort;
    sortDirection=column===sortColumn?(sortDirection==='ascending'?'descending':'ascending'):column==='status'?'descending':'ascending';
    sortColumn=column;savePreferences({guildSort:sortColumn,guildSortDirection:sortDirection});updateHeaders();render();
  });
  updateHeaders();
  search.addEventListener('input',render);onlineOnly.addEventListener('change',render);
  return {update(now,{connected,fresh,demo}){
    const available=connected && fresh && !demo && feed.isFresh(now),summary=available?feed.guild?.info:null;
    $('guild-name').textContent=available && feed.guild?.text?feed.guild.text:'Guild';
    current=available?feed.members(now):[];
    $('guild-status').textContent=demo?'Connect WoW to see your guild.':!connected?'Connect WoW to sync your guild roster.':!fresh?'Signal paused. Guild data is hidden until live capture resumes.':!summary?'Waiting for guild data. Install addon 0.8.0, then /reload in WoW.':summary.status===0?'Your character is not in a guild.':summary.status===1?'Waiting for WoW’s guild roster…':`${current.length}/${summary.count} members received · ${current.filter(m=>m.online).length} online${current.length<summary.count?' · syncing…':''}`;
    $('guild-sharing-status').textContent=summary?`Your guild sharing is ${summary.sharing?'on':'off'}.`:'';
    const key=JSON.stringify([available,summary?.status,current.map(member=>[member.index,member.name,member.level,member.classId,member.rank,member.online,member.zone,member.professions,member.location && [member.location.mapId,member.location.x,member.location.y]])]);
    if(key!==lastKey){lastKey=key;render();}
    if(!current.length)$('guild-empty').textContent=summary?.status===0?'Join a guild in WoW to see its members here.':available?'Waiting for guild members…':'Connect WoW for live guild information.';
  }};
}
