import {loadPreferences,savePreferences} from './prefs.js';

export function createThemeControls(){
  const buttons=Array.from(document.querySelectorAll('.theme-options [data-theme]'));
  const colors={light:'#f4f5ef',dark:'#101114',original:'#111817'};
  function select(theme,persist=true){
    if(!Object.hasOwn(colors,theme))theme='original';
    document.documentElement.dataset.theme=theme;
    document.querySelector('meta[name="theme-color"]').content=colors[theme];
    for(const button of buttons)button.setAttribute('aria-pressed',String(button.dataset.theme===theme));
    if(persist)savePreferences({theme});
  }
  select(loadPreferences().theme,false);
  for(const button of buttons)button.addEventListener('click',()=>select(button.dataset.theme));
}
