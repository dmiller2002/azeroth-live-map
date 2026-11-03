// Native Forever artwork already uses the same coordinates as the addon.
export function mapSurface(meta, artwork = null) {
  if (artwork) return artwork;
  const canvas = document.createElement('canvas');
  canvas.width = meta?.width || 1024; canvas.height = meta?.height || 683;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#25352d'; ctx.fillRect(0,0,canvas.width,canvas.height);
  ctx.strokeStyle = '#7b9e8970'; ctx.fillStyle = '#c2d6c6'; ctx.font = '12px system-ui';
  for (let i=1;i<10;i++) {
    const x=canvas.width*i/10,y=canvas.height*i/10;
    ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,canvas.height);ctx.moveTo(0,y);ctx.lineTo(canvas.width,y);ctx.stroke();
    ctx.fillText(String(i*10),x+4,16);ctx.fillText(String(i*10),4,y-4);
  }
  return canvas;
}
