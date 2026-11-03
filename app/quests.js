export const QUEST_KINDS = {1:'Pickup', 2:'Objective', 3:'Turn-in'};

// Keep a quest's color stable across zones, sync order, and page reloads.
const QUEST_COLORS = ['#ffda70', '#79cfff', '#ff91be', '#a8e477', '#c7a0ff', '#ffac70', '#72e5cf', '#f0ed98'];
export function questColor(questId) {
  return QUEST_COLORS[(Number(questId) >>> 0) % QUEST_COLORS.length];
}

function zoneState(packet) {
  return {mapId:packet.mapId,generation:packet.generation,count:packet.count,status:packet.status,
    limited:packet.limited,markers:new Map(),revisions:new Map(),fragments:new Map(),receivedAt:-Infinity};
}
function joinTitle(parts) {
  if(parts.final===null)return null;
  const bytes=[];
  for(let i=0;i<=parts.final;i++) {
    if(!parts.chunks.has(i))return null;
    bytes.push(...parts.chunks.get(i));
  }
  const end=bytes.indexOf(0);
  return new TextDecoder().decode(new Uint8Array(end<0?bytes:bytes.slice(0,end)));
}
function fragment(store,key,packet) {
  const parts=store.get(key)||{chunks:new Map(),final:null};
  parts.chunks.set(packet.fragment,packet.textBytes);
  if(packet.final)parts.final=packet.fragment;
  store.set(key,parts);
  return joinTitle(parts);
}

// v3/v8 use zone snapshots; v10 revisions update individual pins in stable slots.
// Titles are shared across all zones.
// Everything stays in memory; disconnect/reconnect starts a fresh character feed.
export class QuestFeed {
  constructor(){this.reset();}
  reset(){
    this.zones=new Map();this.titles=new Map();this.fragments=new Map();
    this.global=null;this.version=null;this.mapId=null;this.receivedAt=-Infinity;
    this.sequences=new Set();this.sequenceQueue=[];this.times=[];
  }
  accept(packet,now){
    if(packet.type!=='quest')return false;
    const version=packet.version||2;
    if(this.version!==null && version!==this.version)this.reset();
    if(version!==2 && packet.kind===3 && this.global && packet.generation!==this.global.generation)this.reset();
    this.version=version;
    if(this.sequences.has(packet.sequence))return false;
    if(version!==2 && packet.kind===3){
      this.global=packet;
      if(packet.status!==1){this.zones.clear();this.titles.clear();this.fragments.clear();}
    } else if(version!==2 && packet.kind===2){
      if(this.global?.status!==1)return false;
      const title=fragment(this.fragments,packet.questId,packet);
      if(title!==null)this.titles.set(packet.questId,title);
    } else {
      let zone=this.zones.get(packet.mapId);
      if(version===10){
        if(packet.kind===0){
          if(zone && zone.generation!==packet.generation && ((packet.generation-zone.generation+65536)%65536)>32768)return false;
          if(!zone){zone=zoneState(packet);this.zones.set(packet.mapId,zone);}
          zone.generation=packet.generation;zone.count=packet.count;zone.status=packet.status;zone.limited=packet.limited;
          if(zone.status!==1)zone.markers.clear();
        }else{
          if(!zone || zone.status!==1)return false;
          const revision=zone.revisions.get(packet.index);
          if(revision!==undefined && revision!==packet.generation && ((packet.generation-revision+65536)%65536)>32768)return false;
          zone.revisions.set(packet.index,packet.generation);
          if(packet.kind===4)zone.markers.delete(packet.index);
          else if(packet.kind===1)zone.markers.set(packet.index,packet);
        }
      }else{
        if(packet.kind===0){
          if(zone && zone.generation!==packet.generation && ((packet.generation-zone.generation+65536)%65536)>32768)return false;
          if(!zone || zone.generation!==packet.generation){zone=zoneState(packet);this.zones.set(packet.mapId,zone);}
          zone.count=packet.count;zone.status=packet.status;zone.limited=packet.limited;
          if(!zone.count || zone.status!==1){zone.markers.clear();zone.fragments.clear();}
        } else if(!zone || zone.generation!==packet.generation || zone.status!==1 || packet.index>zone.count)return false;
        if(packet.kind===1)zone.markers.set(packet.index,packet);
        if(packet.kind===2)fragment(zone.fragments,packet.index,packet);
      }
      this.mapId=packet.mapId;
      // Legacy labels may arrive before their marker after a dropped frame.
      for(const [index,parts] of zone.fragments){
        const marker=zone.markers.get(index),title=joinTitle(parts);
        if(marker && title!==null)this.titles.set(marker.questId,title);
      }
      zone.receivedAt=now;
    }
    this.sequences.add(packet.sequence);this.sequenceQueue.push(packet.sequence);
    if(this.sequenceQueue.length>512)this.sequences.delete(this.sequenceQueue.shift());
    this.receivedAt=now;this.times.push(now);
    while(this.times.length && this.times[0]<now-4000)this.times.shift();
    return true;
  }
  isFresh(now){return now-this.receivedAt<6000;}
  zone(mapId){return this.zones.get(mapId);}
  forQuest(questId,now){
    return [...this.zones.keys()].flatMap(mapId=>this.visible(mapId,now)).filter(marker=>marker.questId===Number(questId));
  }
  // Legacy aliases retain compatibility with the old single-zone feed API.
  get markers(){return this.zone(this.mapId)?.markers||new Map();}
  get generation(){return this.zone(this.mapId)?.generation??null;}
  get count(){return this.zone(this.mapId)?.count||0;}
  get status(){return this.global?.status??this.zone(this.mapId)?.status??null;}
  get limited(){return this.global?.limited??this.zone(this.mapId)?.limited??false;}
  progress(now){
    let received=0,expected=0,zones=0,named=0;
    for(const zone of this.zones.values()){
      received+=zone.markers.size;expected+=zone.count;if(zone.count)zones++;
      for(const marker of zone.markers.values())if(this.titles.has(marker.questId))named++;
    }
    const recent=this.times.filter(time=>time>=now-4000);
    const seconds=recent.length>1?Math.max(1,(now-recent[0])/1000):1;
    return {received,expected:this.global?.totalCount??expected,zones,zoneCount:this.global?.zoneCount??zones,
      named,rate:Math.round(recent.length/seconds)};
  }
  visible(mapId,now){
    const zone=this.zones.get(mapId);
    if(!zone || zone.status!==1 || !this.isFresh(now) || (this.version===2 && now-zone.receivedAt>=6000) || (this.global && this.global.status!==1))return [];
    return [...zone.markers.values()].map(marker=>({...marker,title:this.titles.get(marker.questId)||`Quest #${marker.questId}`}));
  }
}
