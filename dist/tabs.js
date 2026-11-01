import {loadPreferences,savePreferences} from './prefs.js';

// Each tab declares its panel through aria-controls. Future views can join
// this same navigation without owning the shared capture or connection state.
export function createTabs(onChange=()=>{}){
  const list=document.getElementById('app-tabs');
  const tabs=Array.from(list.querySelectorAll('[role="tab"][data-view]'));
  const views=new Map(tabs.map(tab=>[tab.dataset.view,{tab,panel:document.getElementById(tab.getAttribute('aria-controls'))}]));
  function select(view,{focus=true,persist=true}={}){
    if(!views.has(view))view='map';
    for(const [name,{tab,panel}] of views){
      const selected=name===view;
      tab.setAttribute('aria-selected',String(selected));tab.tabIndex=selected?0:-1;panel.hidden=!selected;
    }
    document.body.dataset.activeTab=view;
    if(focus)views.get(view).tab.focus();
    if(persist)savePreferences({activeTab:view});
    onChange(view);
  }
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
  select(loadPreferences().activeTab,{focus:false,persist:false});
  return {select};
}
