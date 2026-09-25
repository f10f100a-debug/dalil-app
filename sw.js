const SHELL_CACHE='dalil-shell-v7';
const MAP_CACHE='dalil-map-tiles-v1';
const SHELL=['./','./index.html','./map.html','./manifest.webmanifest','./data/desert-places.json','./events.js?v=2'];

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

// تنبيهات الأحداث (سيول، أمطار، إعلانات) المرسلة من لوحة الإدارة.
self.addEventListener('push',event=>{
  let d={};
  try{ d=event.data?event.data.json():{}; }catch(e){ d={title:'دليل',body:event.data?event.data.text():''}; }
  const title=String(d.title||'دليل — بوصلة البر').slice(0,80);
  event.waitUntil(self.registration.showNotification(title,{
    body:String(d.body||'').slice(0,200),
    tag:d.tag||undefined,
    lang:'ar', dir:'rtl',
    data:{url:typeof d.url==='string'?d.url:'./'}
  }));
});

self.addEventListener('notificationclick',event=>{
  event.notification.close();
  // نفتح روابط التطبيق نفسه فقط.
  let target=new URL('./',self.registration.scope).href;
  try{
    const u=new URL(event.notification.data&&event.notification.data.url||'./',self.registration.scope);
    if(u.origin===self.location.origin&&u.pathname.startsWith(new URL(self.registration.scope).pathname)) target=u.href;
  }catch(e){}
  event.waitUntil(self.clients.matchAll({type:'window',includeUncontrolled:true}).then(list=>{
    for(const c of list){ if('navigate' in c){ return c.navigate(target).then(w=>(w||c).focus()); } }
    return self.clients.openWindow(target);
  }));
});
