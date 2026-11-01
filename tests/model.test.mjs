import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {modelId,equippedModels} from '../dist/character-model.js';
import worker,{modelAssetURL} from '../worker/index.js';

test('Classic model IDs preserve the actual race and male/female body type',()=>{
  for(const race of [1,2,3,4,5,6,7,8,10,11]){
    assert.equal(modelId(race,2),race*2-1);assert.equal(modelId(race,3),race*2);
  }
  assert.equal(modelId(0,2),null);assert.equal(modelId(5,0),null);assert.equal(modelId(99,3),null);
});
test('equipped items map to model armor/weapon slots and report unsupported appearances',()=>{
  const items={1:16914,2:999,5:123,15:456,16:19019,17:19349,18:789,19:888};
  const feed={slot:slot=>({info:{itemId:items[slot]||0}})};
  const mapping={16914:[34218,1],123:[1234,20],456:[2345,16],19019:[30606,13],19349:[31852,14],789:[3456,26]};
  const model=equippedModels(feed,mapping);
  assert.deepEqual(model.items.map(item=>[item.slot,item.display]),[[1,34218],[20,1234],[16,2345],[21,30606],[22,31852],[26,3456]]);
  assert.deepEqual(model.unknown,[888],'missing appearances are reported rather than replaced with guessed gear');
  items[16]=0;assert.ok(!equippedModels(feed,mapping).items.some(item=>item.slot===21),'removed weapons leave the preview');
});
test('local and hosted model routes allow only the fixed public model CDN',()=>{
  const allowed=['/_model/viewer.js','/_model/meta/character/9.json','/_model/meta/armor/1/34218.json','/_model/meta/charactercustomization/9.json','/_model/m2/121608.m2','/_model/skin/471708.skin','/_model/skel/123.skel','/_model/textures/123.webp'];
  const rejected=['/_model/https://example.com/private','/_model/../index.html','/_model/meta/character/9.json?url=http://localhost','/_model/meta/character/%2e%2e/9.json','/_model/textures/a.webp','/_model/meta/character/123456789.json','/elsewhere','/_model/viewer.js#fragment'];
  allowed.forEach(path=>assert.ok(modelAssetURL(path)?.startsWith('https://wow.zamimg.com/modelviewer/')));
  rejected.forEach(path=>assert.equal(modelAssetURL(path),null));
  const python=spawnSync('python3',['-c',`import sys,json;sys.path.insert(0,'scripts');from model_assets import model_asset_url;print(json.dumps([model_asset_url(path) for path in json.loads(sys.stdin.read())]))`],{input:JSON.stringify([...allowed,...rejected]),encoding:'utf8'});
  assert.equal(python.status,0,python.stderr);
  assert.deepEqual(JSON.parse(python.stdout),[...allowed,...rejected].map(modelAssetURL));
});
test('hosted model requests never forward user credentials and enforce response bounds',async()=>{
  const original=globalThis.fetch;const requests=[];
  const cacheDescriptor=Object.getOwnPropertyDescriptor(globalThis,'caches');
  try{
    Object.defineProperty(globalThis,'caches',{configurable:true,get(){throw new Error('Hosted dispatch workers cannot access the default cache');}});
    globalThis.fetch=async(url,options)=>{requests.push({url,options});return new Response('model-data',{headers:{'Content-Type':'application/octet-stream'}});};
    const response=await worker.fetch(new Request('https://app.example/_model/m2/123.m2',{headers:{Cookie:'private-user-cookie',Authorization:'private-user-token',Origin:'https://unrelated.example'}}),{},{});
    assert.equal(response.status,200);assert.equal(await response.text(),'model-data');
    assert.equal(requests[0].url,'https://wow.zamimg.com/modelviewer/tbc/m2/123.m2');
    assert.equal(requests[0].options.headers,undefined);assert.equal(requests[0].options.redirect,'manual');
    assert.equal((await worker.fetch(new Request('https://app.example/_model/m2/123.m2',{method:'HEAD'}),{},{})).body,null);
    globalThis.fetch=async()=>new Response('small',{headers:{'Content-Length':String(17*1024*1024)}});
    assert.equal((await worker.fetch(new Request('https://app.example/_model/m2/123.m2'),{},{})).status,502);
    assert.equal((await worker.fetch(new Request('https://app.example/_model/m2/123.m2',{method:'POST'}),{},{})).status,405);
    assert.equal((await worker.fetch(new Request('https://app.example/_model/m2/123.m2?host=evil'),{},{})).status,404);
  }finally{globalThis.fetch=original;if(cacheDescriptor)Object.defineProperty(globalThis,'caches',cacheDescriptor);else delete globalThis.caches;}
});
