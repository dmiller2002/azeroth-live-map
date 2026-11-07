const validID = value => Number.isInteger(value) && value > 0 && value <= 65535;
const bounded = point => {
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y) || point.x < -1e-7 || point.x > 1+1e-7 || point.y < -1e-7 || point.y > 1+1e-7) return null;
  return {x:Math.max(0,Math.min(1,point.x)),y:Math.max(0,Math.min(1,point.y))};
};

// Static map layout only. No positions are inferred from decorative polygons.
export class MapLayout {
  constructor(){this.reset();}
  reset(){this.records=new Map();}
  accept(packet){
    if(packet.type!=='maplayout' || !validID(packet.mapId) || !Number.isInteger(packet.parentId) || packet.parentId<0 || packet.parentId>65535 || packet.mapId===packet.parentId) return false;
    if(!Number.isInteger(packet.mapType) || packet.mapType<0 || packet.mapType>6)return false;
    const {minX,maxX,minY,maxY}=packet;
    if(![minX,maxX,minY,maxY].every(value=>Number.isFinite(value) && value>=-4 && value<4) || minX>=maxX || minY>=maxY)return false;
    const visited=new Set([packet.mapId]);
    for(let id=packet.parentId;id;id=this.records.get(id)?.parentId){if(visited.has(id))return false;visited.add(id);}
    const record={parentId:packet.parentId,mapType:packet.mapType,minX,maxX,minY,maxY};
    if(JSON.stringify(this.records.get(packet.mapId))===JSON.stringify(record))return false;
    this.records.set(packet.mapId,record);return true;
  }
  catalog(base){
    return base.map(map=>{
      const rect=this.records.get(map.uiMapId);
      if(!rect)return {...map};
      const polygon=[[rect.minX,rect.minY],[rect.maxX,rect.minY],[rect.maxX,rect.maxY],[rect.minX,rect.maxY]];
      return {...map,parentId:rect.parentId||null,nativeRect:rect,...(map.kind==='city'
        ? {entrance:{x:(rect.minX+rect.maxX)/2,y:(rect.minY+rect.maxY)/2}}
        : {polygon})};
    });
  }
  project(source,target,point){
    if(!bounded(point))return null;
    if(source===target)return {...point};
    // Place a zone/city point on its actual continent/world ancestors.
    let current=source,position={...point},visited=new Set();
    while(current && !visited.has(current)){
      visited.add(current);
      const rect=this.records.get(current);
      if(!rect?.parentId)break;
      position={x:rect.minX+position.x*(rect.maxX-rect.minX),y:rect.minY+position.y*(rect.maxY-rect.minY)};
      current=rect.parentId;
      if(current===target)return bounded(position);
    }
    // Native waypoints may be reported on a parent map. Project them back
    // into a child only if the native rectangle actually contains the point.
    current=target;visited=new Set();let x=0,y=0,width=1,height=1;
    while(current && !visited.has(current)){
      visited.add(current);
      const rect=this.records.get(current);
      if(!rect?.parentId)break;
      const w=rect.maxX-rect.minX,h=rect.maxY-rect.minY;
      x=rect.minX+x*w;y=rect.minY+y*h;width*=w;height*=h;current=rect.parentId;
      if(current===source)return bounded({x:(point.x-x)/width,y:(point.y-y)/height});
    }
    return null;
  }
}
