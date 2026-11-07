// Native Forever overview artwork. Live C_Map rectangles supply navigation
// regions and coordinate transforms; artwork is never stretched to fit zones.
const overview = (uiMapId, name, artwork, kind, parentId = null) => ({
  uiMapId, name, kind, parentId, edition:'forever', width:1024, height:683,
  url:`https://wow.zamimg.com/images/wow/classicplus/maps/enus/original/${artwork}.jpg`,
});
const overviews = [
  overview(946, 'Worlds', -4, 'cosmic'),
  overview(947, 'Azeroth', -1, 'world', 946),
  overview(1414, 'Kalimdor', -6, 'continent', 947),
  overview(1415, 'Eastern Kingdoms', -3, 'continent', 947),
];
// Parent hints are only for offline breadcrumbs. Geometry comes from C_Map.
const parents = new Map([
  [947, 946], [1414, 947], [1415, 947], [1423, 1415],
  [1422, 1415], [1420, 1415], [1421, 1415], [1416, 1415], [1424, 1415], [1425, 1415], [1417, 1415], [1437, 1415],
  [1426, 1415], [1432, 1415], [1427, 1415], [1418, 1415], [1428, 1415], [1429, 1415], [1433, 1415], [1436, 1415],
  [1431, 1415], [1430, 1415], [1435, 1415], [1419, 1415], [1434, 1415], [1438, 1414],
  [1439, 1414], [1450, 1414], [1452, 1414], [1448, 1414], [1440, 1414], [1447, 1414], [1442, 1414], [1413, 1414],
  [1411, 1414], [1443, 1414], [1412, 1414], [1444, 1414], [1445, 1414], [1441, 1414], [1446, 1414], [1449, 1414],
  [1451, 1414],
]);
const cities = new Map([[1453,1429],[1455,1426],[1458,1420],[1454,1411],[1456,1412],[1457,1438]]);
const battlegrounds = new Set([1459,1460,1461]);

export function buildMapCatalog(zones) {
  const catalog = [...overviews, ...zones.map(map => ({...map, kind:battlegrounds.has(map.uiMapId) ? 'battleground' : 'zone', parentId:map.parentId ?? 947}))];
  for (const map of catalog) if (parents.has(map.uiMapId)) map.parentId=parents.get(map.uiMapId);
  for (const [id,parentId] of cities) {
    const map = catalog.find(map => map.uiMapId === id);
    if (map) Object.assign(map,{kind:'city',parentId});
  }
  return catalog;
}

export function mapViewport(width, height, imageWidth, imageHeight, zoom = 1, pan = {x:0,y:0}) {
  const base = Math.max(width/imageWidth,height/imageHeight);
  const w = imageWidth*base*zoom, h = imageHeight*base*zoom;
  const limitX = Math.max(0,(w-width)/2), limitY = Math.max(0,(h-height)/2);
  return {x:(width-w)/2+Math.max(-limitX,Math.min(limitX,pan.x)),y:(height-h)/2+Math.max(-limitY,Math.min(limitY,pan.y)),w,h};
}

export function wholeMapZoom(width, height, imageWidth, imageHeight) {
  if (Math.min(width,height,imageWidth,imageHeight) <= 0) return 1;
  return Math.min(width/imageWidth,height/imageHeight)/Math.max(width/imageWidth,height/imageHeight);
}

export function keepMapPointVisible(viewport, width, height, point, margin = 32) {
  const x=viewport.x+point.x*viewport.w,y=viewport.y+point.y*viewport.h;
  const insetX=Math.min(margin,width/2),insetY=Math.min(margin,height/2);
  return {
    x:Math.max(insetX-x,Math.min(0,width-insetX-x)),
    y:Math.max(insetY-y,Math.min(0,height-insetY-y))
  };
}

export function mapPoint(x, y, viewport) {
  if (!viewport || viewport.w <= 0 || viewport.h <= 0) return null;
  const point = {x:(x-viewport.x)/viewport.w,y:(y-viewport.y)/viewport.h};
  return point.x < 0 || point.x > 1 || point.y < 0 || point.y > 1 ? null : point;
}

export function containsPoint(polygon, point) {
  let inside = false;
  for (let i=0,j=polygon.length-1;i<polygon.length;j=i++) {
    const [xi,yi]=polygon[i], [xj,yj]=polygon[j];
    if ((yi>point.y)!==(yj>point.y) && point.x<(xj-xi)*(point.y-yi)/(yj-yi)+xi) inside=!inside;
  }
  return inside;
}

export function hitTestMap(children, x, y, viewport) {
  const point = mapPoint(x,y,viewport);
  if (!point) return null;
  return children.find(map => map.entrance && Math.hypot(x-viewport.x-map.entrance.x*viewport.w,y-viewport.y-map.entrance.y*viewport.h)<=16)
    || children.filter(map => map.polygon && containsPoint(map.polygon,point)).sort((a,b)=>{
      const area=map=>map.nativeRect?(map.nativeRect.maxX-map.nativeRect.minX)*(map.nativeRect.maxY-map.nativeRect.minY):Infinity;
      return area(a)-area(b);
    })[0] || null;
}
