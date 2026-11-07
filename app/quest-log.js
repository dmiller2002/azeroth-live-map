import {RecordFeed} from './record-feed.js';
import {questColor} from './quests.js';

export class QuestLogFeed extends RecordFeed {
  constructor(){super('questlog');}
  reset(){super.reset();this.epoch=null;this.labels=new Map();this.protocol=null;}
  accept(packet,now){
    if(packet.type!=='questlog' || this.sequences.has(packet.sequence) || (this.session!==null && packet.session!==this.session))return false;
    if(this.protocol!==null && packet.version!==this.protocol)this.reset();
    this.protocol=packet.version;
    const incremental=packet.version===9;
    if(!incremental && packet.kind===0 && this.epoch!==null && packet.epoch!==this.epoch){
      if((packet.epoch-this.epoch+65536)%65536>32768)return false;
      super.reset();this.labels.clear();
    }
    if(packet.kind===0)this.epoch=packet.epoch;
    else if(!incremental && packet.kind!==2 && packet.epoch!==this.epoch)return false;
    const old=this.records.get(packet.index);
    const previous=old?.info ? {info:old.info,text:old.text??old.previous?.text} : old?.previous;
    const accepted=super.accept({...packet,kind:packet.kind===3 || packet.kind===4?1:packet.kind},now);
    if(accepted && incremental){
      const record=this.records.get(packet.index);
      // Keep a completed reading while the next revision arrives, but never
      // reuse text across a slot identity change or a different quest ID.
      if(record!==old && previous)record.previous=previous;
      if(record.info && record.previous && (record.info.epoch!==record.previous.info.epoch || record.info.questId!==record.previous.info.questId))delete record.previous;
      if(packet.kind===1 && previous?.info.questId && previous.info.questId!==packet.questId)this.labels.delete(previous.info.questId);
    }
    return accepted;
  }
  reading(index){
    const record=this.records.get(index);
    if(!record || this.protocol!==9)return record;
    if(!record.info)return {...record,info:record.previous?.info,text:record.previous?.text??null};
    const info=record.info??record.previous?.info;
    const previous=record.previous?.info.epoch===info?.epoch && record.previous?.info.questId===info?.questId ? record.previous : null;
    return {...record,info,text:record.text??previous?.text??null};
  }
  get summary(){return this.records.get(0)?.info;}
  quests(){
    const summary=this.summary;
    if(!summary || summary.status!==1)return [];
    const quests=[];
    for(let slot=1;slot<=(this.protocol===9?64:summary.count);slot++){
      const record=this.reading(slot),info=record?.info;
      if(!info?.questId || (this.protocol!==9 && info.epoch!==summary.epoch))continue;
      if(record.text!==null)this.labels.set(info.questId,record.text);
      const [title,category,tag,overview]=(record.text??this.labels.get(info.questId)??'').split('\x1f');
      const objectives=[];
      for(let objective=0;objective<info.objectiveCount;objective++){
        const row=this.reading(4096+(slot-1)*32+objective),valid=row?.info?.epoch===info.epoch;
        objectives.push(valid?{...row.info,text:row.text,received:row.text!==null}:{text:null,finished:false,fulfilled:0,required:0,received:false});
      }
      const body=this.reading(128+slot),validBody=body?.info?.epoch===info.epoch;
      const expected=validBody?Math.ceil(body.info.length/9):0;
      quests.push({...info,slot,title:title||`Quest #${info.questId}`,named:Boolean(title),category:category||'Quest log',tag:tag||'',overview:overview??null,
        objectives,description:validBody?(body.info.length===0?'':body.text):null,
        descriptionAvailable:validBody && body.info.available,limited:validBody && body.info.limited,
        textProgress:validBody && expected?Math.min(100,Math.floor(body.parts.size/expected*100)):0});
    }
    return quests;
  }
  quest(id){return this.quests().find(quest=>quest.questId===Number(id));}
}

export function questDifficulty(level,playerLevel){
  const delta=level-playerLevel;
  return !level || !playerLevel?'#e5cf97':delta>=5?'#ff8679':delta>=3?'#ffb16d':delta>=-2?'#ffe08c':delta>=-Math.max(5,Math.floor(playerLevel/10)+2)?'#9bd488':'#a9afa3';
}
export function createQuestLogPanel(feed,{openView,highlight,onMap,markers,markerSource=()=> 'Questie'}){
  const $=id=>document.getElementById(id),entries=new Map();
  let current=[],selectedId=null,available=false,lastKey='',readerKey='';
  const search=$('quest-log-search'),filter=$('quest-log-filter');
  const text=(id,value)=>{const node=$(id);if(node.textContent!==value)node.textContent=value;};
  function showReader(reading){
    $('quest-reader').hidden=!reading;
    $('quest-browser-view').hidden=reading;
  }
  function select(id,{open=true}={}){
    const next=Number(id);
    if(!current.some(quest=>quest.questId===next))return false;
    if(next!==selectedId){selectedId=next;readerKey='';$('quest-reader').scrollTop=0;}
    highlight(next);renderList();renderReader();
    if(open){showReader(true);openView();$('quest-reader-back').focus();}
    return true;
  }
  function questButton(quest){
    let entry=entries.get(quest.questId);
    if(!entry){
      const button=document.createElement('button');button.type='button';button.className='quest-log-entry';
      const title=document.createElement('strong'),detail=document.createElement('span');
      button.append(title,detail);
      button.onclick=()=>select(quest.questId);entry={button,title,detail};entries.set(quest.questId,entry);
    }
    entry.button.dataset.questId=quest.questId;
    entry.button.style.setProperty('--quest-color',questColor(quest.questId));
    entry.button.style.setProperty('--quest-difficulty',questDifficulty(quest.level,feed.summary?.playerLevel));
    entry.button.setAttribute('aria-pressed',String(selectedId===quest.questId));
    entry.title.textContent=`${quest.level?`[${quest.level}] `:''}${quest.title}`;
    entry.detail.textContent=quest.failed?'Failed':quest.complete?'Ready for turn-in':quest.watched?'Tracked in WoW':quest.tag||'In progress';
    entry.detail.className=quest.complete?'quest-complete':quest.failed?'quest-failed':'';
    return entry.button;
  }
  function reconcile(parent,nodes){
    nodes.forEach((node,index)=>{if(parent.children[index]!==node)parent.insertBefore(node,parent.children[index]||null);});
    const keep=new Set(nodes);for(const node of Array.from(parent.children))if(!keep.has(node))node.remove();
  }
  const groups=new Map();
  function renderList(){
    const query=search.value.trim().toLocaleLowerCase();
    const shown=current.filter(quest=>(filter.value!=='tracked' || quest.watched) && (filter.value!=='complete' || quest.complete) &&
      `${quest.title} ${quest.category} ${quest.overview||''} ${quest.objectives.map(o=>o.text||'').join(' ')}`.toLocaleLowerCase().includes(query));
    const grouped=new Map();
    for(const quest of shown){if(!grouped.has(quest.category))grouped.set(quest.category,[]);grouped.get(quest.category).push(quest);}
    const sections=[];
    for(const [category,quests]of grouped){
      let group=groups.get(category);
      if(!group){const section=document.createElement('section'),heading=document.createElement('h2'),list=document.createElement('div');section.className='quest-log-group';section.append(heading,list);group={section,heading,list};groups.set(category,group);}
      group.heading.textContent=`${category} (${quests.length})`;reconcile(group.list,quests.map(quest=>questButton(quest)));sections.push(group.section);
    }
    reconcile($('quest-log-list'),sections);
    text('quest-log-empty',available && current.length?'No quests match your filters.':available?'Your quest log is empty.':'Connect WoW to read your quest log.');
    $('quest-log-empty').hidden=shown.length>0;
    const ids=new Set(current.map(quest=>quest.questId));
    for(const id of entries.keys())if(!ids.has(id))entries.delete(id);
    for(const [category,group]of groups)if(!grouped.has(category)){group.section.remove();groups.delete(category);}
  }
  function renderReader(){
    const quest=current.find(quest=>quest.questId===selectedId);
    $('quest-reader-content').hidden=!quest;$('quest-reader-empty').hidden=Boolean(quest);
    if(!quest){readerKey='';return;}
    const pinCount=markers(quest.questId).length;
    const key=JSON.stringify([quest,pinCount,markerSource()]);if(key===readerKey)return;readerKey=key;
    text('quest-reader-title',quest.title);
    text('quest-reader-meta',[quest.level?`Level ${quest.level}`:'',quest.category,quest.tag,quest.frequency?'Repeatable':''].filter(Boolean).join(' · '));
    text('quest-reader-state',quest.failed?'Failed':quest.complete?'Ready for turn-in':quest.watched?'Tracked in WoW':'In progress');
    $('quest-reader-state').className=quest.failed?'quest-failed':quest.complete?'quest-complete':'';
    text('quest-reader-overview',quest.overview===null?'Receiving quest objectives…':quest.overview);
    const list=$('quest-reader-objectives'),objectiveKey=JSON.stringify(quest.objectives.map(objective=>[objective.text,objective.finished]));
    if(list.dataset.key!==objectiveKey){
      list.dataset.key=objectiveKey;list.replaceChildren();
      for(const objective of quest.objectives){
        const row=document.createElement('li'),check=document.createElement('span'),copy=document.createElement('span');
        check.textContent=objective.finished?'✓':'○';check.setAttribute('aria-hidden','true');
        copy.textContent=objective.text||'Receiving objective…';row.classList.toggle('is-complete',objective.finished);
        row.append(check,copy);list.append(row);
      }
    }
    text('quest-reader-description',quest.description===null?quest.descriptionAvailable?`Receiving quest text${quest.textProgress?` · ${quest.textProgress}%`:''}…`:'Waiting for quest text from WoW…':quest.description||'This quest has no additional description.');
    text('quest-reader-text-note',quest.limited?'This unusually long description has been shortened.':'');
    text('quest-reader-map-status',pinCount?`${pinCount} ${markerSource()} map ${pinCount===1?'marker':'markers'} available`:`${markerSource()} has no received map markers for this quest yet.`);
    $('quest-reader-map').disabled=!pinCount;
    $('quest-reader-map').onclick=()=>onMap(quest.questId);
  }
  search.addEventListener('input',renderList);filter.addEventListener('change',renderList);
  $('quest-reader-back').onclick=()=>{showReader(false);const entry=entries.get(selectedId);if(entry?.button.isConnected)entry.button.focus();else search.focus();};
  return {select,update(now,{connected,fresh,demo}){
    available=connected && fresh && !demo && feed.isFresh(now) && feed.summary?.status===1;
    current=available?feed.quests():[];
    if(!current.some(quest=>quest.questId===selectedId)){selectedId=current.find(quest=>quest.watched)?.questId??current[0]?.questId??null;readerKey='';if(selectedId===null)showReader(false);}
    const status=demo?'Connect WoW for your real quest log.':!connected?'Connect WoW to read your quests and live objectives.':!fresh?'Signal paused. Quest details are hidden until capture resumes.':!feed.isFresh(now)?'Waiting for quest log data. Install Forever addon 1.0.0, then /reload in WoW.':feed.summary?.status===0?'Quest log data is unavailable in this WoW client.':feed.summary?.status!==1?'WoW is loading your quest log…':`${current.filter(q=>q.named).length}/${feed.summary.count} quests received · ${current.filter(q=>q.complete).length} ready for turn-in`;
    text('quest-log-status',status);
    const key=JSON.stringify([available,current]);if(key!==lastKey){lastKey=key;renderList();}
    renderReader();
  }};
}
