import {loadPreferences,savePreferences} from './prefs.js';

export function resolveTabLayout(saved,names){
  const alias=name=>name==='quests'?'map':name;
  const preferred=alias(saved.activeTab),other=alias(saved.secondaryTab);
  const primary=names.includes(preferred)?preferred:'map';
  let secondary=names.includes(other)?other:'bags';
  const duplicate=primary===secondary;
  if(duplicate)secondary=names.find(name=>name!==primary);
  return {primary,secondary,split:Boolean(saved.splitView) && !duplicate};
}

// Each tab declares its panel through aria-controls. Future views can join
// this same navigation without owning the shared capture or connection state.
export function createTabs(onChange=()=>{}){
  const list=document.getElementById('app-tabs');
  const tabs=Array.from(list.querySelectorAll('[role="tab"][data-view]'));
  const views=new Map(tabs.map(tab=>[tab.dataset.view,{tab,panel:document.getElementById(tab.getAttribute('aria-controls'))}]));
  const saved=loadPreferences(),toggle=document.getElementById('split-view-toggle');
  const primarySelect=document.getElementById('split-primary'),secondarySelect=document.getElementById('split-secondary');
  let {primary,secondary,split}=resolveTabLayout(saved,[...views.keys()]);
  for(const [name,{tab}] of views)for(const select of [primarySelect,secondarySelect]){
    const option=document.createElement('option');option.value=name;option.textContent=tab.textContent;select.append(option);
  }
  function render({focus=false,persist=true}={}){
    const visible=[primary,...(split?[secondary]:[])];
    for(const [name,{tab,panel}] of views){
      const shown=visible.includes(name);
      tab.setAttribute('aria-selected',String(shown));tab.tabIndex=name===primary?0:-1;panel.hidden=!shown;
      if(split)tab.setAttribute('aria-expanded',String(shown));else tab.removeAttribute('aria-expanded');
    }
    const panels=document.getElementById('viewer-panels');
    const ordered=[...visible,...[...views.keys()].filter(name=>!visible.includes(name))];
    ordered.forEach((name,index)=>{
      const panel=views.get(name).panel;
      if(panels.children[index]!==panel)panels.insertBefore(panel,panels.children[index]||null);
    });
    list.setAttribute('aria-multiselectable',String(split));
    document.body.dataset.activeTab=primary;
    document.body.dataset.mapVisible=String(visible.includes('map'));
    document.body.classList.toggle('split-view',split);
    toggle.setAttribute('aria-pressed',String(split));toggle.textContent=split?'Single view':'Split view';
    document.getElementById('split-view-options').hidden=!split;
    primarySelect.value=primary;secondarySelect.value=secondary;
    if(focus)views.get(primary).tab.focus();
    if(persist)savePreferences({activeTab:primary,secondaryTab:secondary,splitView:split});
    onChange(primary);
  }
  function select(view,{focus=true,persist=true}={}){
    if(!views.has(view))view='map';
    if(view===secondary)secondary=primary;
    primary=view;render({focus,persist});
  }
  toggle.addEventListener('click',()=>{split=!split;render();});
  primarySelect.addEventListener('change',()=>select(primarySelect.value,{focus:false}));
  secondarySelect.addEventListener('change',()=>{
    const next=secondarySelect.value;if(!views.has(next))return;
    if(next===primary)primary=secondary;
    secondary=next;render();
  });
  document.getElementById('split-view-swap').addEventListener('click',()=>{[primary,secondary]=[secondary,primary];render();});
  for(const tab of tabs)tab.addEventListener('click',()=>select(tab.dataset.view));
  list.addEventListener('keydown',event=>{
    if(event.altKey || event.ctrlKey || event.metaKey)return;
    const index=tabs.indexOf(event.target);if(index<0)return;
    let next;
    if(event.key==='ArrowRight')next=(index+1)%tabs.length;
    else if(event.key==='ArrowLeft')next=(index+tabs.length-1)%tabs.length;
    else if(event.key==='Home')next=0;
    else if(event.key==='End')next=tabs.length-1;
    else return;
    event.preventDefault();select(tabs[next].dataset.view);
  });
  render({persist:false});
  return {select};
}
