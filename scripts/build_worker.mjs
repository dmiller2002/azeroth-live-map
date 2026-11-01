// Keep dist/ as the local app source; emit a separate self-contained Worker.
import {readFile,writeFile,mkdir,readdir,rm,copyFile} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
const root=resolve(import.meta.dirname,'..'),output=resolve(root,'dist');
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.webmanifest':'application/manifest+json','.svg':'image/svg+xml','.png':'image/png','.zip':'application/zip','.txt':'text/plain; charset=utf-8'};
const assets={};
async function collect(directory,prefix=''){
  for(const entry of await readdir(directory,{withFileTypes:true})){
    if(!prefix && ['server','.openai'].includes(entry.name))continue;
    if(entry.isSymbolicLink())throw new Error('Static assets must not be symlinks');
    const name=prefix+'/'+entry.name,path=resolve(directory,entry.name);
    if(entry.isDirectory())await collect(path,name);
    else assets[name]={type:mime[extname(entry.name)]||'application/octet-stream',data:(await readFile(path)).toString('base64')};
  }
}
await collect(resolve(root,'dist'));
await rm(resolve(output,'server'),{recursive:true,force:true});await mkdir(resolve(output,'server'),{recursive:true});await mkdir(resolve(output,'.openai'),{recursive:true});
const source=await readFile(resolve(root,'worker/index.js'),'utf8');
await writeFile(resolve(output,'server/index.js'),'const STATIC_ASSETS='+JSON.stringify(assets)+';\n'+source);
await copyFile(resolve(root,'.openai/hosting.json'),resolve(output,'.openai/hosting.json'));
console.log(`Worker built with ${Object.keys(assets).length} app assets.`);
