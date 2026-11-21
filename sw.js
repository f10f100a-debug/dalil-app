const SHELL_CACHE='dalil-shell-v435';
const LIVE_DATA='dalil-live-data-v1'; // 17 نوفمبر: آخر نسخة من الفياض والفقع ومطر الأسبوع (تشتغل بالبر بدون نت)
const OFFLINE_MAPS='dalil-offline-maps-v1'; // خرائط PMTiles المحفوظة من map2.html (تُدار من الصفحة نفسها)
const SHELL=['./','./index.html','./map.html','./map2.html','./vendor/maplibre-gl-csp.js','./vendor/maplibre-gl-csp-worker.js','./vendor/maplibre-gl.css','./vendor/pmtiles.js','./vendor/mapbox-gl-rtl-text.js','./data/maps.json','./vendor/glyphs/Noto%20Sans%20Regular/0-255.pbf','./vendor/glyphs/Dalil%20Kufi%20Bold/0-255.pbf','./vendor/glyphs/Dalil%20Kufi%20Bold/256-511.pbf','./vendor/glyphs/Dalil%20Kufi%20Bold/1536-1791.pbf','./vendor/glyphs/Dalil%20Kufi%20Bold/1792-2047.pbf','./vendor/glyphs/Dalil%20Kufi%20Bold/8192-8447.pbf','./vendor/glyphs/Dalil%20Kufi%20Bold/9472-9727.pbf','./vendor/glyphs/Dalil%20Kufi%20Bold/64256-64511.pbf','./vendor/glyphs/Dalil%20Kufi%20Bold/65024-65279.pbf','./vendor/glyphs/Noto%20Sans%20Regular/1536-1791.pbf','./vendor/glyphs/Noto%20Sans%20Regular/1792-2047.pbf','./vendor/glyphs/Noto%20Sans%20Regular/256-511.pbf','./vendor/glyphs/Noto%20Sans%20Regular/64256-64511.pbf','./vendor/glyphs/Noto%20Sans%20Regular/65024-65279.pbf','./vendor/glyphs/Noto%20Sans%20Regular/8192-8447.pbf','./vendor/glyphs/Noto%20Sans%20Regular/9472-9727.pbf','./manifest.webmanifest','./assets/icon-192.png','./data/open-places.json','./data/wadis.json','./events.js?v=29','./assets/sounds/event.m4a','./assets/sounds/rain.m4a',
  './room.js?v=37','./privacy.html','./support.html','./mapimport.js','./vendor/sql-wasm.js','./vendor/sql-wasm.wasm','./vendor/geotiff.js','./data/region-grid.json?v=1','./fonts/Tajawal-Regular.ttf','./fonts/Tajawal-Medium.ttf','./fonts/Tajawal-Bold.ttf','./fonts/Tajawal-ExtraBold.ttf','./fonts/Tajawal-Black.ttf'];
SHELL.push(...["./v63/data/maps-v63.json", "./v63/fonts/Tajawal-Bold.ttf", "./v63/icons/man_made_water_well.png", "./v63/icons/natural_cave_entrance.png", "./v63/icons/natural_spring.png", "./v63/icons/natural_volcano_map.png", "./v63/import-bundle.js", "./v63/map-v63.html", "./v63/profiles-v63.json", "./v63/v63-layers.js", "./v63/v63-layers.json", "./v63/vendor/maplibre-gl-shared.mjs", "./v63/vendor/maplibre-gl-worker.mjs", "./v63/vendor/maplibre-gl.css", "./v63/vendor/maplibre-gl.mjs", "./v63/vendor/pmtiles.js"]);

self.addEventListener('install',event=>{
  event.waitUntil(caches.open(SHELL_CACHE).then(cache=>cache.addAll(SHELL.map(u=>new Request(u,{cache:'reload'})))).then(()=>self.skipWaiting()));
});

self.addEventListener('activate',event=>{
  // ذاكرة صور الخريطة القديمة (dalil-map-tiles-v1) لم تعد في القائمة فتُحذف من الأجهزة.
  const keep=new Set([SHELL_CACHE,OFFLINE_MAPS,'dalil-user-maps-v1',LIVE_DATA]);  // خرائط المستخدم المستوردة
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
  // الفياض والفقع ومطر الأسبوع: من الشبكة أول (أحدث نسخة)، ونحفظها؛ بدون نت أو شبكة ضعيفة (8 ث) → آخر نسخة محفوظة
  if(url.pathname.endsWith('/data/fayd.json') || url.pathname.endsWith('/data/fq.json') || url.pathname.endsWith('/data/rain-week.json')){
    const key=url.origin+url.pathname;
    event.respondWith((async()=>{
      const cache=await caches.open(LIVE_DATA);
      const net=fetch(request).then(r=>{ if(r&&r.ok) cache.put(key,r.clone()); return r; });
      const timeout=new Promise(res=>setTimeout(()=>res(null),8000));
      try{ const r=await Promise.race([net,timeout]); if(r&&r.ok) return r; }catch(e){}
      const old=await cache.match(key);
      if(old) return old;
      try{ return await net; }catch(e){ return new Response('null',{status:503,headers:{'content-type':'application/json'}}); }
    })());
    return;
  }

  if(request.mode==='navigate'){
    // فتح فوري: إذا الصفحة محفوظة نعرضها مباشرة ونحدّثها في الخلفية (الشبكة الضعيفة ما تأخر فتح التطبيق).
    // أول مرة فقط (لا نسخة محفوظة) ننتظر الشبكة.
    const fromNet=fetch(request,{cache:'no-cache'}).then(response=>{
      if(response&&response.ok){const copy=response.clone();caches.open(SHELL_CACHE).then(cache=>cache.put(new Request(url.origin+url.pathname),copy))}
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
  const url=typeof d.url==='string'?d.url:'./';
  // نوع الطنّة: مطر (يفتح الرادار) أو حدث
  const kind=/screen=track/.test(url)?'rain':/^event-/.test(d.tag||'')?'event':'';
  event.waitUntil(self.clients.matchAll({type:'window',includeUncontrolled:true}).then(list=>{
    // الصفحة مفتوحة قدامه: نطلب طنّة دليل منها ونخلي التنبيه بدون صوت الجوال (عشان ما يتكرر الصوت)
    const open=kind&&!d.silent?list.filter(c=>c.visibilityState==='visible'):[];
    open.forEach(c=>c.postMessage({type:'dalil-tone',kind}));
    return self.registration.showNotification(title,{
      body:String(d.body||'').slice(0,200),
      tag:d.tag||undefined,
      lang:'ar', dir:'rtl',
      silent:!!d.silent||open.length>0,   // ساعات الهدوء (12 الليل–6 الصبح): التنبيه يوصل بدون صوت
      data:{url}
    });
  }));
});

self.addEventListener('notificationclick',event=>{
  event.notification.close();
  // نفتح روابط التطبيق نفسه فقط.
  let target=new URL('./',self.registration.scope).href;
  try{
    const u=new URL(event.notification.data&&event.notification.data.url||'./',self.registration.scope);
    if(u.origin===self.location.origin&&u.pathname.startsWith(new URL(self.registration.scope).pathname)){
      // تنبيه مطر: نمرّر نصه للصفحة عشان يطلع فوق الخريطة (قبل كان يختفي بعد الضغط)
      if(/screen=track/.test(u.search)){u.searchParams.set('alert','1');u.searchParams.set('nt',(event.notification.title||'').slice(0,200));u.searchParams.set('nb',(event.notification.body||'').slice(0,400))}
      target=u.href}
  }catch(e){}
  event.waitUntil(self.clients.matchAll({type:'window',includeUncontrolled:true}).then(list=>{
    for(const c of list){ if('navigate' in c){ return c.navigate(target).then(w=>(w||c).focus()); } }
    return self.clients.openWindow(target);
  }));
});
