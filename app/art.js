// Opaque artwork pixels carry brightness changes that survive video capture.
// A short monochrome locator beneath it preserves reliable auto-discovery.
export function artGeometry(rect,art){
  const cell=rect.width/50;
  return {x:rect.x,y:rect.y-art.height*cell,width:art.width*cell,height:(art.height+art.footerRows)*cell,cell};
}
const carrierBase=(color,encoding)=>encoding===1?color.slice(0,3).map(value=>Math.max(48,Math.min(207,value))):color;
const pixel=(image,x,y)=>{
  x=Math.floor(x);y=Math.floor(y);
  if(x<0||y<0||x>=image.width||y>=image.height)return null;
  const i=(y*image.width+x)*4;
  return [image.data[i],image.data[i+1],image.data[i+2]];
};
export function decodeArtAt(image,rect,art,decodeBytes,header){
  if(!art)return null;
  const box=artGeometry(rect,art),cell=box.cell;
  if(cell<1.4||box.x<0||box.y<0||box.x+box.width>image.width+cell||box.y+box.height>image.height+cell)return null;
  for(let i=0;i<48;i++){
    const expected=(header[i>>3]>>(7-(i&7)))&1;
    for(let row=1;row<=2;row++){
      const color=pixel(image,rect.x+(i+1.5)*cell,rect.y+(row+.5)*cell);
      if(!color)return null;
      const value=(color[0]+color[1]+color[2])/3;
      if((row===1?expected:1-expected)?value<170:value>85)return null;
    }
  }
  const colors=art.positions.map(position=>pixel(image,box.x+(position%art.width+.5)*cell,box.y+(Math.floor(position/art.width)+.5)*cell));
  let best=null;
  // NV12/YUV420 window capture reduces chroma resolution. Red alone can then
  // contain a neighbor's color even when its brightness sample is intact.
  // Try both standard luma matrices as well as the original RGB path, and
  // accept only complete checksummed packets with the artwork mode marker.
  const channels=[
    {name:'red',weights:[1,0,0],threshold:10},
    {name:'luma601',weights:[.299,.587,.114],threshold:2},
    {name:'luma709',weights:[.2126,.7152,.0722],threshold:1.5},
  ];
  for(let frame=0;frame<art.frames.length;frame++)for(const encoding of [1,0])for(const channel of channels){
    const laneBytes=[];
    const read=lane=>{
      const bytes=new Uint8Array(24);
      for(let bit=0;bit<192;bit++){
        const index=lane*192+bit,position=art.positions[index];
        const expected=carrierBase(art.palette[art.frames[frame][position]],encoding),actual=colors[index];
        if(!actual)return null;
        const difference=channel.weights.reduce((sum,weight,i)=>sum+weight*(actual[i]-expected[i]),0);
        if(!Number.isFinite(difference)||Math.abs(difference)<channel.threshold)return null;
        if(difference>0)bytes[bit>>3]|=1<<(7-(bit&7));
      }
      const packet=decodeBytes(bytes);
      if(packet && (lane===0 || ['quest','questlog','character','bags','bank','guild','maplayout'].includes(packet.type)))laneBytes[lane]=bytes;
      return packet;
    };
    const first=read(0);
    if(!first||first.type||!first.artMode||first.artEncoding!==encoding)continue;
    const packets=[first];
    for(let lane=1;lane<=first.questLanes;lane++){
      const packet=read(lane);if(['quest','questlog','character','bags','bank','guild','maplayout'].includes(packet?.type))packets.push(packet);
    }
    let error=0;
    for(let i=0;i<(first.questLanes+1)*192;i++){
      const expected=carrierBase(art.palette[art.frames[frame][art.positions[i]]],encoding),actual=colors[i];
      if(!actual){error=Infinity;break;}
      // Score only lanes whose checksum passed; missing packets must not shift
      // the lane index or make a different pose appear artificially closer.
      const bytes=laneBytes[Math.floor(i/192)];
      if(!bytes)continue;
      const sign=((bytes[(i%192)>>3]>>(7-(i&7)))&1)?1:-1;
      error+=Math.abs(actual[0]-expected[0]-sign*art.delta)
        +Math.abs(actual[1]-expected[1]-(encoding===1?sign*art.delta:0))
        +Math.abs(actual[2]-expected[2]-(encoding===1?sign*art.delta:0));
    }
    if(!best || packets.length>best.packets.length || (packets.length===best.packets.length && error<best.error))best={packets,frame,error,channel:channel.name,encoding};
  }
  return best;
}

// Shared canvas renderer for browser QA and the downloadable animated preview.
export function drawArtBlock(ctx,packets,art,frame,x,y,cell,header){
  const colors=art.frames[frame];
  for(let p=0;p<colors.length;p++){
    const color=art.palette[colors[p]];if(!color[3])continue;
    ctx.fillStyle=`rgb(${color[0]},${color[1]},${color[2]})`;
    ctx.fillRect(x+(p%art.width)*cell,y+Math.floor(p/art.width)*cell,cell,cell);
  }
  for(let i=0;i<packets.length*192;i++){
    const p=art.positions[i],encoding=packets[0][21],color=carrierBase(art.palette[colors[p]],encoding),packet=packets[Math.floor(i/192)];
    const value=(packet[(i%192)>>3]>>(7-(i&7)))&1;
    const delta=value?art.delta:-art.delta;
    ctx.fillStyle=`rgb(${color[0]+delta},${color[1]+(encoding===1?delta:0)},${color[2]+(encoding===1?delta:0)})`;
    ctx.fillRect(x+(p%art.width)*cell,y+Math.floor(p/art.width)*cell,cell,cell);
  }
  const top=y+art.height*cell;
  ctx.fillStyle='#000';ctx.fillRect(x,top,50*cell,art.footerRows*cell);
  ctx.fillStyle='#fff';
  for(let i=0;i<48;i++){
    const value=(header[i>>3]>>(7-(i&7)))&1;
    ctx.fillRect(x+(i+1)*cell,top+(value?1:2)*cell,cell,cell);
  }
}
