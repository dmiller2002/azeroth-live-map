const test=require('node:test');
const assert=require('node:assert/strict');
const names=['map','character','bags','guild','updates'];
test('old quest selection opens the combined map and quest view',async()=>{
  const {resolveTabLayout}=await import('../app/tabs.js');
  assert.deepEqual(resolveTabLayout({activeTab:'quests',secondaryTab:'bags',splitView:false},names),{primary:'map',secondary:'bags',split:false});
});
test('an old map/quests split becomes one combined view',async()=>{
  const {resolveTabLayout}=await import('../app/tabs.js');
  for(const [activeTab,secondaryTab]of [['map','quests'],['quests','map']]){
    const layout=resolveTabLayout({activeTab,secondaryTab,splitView:true},names);
    assert.equal(layout.primary,'map');assert.equal(layout.split,false);assert.notEqual(layout.secondary,'map');
  }
});
test('split view with another panel survives the merge',async()=>{
  const {resolveTabLayout}=await import('../app/tabs.js');
  assert.deepEqual(resolveTabLayout({activeTab:'guild',secondaryTab:'quests',splitView:true},names),{primary:'guild',secondary:'map',split:true});
});
