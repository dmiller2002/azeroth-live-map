const test=require('node:test');
const assert=require('node:assert/strict');
const dungeons=require('../app/dungeons.json');
const maps=require('../app/maps.json');

test('every classic dungeon and raid is listed with all of its floors',()=>{
  assert.equal(dungeons.length,25);
  assert.equal(dungeons.reduce((n,d)=>n+d.floors.length,0),63);
  assert.equal(dungeons.filter(d=>d.kind==='raid').length,6);
  const sfk=dungeons.find(d=>d.name==='Shadowfang Keep');
  assert.deepEqual(sfk.floors.map(f=>f.floorName),['The Courtyard','Dining Hall','The Vacant Den','Lower Observatory','Upper Observatory',"Lord Godfrey's Chamber",'The Wall Walk']);
  const zones=new Set(maps.map(m=>m.uiMapId));
  for(const d of dungeons){
    assert.ok(zones.has(d.zone),`${d.name} must sit in a listed zone`);
    d.floors.forEach((f,i)=>{
      assert.equal(f.floor,i+1);assert.equal(f.uiMapId,50000+d.instanceId*10+f.floor);
      assert.match(f.url,/^https:\/\/wow\.zamimg\.com\/images\/wow\/maps\/enus\/original\/[0-9]+(-[0-9]+)?\.jpg$/);
      // Wider exports are cropped to the client's 1002 x 668 map area.
      if(f.width===1009)assert.deepEqual(f.crop,[0,0,1002,668]);else assert.equal(f.crop,undefined);
    });
  }
  assert.ok(Math.max(...dungeons.flatMap(d=>d.floors.map(f=>f.uiMapId)))<=65535);
});

test('dungeon floors become browsable maps under their zone',async()=>{
  const {buildDungeonCatalog}=await import('../app/navigation.js');
  const catalog=buildDungeonCatalog(dungeons);
  const bwl=catalog.filter(m=>m.instanceName==='Blackwing Lair');
  assert.equal(bwl.length,4);assert.equal(bwl[0].kind,'raid');assert.equal(bwl[0].parentId,1428);
  assert.equal(bwl[1].name,'Blackwing Lair · Halls of Strife');
  assert.deepEqual(bwl[0].floors,bwl.map(m=>m.uiMapId));
  assert.equal(bwl[0].width,1002);assert.equal(bwl[0].height,668);
  assert.equal(catalog.find(m=>m.instanceName==='Molten Core').name,'Molten Core');
});
