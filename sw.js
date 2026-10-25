const SHELL_CACHE='dalil-shell-v186';
const OFFLINE_MAPS='dalil-offline-maps-v1'; // خرائط PMTiles المحفوظة من map2.html (تُدار من الصفحة نفسها)
const SHELL=['./','./index.html','./map.html','./map2.html','./vendor/maplibre-gl-csp.js','./vendor/maplibre-gl-csp-worker.js','./vendor/maplibre-gl.css','./vendor/pmtiles.js','./vendor/mapbox-gl-rtl-text.js','./data/maps.json','./vendor/glyphs/Noto%20Sans%20Regular/0-255.pbf','./vendor/glyphs/Noto%20Sans%20Regular/1536-1791.pbf','./vendor/glyphs/Noto%20Sans%20Regular/1792-2047.pbf','./vendor/glyphs/Noto%20Sans%20Regular/256-511.pbf','./vendor/glyphs/Noto%20Sans%20Regular/64256-64511.pbf','./vendor/glyphs/Noto%20Sans%20Regular/65024-65279.pbf','./vendor/glyphs/Noto%20Sans%20Regular/8192-8447.pbf','./vendor/glyphs/Noto%20Sans%20Regular/9472-9727.pbf','./manifest.webmanifest','./assets/icon-192.png','./data/open-places.json','./data/wadis.json','./events.js?v=16',
  './room.js?v=25','./privacy.html','./support.html','./mapimport.js','./vendor/sql-wasm.js','./vendor/sql-wasm.wasm','./vendor/geotiff.js','./data/region-grid.json?v=1'];
SHELL.push(...["./v63/data/maps-v63.json", "./v63/fonts/Tajawal-Bold.ttf", "./v63/icons/man_made_water_well.png", "./v63/icons/natural_cave_entrance.png", "./v63/icons/natural_spring.png", "./v63/icons/natural_volcano_map.png", "./v63/import-bundle.js", "./v63/map-v63.html", "./v63/profiles-v63.json", "./v63/v63-layers.js", "./v63/v63-layers.json", "./v63/vendor/maplibre-gl-shared.mjs", "./v63/vendor/maplibre-gl-worker.mjs", "./v63/vendor/maplibre-gl.css", "./v63/vendor/maplibre-gl.mjs", "./v63/vendor/pmtiles.js"]);

self.addEventListener('install',event=>{
  event.waitUntil(caches.open(SHELL_CACHE).then(cache=>cache.addAll(SHELL)).then(()=>self.skipWaiting()));
});

self.addEventListener('activate',event=>{
  // ذاكرة صور الخريطة القديمة (dalil-map-tiles-v1) لم تعد في القائمة فتُحذف من الأجهزة.
  const keep=new Set([SHELL_CACHE,OFFLINE_MAPS,'dalil-user-maps-v1']);  // خرائط المستخدم المستوردة
  event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>!keep.has(key)&&!/^dalil-v63-bundle-[a-z0-9-]+$/.test(key)).map(key=>caches.delete(key)))).then(()=>self.clients.claim()));
});

self.addEventListener('fetch',event=>{
  const request=event.request;
  if(request.method!=='GET') return;
  const url=new URL(request.url);
  if(url.origin!==self.location.origin) return;
  // الفيديو يُطلب بأجزاء (Range)؛ نتركه للمتصفح مباشرة حتى يعمل على Safari.
  if(url.pathname.endsWith('.mp4')) return;
  // ملفات الخرائط تُطلب بأجزاء (Range) وتحفظها map2.html بنفسها.
  if(url.pathname.endsWith('.pmtiles')) return;
  // حالة الفياض تتحدث أسبوعيًا: دايم من الشبكة
  if(url.pathname.endsWith('/data/fayd.json') || url.pathname.endsWith('/data/fq.json')) return;

  if(request.mode==='navigate'){
    // فتح فوري: إذا الصفحة محفوظة نعرضها مباشرة ونحدّثها في الخلفية (الشبكة الضعيفة ما تأخر فتح التطبيق).
    // أول مرة فقط (لا نسخة محفوظة) ننتظر الشبكة.
    const fromNet=fetch(request,{cache:'no-cache'}).then(response=>{
      if(response&&response.ok){const copy=response.clone();caches.open(SHELL_CACHE).then(cache=>cache.put(request,copy))}
      return response;
    });
    event.respondWith((async()=>{
      const cached=await caches.match(request,{ignoreSearch:true})||await caches.match(url.pathname.endsWith('map.html')?'./map.html':url.pathname.endsWith('map2.html')?'./map2.html':/\/(index\.html)?$/.test(url.pathname)?'./index.html':'__none__');
      if(cached){event.waitUntil(fromNet.catch(()=>{}));return cached}
      return fromNet.catch(()=>caches.match('./index.html'));
    })());
    return;
  }
  event.respondWith(caches.match(request,{ignoreSearch:true}).then(cached=>{
    if(cached) return cached;
    return fetch(request).then(response=>{
      if(response&&response.ok){
        const copy=response.clone();
        caches.open(SHELL_CACHE).then(cache=>cache.put(request,copy));
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
