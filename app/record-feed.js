// Reassemble revisioned records without mixing names from replaced items.
export class RecordFeed {
  constructor(type){this.type=type;this.reset();}
  reset(){this.records=new Map();this.sequences=new Set();this.sequenceQueue=[];this.receivedAt=-Infinity;this.session=null;this.version=0;}
  accept(packet,now){
    if(packet.type!==this.type || this.sequences.has(packet.sequence))return false;
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
}

