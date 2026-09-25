const SHELL_CACHE='dalil-shell-v2';
const MAP_CACHE='dalil-map-tiles-v1';
const SHELL=['./','./index.html','./map.html','./manifest.webmanifest','./data/desert-places.json'];

self.addEventListener('install',event=>{
  event.waitUntil(caches.open(SHELL_CACHE).then(cache=>cache.addAll(SHELL)).then(()=>self.skipWaiting()));
});

self.addEventListener('activate',event=>{
  const keep=new Set([SHELL_CACHE,MAP_CACHE]);
  event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>!keep.has(key)).map(key=>caches.delete(key)))).then(()=>self.clients.claim()));
});

self.addEventListener('fetch',event=>{
  const request=event.request;
  if(request.method!=='GET') return;
  const url=new URL(request.url);
  if(url.origin!==self.location.origin) return;

  if(request.mode==='navigate'){
    event.respondWith(fetch(request).then(response=>{
      const copy=response.clone();
      caches.open(SHELL_CACHE).then(cache=>cache.put(request,copy));
      return response;
    }).catch(async()=>{
      const cached=await caches.match(request,{ignoreSearch:true});
      if(cached) return cached;
      return caches.match(url.pathname.endsWith('map.html')?'./map.html':'./index.html');
    }));
    return;
  }

  const isTile=url.pathname.includes('/tiles/')&&url.pathname.endsWith('.png');
  event.respondWith(caches.match(request,{ignoreSearch:true}).then(cached=>{
    if(cached) return cached;
    return fetch(request).then(response=>{
      if(response&&response.ok){
        const copy=response.clone();
        caches.open(isTile?MAP_CACHE:SHELL_CACHE).then(cache=>cache.put(request,copy));
      }
      return response;
    });
  }));
});
