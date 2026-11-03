const test = require('node:test');
const assert = require('node:assert/strict');
const navigation = import('../app/navigation.js');
const sizes = [[1100,650],[390,700],[600,600],[1600,350]];
const near = (a,b) => assert.ok(Math.abs(a-b)<0.00001, `${a} should equal ${b}`);

test('default artwork covers the complete map box without changing its proportions', async () => {
  const { mapViewport } = await navigation;
  for (const [width,height] of sizes) {
    const view = mapViewport(width,height,1024,683);
    assert.ok(view.x<=0 && view.y<=0);
    assert.ok(view.x+view.w>=width-0.00001 && view.y+view.h>=height-0.00001);
    near(view.w/view.h,1024/683);
    near(Math.min(view.w/width,view.h/height),1);
  }
});

test('panning stays at the artwork edges and map coordinates remain aligned', async () => {
  const { mapViewport, mapPoint, hitTestMap } = await navigation;
  const area = { uiMapId:123, polygon:[[.3,.3],[.7,.3],[.7,.7],[.3,.7]] };
  for (const [width,height] of sizes) for (const zoom of [1,2.5]) for (const pan of [{x:99999,y:-99999},{x:-99999,y:99999},{x:21,y:-12}]) {
    const view=mapViewport(width,height,1024,683,zoom,pan);
    assert.ok(view.x<=0.00001 && view.y<=0.00001);
    assert.ok(view.x+view.w>=width-0.00001 && view.y+view.h>=height-0.00001);
    const x=view.x+.5*view.w,y=view.y+.5*view.h;
    const point=mapPoint(x,y,view);near(point.x,.5);near(point.y,.5);
    assert.equal(hitTestMap([area],x,y,view)?.uiMapId,123);
  }
});

test('Whole map contains every edge, centers the artwork, and can adapt to a new box size', async () => {
  const { mapViewport, wholeMapZoom, mapPoint } = await navigation;
  for (const [width,height] of sizes) {
    const view=mapViewport(width,height,1024,683,wholeMapZoom(width,height,1024,683));
    assert.ok(view.x>=-0.00001 && view.y>=-0.00001);
    assert.ok(view.x+view.w<=width+0.00001 && view.y+view.h<=height+0.00001);
    near(view.x,(width-view.w)/2);near(view.y,(height-view.h)/2);
    near(Math.max(view.w/width,view.h/height),1);
    if(view.x>1)assert.equal(mapPoint(0,height/2,view),null);
  }
});

test('fill framing can keep a player near each map edge on screen without opening blank space', async () => {
  const { mapViewport, keepMapPointVisible } = await navigation;
  for (const [width,height] of sizes) for (const point of [{x:.01,y:.01},{x:.99,y:.99},{x:.01,y:.99},{x:.99,y:.01}]) {
    const view=mapViewport(width,height,1024,683);
    const shift=keepMapPointVisible(view,width,height,point);
    const adjusted=mapViewport(width,height,1024,683,1,shift);
    const x=adjusted.x+point.x*adjusted.w,y=adjusted.y+point.y*adjusted.h;
    assert.ok(x>=0 && x<=width && y>=0 && y<=height);
    assert.ok(adjusted.x<=0.00001 && adjusted.y<=0.00001);
    assert.ok(adjusted.x+adjusted.w>=width-0.00001 && adjusted.y+adjusted.h>=height-0.00001);
  }
});
