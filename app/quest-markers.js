// Original vector artwork using Questie's familiar map symbol conventions.
// Icon IDs come from Questie's ICON_TYPE_* constants; old addons use kind defaults.
const GOLD = ['#fff1a3','#ffd331','#dc8c08'];
const BLUE = ['#cbf4ff','#45bfff','#1670cc'];
const GRAY = ['#f2f1df','#b5b8ad','#727971'];
const GREEN = ['#e9ffaf','#98dc39','#479b1a'];
const RED = ['#ffe2b9','#f47c45','#b52f22'];
export function questMarkerStyle({markerKind,iconType=0}) {
  const palette=iconType===7 || iconType===12 ? GRAY : iconType===10 || iconType===11 ? BLUE
    : iconType===13 || iconType===14 ? GREEN : iconType===15 || iconType===16 ? RED : GOLD;
  const shape=markerKind===1 ? 'pickup' : markerKind===3 ? 'turnin'
    : ({1:'sword',2:'bag',3:'search',4:'gear',5:'talk',12:'turnin',17:'gear',23:'bag'})[iconType] || 'search';
  const label=markerKind===1 ? 'Quest available' : markerKind===3 ? 'Ready for turn-in'
    : ({sword:'Slay',bag:'Collect',search:'Explore',gear:'Interact',talk:'Talk',turnin:'Quest in progress'})[shape];
  return {shape,palette,label};
}

const sprites=new Map();
function sprite(style) {
  const key=style.shape+style.palette.join();
  if(sprites.has(key))return sprites.get(key);
  // Render once at 3x for sharp outlines at fractional desktop zoom levels.
  const image=document.createElement('canvas');image.width=image.height=96;
  image.dataset.questMarker=style.shape;
  const ctx=image.getContext('2d');ctx.scale(3,3);
  ctx.lineJoin='round';ctx.lineCap='round';
  const gradient=(colors,x=0,y=0,x2=0,y2=32)=>{
    const value=ctx.createLinearGradient(x,y,x2,y2);
    colors.forEach((color,i)=>value.addColorStop(i/(colors.length-1),color));return value;
  };
  const paint=(path,fill,stroke='#241c10',width=1.8)=>{
    const p=new Path2D(path);ctx.fillStyle=fill;ctx.strokeStyle=stroke;ctx.lineWidth=width;ctx.stroke(p);ctx.fill(p);
  };
  const metal=gradient(['#f3fcff','#92b7c2','#456576']);
  const gold=gradient(style.palette);
  switch(style.shape){
    case 'pickup':
      paint('M12 3 Q16 1 20 3 L18.6 20 Q16 22 13.4 20 Z',gold,'#211609',2.5);
      paint('M19.5 26 A3.5 3.5 0 1 1 12.5 26 A3.5 3.5 0 1 1 19.5 26',gold,'#211609',2.2);
      break;
    case 'turnin':
      paint('M8 9 C8 0 24 0 24 9 C24 15 18 15 18 20 L13 20 C12 13 18 13 18 9 C18 6 14 6 14 10 L8 10 Z',gold,'#211609',2.5);
      paint('M19 26 A3.5 3.5 0 1 1 12 26 A3.5 3.5 0 1 1 19 26',gold,'#211609',2.2);
      break;
    case 'sword':
      paint('M11 20 L23 5 L30 2 L27 10 L15 23 Z',metal);
      paint('M13 20 L28 4 L15 23 Z','#d2edf3','#d2edf3',.4);
      paint('M5 22 L8 19 L17 26 L14 29 Z',gradient(['#ffec9c','#bf8126']));
      paint('M10 24 L6 29 L3 27 L7 22 Z','#8b4830');
      paint('M2 27 L5 26 L7 29 L4 31 Z','#e5b75b');
      break;
    case 'bag':
      paint('M12 10 L10 3 Q16 7 21 3 L19 10 Z',gradient(['#e5d3a0','#9c7445']));
      paint('M12 10 C10 15 5 17 5 23 C5 32 27 32 27 23 C27 17 22 14 19 10 Z',gradient(['#f3ddb1','#b59558','#7b5c34']));
      paint('M11 10 Q16 12 21 10 L20 13 Q16 15 11 13 Z','#c48533','#4f321c',1.2);
      ctx.strokeStyle='#826137';ctx.lineWidth=1;ctx.stroke(new Path2D('M12 16 Q8 23 11 26 M20 17 Q24 23 21 27'));
      break;
    case 'gear': {
      const points=[];
      for(let i=0;i<32;i++){
        const radius=i%4===0 || i%4===3 ? 13 : 10,angle=i*Math.PI/16;
        points.push(`${16+Math.cos(angle)*radius} ${16+Math.sin(angle)*radius}`);
      }
      paint('M'+points.join(' L')+' Z',gradient(['#ffe4a1','#c69c51','#7e5725']));
      paint('M22 16 A6 6 0 1 1 10 16 A6 6 0 1 1 22 16','#4a4230','#f0cb7a',1.4);
      break;
    }
    case 'talk':
      paint('M3 13 C3 1 29 1 29 13 C29 21 22 23 15 22 L9 28 L10 21 C5 20 3 17 3 13 Z',gradient(['#fffef0','#d1d0bc']),'#252823',2);
      break;
    default: // Questie's event/exploration magnifying glass.
      paint('M14 18 L6 29 Q3 31 2 27 L11 16 Z',gradient(['#d2a564','#805333']));
      paint('M28 12 A10 10 0 1 1 8 12 A10 10 0 1 1 28 12',metal);
      paint('M25 12 A7 7 0 1 1 11 12 A7 7 0 1 1 25 12',gradient(['#7f9aa1','#33474e']),'#29393d',1.4);
      ctx.strokeStyle='#c0dce0';ctx.lineWidth=1.4;ctx.stroke(new Path2D('M13 12 Q13 7 18 7'));
  }
  sprites.set(key,image);return image;
}

export function drawQuestMarker(ctx,marker,{focused=false,dimmed=false}={}) {
  ctx.save();
  ctx.globalAlpha=dimmed ? .35 : 1;
  if(focused){
    ctx.fillStyle='#fff1a328';ctx.strokeStyle='#fff1b3';ctx.lineWidth=1.5;
    ctx.beginPath();ctx.arc(0,0,16,0,Math.PI*2);ctx.fill();ctx.stroke();
  }
  ctx.shadowColor='#100e09';ctx.shadowBlur=3;ctx.shadowOffsetY=1;
  const style=questMarkerStyle(marker),size=style.shape==='pickup' || style.shape==='turnin' ? 28 : 24;
  ctx.drawImage(sprite(style),-size/2,-size/2,size,size);
  ctx.restore();
}
