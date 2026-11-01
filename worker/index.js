const MAX_ASSET_BYTES=16*1024*1024;
const MODEL_PATH=/^(?:meta\/(?:character|charactercustomization|item|armor\/[0-9]{1,2})\/[0-9]{1,8}\.json|(?:m2|skin|skel|bone)\/[0-9]{1,8}\.(?:m2|skin|skel|bone)|textures\/[0-9]{1,8}\.(?:webp|png))$/;
export function modelAssetURL(path){
  if(!path.startsWith('/_model/'))return null;
  const name=path.slice(8);
  if(name==='viewer.js')return 'https://wow.zamimg.com/modelviewer/live/viewer/viewer.min.js';
  return MODEL_PATH.test(name)?'https://wow.zamimg.com/modelviewer/tbc/'+name:null;
}

export default {
  async fetch(request,env,ctx){
    const url=new URL(request.url),head=request.method==='HEAD';
    if(request.method!=='GET' && !head)return new Response('Method not allowed',{status:405,headers:{Allow:'GET, HEAD'}});
    if(url.pathname.startsWith('/_model/')){
      const target=!url.search && modelAssetURL(url.pathname);
      if(!target)return new Response('Model asset not found',{status:404});
      try{
        // Fetch only the fixed public CDN. No user headers or cookies are sent.
        const upstream=await fetch(target,{redirect:'error',signal:AbortSignal.timeout(15000)});
        if(!upstream.ok)return new Response('Model asset unavailable',{status:upstream.status===404?404:502});
        if(Number(upstream.headers.get('Content-Length'))>MAX_ASSET_BYTES)return new Response('Model asset too large',{status:502});
        const body=await upstream.arrayBuffer();
        if(body.byteLength>MAX_ASSET_BYTES)return new Response('Model asset too large',{status:502});
        const response=new Response(body,{headers:{'Content-Type':url.pathname.endsWith('viewer.js')?'text/javascript; charset=utf-8':upstream.headers.get('Content-Type')||'application/octet-stream','Cache-Control':'public, max-age=86400','X-Content-Type-Options':'nosniff'}});
        return head?new Response(null,{headers:response.headers}):response;
      }catch{return new Response('Model asset unavailable',{status:502});}
    }
    let path;
    try{path=decodeURIComponent(url.pathname);}catch{return new Response('Not found',{status:404});}
    if(path==='/')path='/index.html';
    const asset=STATIC_ASSETS[path];
    if(!asset)return new Response('Not found',{status:404});
    const data=Uint8Array.from(atob(asset.data),c=>c.charCodeAt(0));
    return new Response(head?null:data,{headers:{'Content-Type':asset.type,'Cache-Control':'no-cache','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'}});
  }
};
