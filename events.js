// «الأحداث»: معرض صور حيّ للمطر والسيول والربيع… مع تنبيهات الجوال.
// يُحمَّل عند الحاجة فقط، ولا يلمس البوصلة أو بيانات المستخدم المحفوظة.
(function(){
  'use strict';
  const B = window.DalilBridge;
  if(!B || window.DalilEvents) return;

  const SB = 'https://penhpgvjtxytgyrhmetg.supabase.co';
  const KEY = 'sb_publishable_WUbfRD9na71sHZ1rxFwImQ_JGzDOyXw';
  const VAPID = 'BGsDbPWMKyka54W4sadiQ-VGojUnqvMzC0Kg_EIdiSR6-LeX5G7iiGOXk3Sa0AAb4883sQDdA11aPVpiARfeol0';
  const FN = SB + '/functions/v1/';
  const PUB = SB + '/storage/v1/object/public/events/';
  const KINDS = [
    {id:'rain',   name:'مطر',       ico:'rain'},
    {id:'flood',  name:'سيل',       ico:'drop'},
    {id:'spring', name:'ربيع',      ico:'leaf'},
    {id:'dust',   name:'غبار',      ico:'dust'},
    {id:'road',   name:'حالة طريق', ico:'car'},
    {id:'other',  name:'أخرى',      ico:'camera'}
  ];
  const KIND = Object.fromEntries(KINDS.map(k=>[k.id, k]));
  const REGIONS = ['الرياض','مكة','المدينة','القصيم','الشرقية','عسير','تبوك','حائل','الحدود الشمالية','جازان','نجران','الباحة','الجوف'];
  const LS = {device:'dalil_device_id', nick:'dalil_nickname', seen:'dalil_events_seen', pushRegion:'dalil_push_region'};
  const esc = B.escapeHtml, ico = B.ico;
  const lsGet = k=>{ try{ return localStorage.getItem(k); }catch(e){ return null; } };
  const lsSet = (k, v)=>{ try{ localStorage.setItem(k, v); }catch(e){} };

  const st = {photoGps:null, events:[], loadedAt:0, loading:null, error:'', filter:'all', draft:null, sending:false, reported:new Set(), pendingOpen:null};
  const $ = id=>document.getElementById(id);

  function deviceId(){
    let id = lsGet(LS.device);
    if(!id){ id = (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2)); lsSet(LS.device, id); }
    return id;
  }
  function ago(iso){
    const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
    if(s < 60) return 'الآن';
    const m = Math.round(s / 60); if(m < 60) return 'قبل ' + m + ' د';
    const h = Math.round(m / 60); if(h < 24) return 'قبل ' + h + ' س';
    const d = Math.round(h / 24); return d === 1 ? 'أمس' : 'قبل ' + d + ' أيام';
  }
  function distText(e){
    const pos = B.getPos();
    if(!pos || e.lat == null || e.lng == null) return '';
    return B.fmtDist(B.haversine(pos.lat, pos.lng, e.lat, e.lng));
  }
  const kindBadge = k=>`<span class="ev-kind ev-k-${esc(k)}">${ico((KIND[k]||KIND.other).ico)}${esc((KIND[k]||KIND.other).name)}</span>`;

  // ---------- قراءة الأحداث ----------
  function fetchEvents(force){
    if(st.loading) return st.loading;
    if(!force && Date.now() - st.loadedAt < 60000) return Promise.resolve(st.events);
    const cols = 'id,created_at,expires_at,kind,caption,nickname,region,lat,lng,photo_path,thumb_path,width,height';
    st.loading = fetch(`${SB}/rest/v1/events?select=${cols}&order=created_at.desc&limit=120`, {headers:{apikey:KEY}, cache:'no-store'})
      .then(r=>{ if(!r.ok) throw new Error('http ' + r.status); return r.json(); })
      .then(list=>{ st.events = Array.isArray(list) ? list : []; st.loadedAt = Date.now(); st.error = ''; updateNewDot(); return st.events; })
      .catch(()=>{ st.error = navigator.onLine === false ? 'offline' : 'failed'; return st.events; })
      .finally(()=>{ st.loading = null; });
    return st.loading;
  }
  function newestAt(){ return st.events.length ? new Date(st.events[0].created_at).getTime() : 0; }
  function updateNewDot(){
    const seen = Number(lsGet(LS.seen) || 0);
    const hasNew = newestAt() > seen && !paneVisible();
    B.setEventsDot(hasNew);
  }
  function markSeen(){ if(newestAt()) lsSet(LS.seen, String(newestAt())); B.setEventsDot(false); }
  const paneVisible = ()=>{ const p = $('evPane'); return !!p && !p.hidden && $('screen-weather').classList.contains('active'); };

  // ---------- العرض ----------
  function render(){
    const pane = $('evPane'); if(!pane) return;
    const list = st.filter === 'all' ? st.events : st.events.filter(e=>e.kind === st.filter);
    const chips = [{id:'all', name:'الكل'}, ...KINDS].map(k=>
      `<button type="button" class="chip${st.filter === k.id ? ' active' : ''}" data-ev-filter="${k.id}">${esc(k.name)}</button>`).join('');
    let body;
    if(!st.loadedAt && st.loading) body = `<div class="ev-grid">${'<div class="ev-tile ev-skel"></div>'.repeat(4)}</div>`;
    else if(!st.events.length && st.error) body = `<div class="pl-empty"><span class="cp-ic">${ico('cloud')}</span><b>${st.error === 'offline' ? 'لا يوجد اتصال بالإنترنت' : 'تعذّر تحميل الأحداث'}</b><span>الأحداث تحتاج اتصالًا. باقي التطبيق يعمل بدونه.</span><button type="button" class="cp-btn cp-btn-white ev-retry" data-ev-act="reload">إعادة المحاولة</button></div>`;
    else if(!list.length) body = `<div class="pl-empty"><span class="cp-ic">${ico('camera')}</span><b>${st.filter === 'all' ? 'لا توجد أحداث في آخر 3 أيام' : 'لا توجد صور من هذا النوع الآن'}</b><span>شاهدت مطرًا أو سيلًا أو ربيعًا؟ كن أول من يشارك الصورة.</span></div>`;
    else body = `<div class="ev-grid">${list.map(tile).join('')}</div>`;
    pane.innerHTML = `
      <div class="ev-head">
        <button type="button" class="cp-btn cp-btn-gold ev-add" data-ev-act="compose">${ico('camera')}أضف حدثًا</button>
        <button type="button" class="cp-icon-btn" data-ev-act="reload" aria-label="تحديث">${ico('refresh')}</button>
      </div>
      ${pushBanner()}
      <div class="chips ev-chips">${chips}</div>
      ${body}
      ${B.adHtml ? B.adHtml('events') : ''}
      <p class="ev-note">الصور من المشتركين، تُراجع قبل نشرها وتُحذف تلقائيًا بعد 3 أيام. لا تصوّر وأنت تقود.</p>`;
    if(paneVisible()) markSeen();
  }
  function tile(e){
    const d = distText(e);
    const meta = [e.region, d].filter(Boolean).map(esc).join(' · ');
    return `<button type="button" class="ev-tile" data-ev-open="${esc(e.id)}" aria-label="${esc((KIND[e.kind]||KIND.other).name + ' ' + (e.caption || ''))}">
      <img src="${esc(PUB + e.thumb_path)}" alt="" loading="lazy" decoding="async">
      <span class="ev-tile-top">${kindBadge(e.kind)}<span class="ev-ago">${esc(ago(e.created_at))}</span></span>
      <span class="ev-tile-txt">${e.caption ? `<b>${esc(e.caption)}</b>` : ''}${meta ? `<small>${meta}</small>` : ''}</span>
    </button>`;
  }

  // ---------- عارض الصورة ----------
  function openViewer(id){
    const e = st.events.find(x=>x.id === id);
    if(!e){ B.toast('انتهت صلاحية هذه الصورة أو حُذفت'); return; }
    const v = $('evViewer');
    const d = distText(e);
    const hasLoc = e.lat != null && e.lng != null;
    v.innerHTML = `
      <div class="ev-v-bar">
        <button type="button" class="ev-v-close" data-ev-act="close" aria-label="إغلاق">✕</button>
        ${kindBadge(e.kind)}<span class="ev-ago">${esc(ago(e.created_at))}</span>
      </div>
      <div class="ev-v-img"><img src="${esc(PUB + e.photo_path)}" alt="${esc(e.caption || (KIND[e.kind]||KIND.other).name)}"></div>
      <div class="ev-v-info">
        ${e.caption ? `<p class="ev-v-cap">${esc(e.caption)}</p>` : ''}
        <p class="ev-v-meta">${[e.region, d ? 'يبعد ' + d : '', e.nickname ? 'بعدسة ' + e.nickname : ''].filter(Boolean).map(esc).join(' · ')}</p>
        ${hasLoc ? `<div class="ev-v-actions">
          <button type="button" class="cp-btn cp-btn-gold" data-ev-act="go" data-id="${esc(e.id)}">${ico('nav')}توجّه بالبوصلة</button>
          <button type="button" class="cp-btn cp-btn-white" data-ev-act="map" data-id="${esc(e.id)}">${ico('map')}على الخريطة</button>
        </div>` : '<p class="ev-v-meta">لم يُرفق المشترك موقع الصورة.</p>'}
        <button type="button" class="ev-report" data-ev-act="report" data-id="${esc(e.id)}"${st.reported.has(e.id) ? ' disabled' : ''}>${ico('flag')}${st.reported.has(e.id) ? 'تم الإبلاغ' : 'إبلاغ عن صورة غير مناسبة'}</button>
      </div>`;
    v.classList.add('show');
    v.setAttribute('aria-hidden', 'false');
  }
  function closeViewer(){ const v = $('evViewer'); v.classList.remove('show'); v.setAttribute('aria-hidden', 'true'); v.innerHTML = ''; }
  function eventPlace(e){
    const k = (KIND[e.kind]||KIND.other).name;
    return {id:'__event_' + e.id, name:k + (e.region ? ' — ' + e.region : '') + (e.caption ? ': ' + e.caption.slice(0, 40) : ''), icon:'📷', cat:'event', lat:e.lat, lng:e.lng, alt:null};
  }
  async function report(id){
    if(st.reported.has(id)) return;
    if(!confirm('الإبلاغ عن هذه الصورة؟ تُخفى تلقائيًا إذا أبلغ عنها أكثر من شخص.')) return;
    try{
      const r = await fetch(FN + 'dalil-public?a=report', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({id})});
      if(!r.ok && r.status !== 429) throw new Error();
      st.reported.add(id);
      B.toast('شكرًا، وصل البلاغ وسنراجعه');
      openViewer(id);
    }catch(e){ B.toast('تعذّر إرسال البلاغ، حاول لاحقًا'); }
  }

  // ---------- إضافة حدث ----------
  function openComposer(){
    const s = $('evSheet');
    st.draft = null; st.photoGps = null;
    $('evPhotoPreview').innerHTML = `<span class="cp-ic">${ico('camera')}</span><b>اختر صورة أو التقطها</b><small>تُصغَّر تلقائيًا قبل الرفع</small>`;
    $('evPhotoPreview').classList.remove('has');
    $('evCaption').value = '';
    $('evNick').value = lsGet(LS.nick) || '';
    $('evKinds').innerHTML = KINDS.map(k=>`<button type="button" class="chip" data-ev-kind="${k.id}">${esc(k.name)}</button>`).join('');
    const pos = B.getPos();
    // لا نُرفق أي موقع افتراضيًا: يُحدَّد بعد قراءة وقت التصوير من الصورة نفسها.
    $('evLocRow').hidden = true;
    $('evAttachLoc').checked = false;
    $('evRegion').innerHTML = '<option value="">اختر المنطقة</option>' + REGIONS.map(r=>`<option>${esc(r)}</option>`).join('');
    if(pos) B.nearestRegion(pos.lat, pos.lng).then(r=>{ if(r && !$('evRegion').value) $('evRegion').value = r; });
    setStatus('');
    updateSendBtn();
    s.classList.add('show');
  }
  function closeComposer(){ $('evSheet').classList.remove('show'); if(st.draft && st.draft.url) URL.revokeObjectURL(st.draft.url); st.draft = null; }
  function selectedKind(){ const c = document.querySelector('#evKinds .chip.active'); return c ? c.dataset.evKind : ''; }
  function updateSendBtn(){ $('evSend').disabled = st.sending || !st.draft || !selectedKind(); }
  function setStatus(t, err){ const el = $('evStatus'); el.textContent = t; el.classList.toggle('err', !!err); }

  function loadImage(file){
    return new Promise((resolve, reject)=>{
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = ()=>resolve({img, url});
      img.onerror = ()=>{ URL.revokeObjectURL(url); reject(new Error('decode')); };
      img.src = url;
    });
  }
  function toJpeg(img, maxSide, q){
    const w0 = img.naturalWidth, h0 = img.naturalHeight;
    const s = Math.min(1, maxSide / Math.max(w0, h0));
    const w = Math.max(1, Math.round(w0 * s)), h = Math.max(1, Math.round(h0 * s));
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const x = c.getContext('2d');
    x.fillStyle = '#fff'; x.fillRect(0, 0, w, h);
    x.drawImage(img, 0, 0, w, h);
    // إعادة الرسم على لوحة جديدة تحذف بيانات EXIF (الموقع الدقيق ونوع الجهاز) من الملف.
    return new Promise(res=>c.toBlob(b=>res({blob:b, w, h}), 'image/jpeg', q));
  }
  // قراءة وقت التصوير وموقعه (إن وُجد) من بيانات EXIF للصورة الأصلية، قبل حذفها.
  async function readExif(file){
    try{
      const buf = new DataView(await file.slice(0, 256 * 1024).arrayBuffer());
      if(buf.getUint16(0) !== 0xFFD8) return {};
      let off = 2;
      while(off + 4 < buf.byteLength){
        const marker = buf.getUint16(off), len = buf.getUint16(off + 2);
        if(marker === 0xFFE1 && buf.getUint32(off + 4) === 0x45786966){ // "Exif"
          const t = off + 10, le = buf.getUint16(t) === 0x4949;
          const u16 = o=>buf.getUint16(t + o, le), u32 = o=>buf.getUint32(t + o, le);
          const ifd = o=>{ const n = u16(o), m = {}; for(let i = 0; i < n; i++){ const e = o + 2 + i * 12; m[u16(e)] = {type:u16(e + 2), count:u32(e + 4), val:e + 8}; } return m; };
          const str = en=>{ const p = en.count > 4 ? u32(en.val) : en.val; let r = ''; for(let i = 0; i < en.count - 1; i++) r += String.fromCharCode(buf.getUint8(t + p + i)); return r; };
          const rats = en=>{ const p = u32(en.val), a = []; for(let i = 0; i < en.count; i++) a.push(u32(p + i * 8) / (u32(p + i * 8 + 4) || 1)); return a; };
          const out = {};
          const ifd0 = ifd(u32(4));
          if(ifd0[0x8769]){
            const ex = ifd(u32(ifd0[0x8769].val));
            const dt = ex[0x9003] || ex[0x9004];
            if(dt){ const m = str(dt).match(/^(\d{4}):(\d\d):(\d\d) (\d\d):(\d\d):(\d\d)/); if(m) out.taken = new Date(+m[1], m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime(); }
          }
          if(ifd0[0x8825]){
            const g = ifd(u32(ifd0[0x8825].val));
            if(g[2] && g[4]){
              const dms = a=>a[0] + a[1] / 60 + a[2] / 3600;
              let lat = dms(rats(g[2])), lng = dms(rats(g[4]));
              if(g[1] && str(g[1]) === 'S') lat = -lat;
              if(g[3] && str(g[3]) === 'W') lng = -lng;
              if(Number.isFinite(lat) && Number.isFinite(lng) && (lat || lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) out.gps = {lat, lng};
            }
          }
          return out;
        }
        if(marker === 0xFFDA || (marker & 0xFF00) !== 0xFF00) break;
        off += 2 + len;
      }
    }catch(e){}
    return {};
  }
  // يحدد موقع الحدث: موقع التصوير المخزّن في الصورة، أو موقعك الآن إن كانت الصورة ملتقطة للتو فقط.
  function decideLocation(exif){
    const pos = B.getPos(), row = $('evLocRow'), box = $('evAttachLoc'), txt = $('evLocText');
    const fresh = exif.taken && Math.abs(Date.now() - exif.taken) < 30 * 60e3;
    st.photoGps = exif.gps || null;
    if(exif.gps){
      row.hidden = false; box.checked = true;
      txt.textContent = 'إرفاق موقع التصوير المحفوظ في الصورة ليتمكن الآخرون من التوجّه إليه';
    }else if(pos){
      row.hidden = false; box.checked = !!fresh;
      txt.textContent = fresh
        ? 'التُقطت الآن — إرفاق موقعي الحالي ليتمكن الآخرون من التوجّه إليه'
        : 'الصورة من مكاني الحالي (فعّلها فقط إذا كنت في مكان الحدث الآن)';
    }else{
      row.hidden = true; box.checked = false;
    }
    const g = st.photoGps || pos;
    if(g) B.nearestRegion(g.lat, g.lng).then(r=>{ if(r) $('evRegion').value = r; });
  }
  async function preparePhoto(file){
    if(!file) return;
    if(!/^image\//.test(file.type || 'image/')){ setStatus('الملف ليس صورة', true); return; }
    setStatus('جارٍ تجهيز الصورة…');
    try{
      const exif = await readExif(file);
      const {img, url} = await loadImage(file);
      let full = await toJpeg(img, 1280, 0.72);
      if(full.blob && full.blob.size > 850 * 1024) full = await toJpeg(img, 1080, 0.6);
      const thumb = await toJpeg(img, 420, 0.7);
      URL.revokeObjectURL(url);
      if(!full.blob || !thumb.blob) throw new Error('encode');
      if(st.draft && st.draft.url) URL.revokeObjectURL(st.draft.url);
      st.draft = {photo:full.blob, thumb:thumb.blob, w:full.w, h:full.h, url:URL.createObjectURL(full.blob)};
      const p = $('evPhotoPreview');
      p.classList.add('has');
      p.innerHTML = `<img src="${st.draft.url}" alt="معاينة الصورة"><small>${Math.round(full.blob.size / 1024)} ك.ب · اضغط لتغييرها</small>`;
      decideLocation(exif);
      setStatus(selectedKind() ? '' : 'اختر نوع الحدث');
    }catch(e){
      st.draft = null;
      setStatus('تعذّر قراءة الصورة. جرّب صورة أخرى.', true);
    }
    updateSendBtn();
  }
  async function send(){
    if(st.sending || !st.draft || !selectedKind()) return;
    const pos = B.getPos();
    const fd = new FormData();
    fd.append('photo', st.draft.photo, 'photo.jpg');
    fd.append('thumb', st.draft.thumb, 'thumb.jpg');
    fd.append('kind', selectedKind());
    fd.append('caption', $('evCaption').value.trim().slice(0, 140));
    fd.append('region', $('evRegion').value);
    const nick = $('evNick').value.trim().slice(0, 24);
    lsSet(LS.nick, nick);
    fd.append('nickname', nick);
    fd.append('device', deviceId());
    fd.append('w', String(st.draft.w)); fd.append('h', String(st.draft.h));
    const loc = st.photoGps || pos;
    if(loc && $('evAttachLoc').checked && !$('evLocRow').hidden){ fd.append('lat', String(loc.lat)); fd.append('lng', String(loc.lng)); }
    st.sending = true; updateSendBtn(); setStatus('جارٍ الرفع…');
    try{
      const r = await fetch(FN + 'dalil-public?a=submit', {method:'POST', body:fd});
      const j = await r.json().catch(()=>({}));
      if(!r.ok){
        const msg = {rate_limited:'وصلت للحد اليومي للمشاركات. حاول غدًا.', too_large:'الصورة كبيرة جدًا.', bad_image:'صيغة الصورة غير مدعومة.', busy:'الخدمة مشغولة الآن، حاول بعد قليل.'}[j.error] || 'تعذّر الإرسال، حاول مرة أخرى.';
        setStatus(msg, true);
        return;
      }
      closeComposer();
      B.toast('شكرًا! ستظهر صورتك بعد مراجعتها');
    }catch(e){
      setStatus(navigator.onLine === false ? 'لا يوجد اتصال. أرسلها عندما تتوفر الشبكة.' : 'تعذّر الإرسال، حاول مرة أخرى.', true);
    }finally{
      st.sending = false; updateSendBtn();
    }
  }

  // ---------- التنبيهات ----------
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const standalone = ()=>window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const pushSupported = ()=>'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  function b64uToU8(s){ const b = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)); return Uint8Array.from(b, c=>c.charCodeAt(0)); }
  async function currentSub(){
    if(!pushSupported()) return null;
    try{ const reg = await navigator.serviceWorker.getRegistration(); return reg ? await reg.pushManager.getSubscription() : null; }catch(e){ return null; }
  }
  let pushOn = false;
  async function refreshPushState(){ pushOn = !!(await currentSub()) && Notification.permission === 'granted'; renderPushSettings(); }
  function pushBanner(){
    if(pushOn) return '';
    return `<div class="ev-push"><span class="cp-ic">${ico('bell')}</span><span><b>نبّهني عند السيول والأمطار</b><small>تصلك صور منطقتك فور نشرها</small></span><button type="button" class="cp-btn cp-btn-white" data-ev-act="push-settings">تفعيل</button></div>`;
  }
  function renderPushSettings(){
    const box = $('pushBox'); if(!box) return;
    const sel = $('pushRegion');
    if(sel && !sel.options.length){
      sel.innerHTML = '<option value="">كل المناطق</option>' + REGIONS.map(r=>`<option>${esc(r)}</option>`).join('');
      sel.value = lsGet(LS.pushRegion) || '';
    }
    const status = $('pushStatus'), btn = $('pushToggle');
    if(!pushSupported()){
      status.textContent = isIOS && !standalone()
        ? 'على الآيفون: افتح دليل في Safari ← زر المشاركة ← «إضافة إلى الشاشة الرئيسية»، ثم افتحه من الأيقونة وفعّل التنبيهات من هنا.'
        : 'هذا المتصفح لا يدعم التنبيهات.';
      btn.hidden = true; return;
    }
    btn.hidden = false;
    if(Notification.permission === 'denied'){
      status.textContent = 'التنبيهات مرفوضة. فعّلها من إعدادات الجوال ← دليل ← الإشعارات.';
      btn.hidden = true; return;
    }
    status.textContent = pushOn ? 'التنبيهات مفعّلة ✓ — تصلك أحداث ' + (sel.value || 'كل المناطق') + '.' : 'تصلك صور السيول والأمطار والإعلانات المهمة فور نشرها. لا نحفظ اسمك ولا رقمك.';
    btn.textContent = pushOn ? 'إيقاف التنبيهات' : 'تفعيل التنبيهات';
    btn.className = 'cp-btn ' + (pushOn ? 'cp-btn-white' : 'cp-btn-gold');
    const p = $('evPane'); if(p && !p.hidden) render();
  }
  async function postSub(sub, region){
    const j = sub.toJSON();
    const r = await fetch(FN + 'dalil-public?a=subscribe', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({endpoint:j.endpoint, keys:j.keys, region})});
    if(!r.ok) throw new Error('subscribe ' + r.status);
  }
  async function togglePush(){
    const btn = $('pushToggle'); btn.disabled = true;
    try{
      if(pushOn){
        const sub = await currentSub();
        if(sub){
          fetch(FN + 'dalil-public?a=unsubscribe', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({endpoint:sub.endpoint})}).catch(()=>{});
          await sub.unsubscribe();
        }
        B.toast('أُوقفت التنبيهات');
      }else{
        const perm = await Notification.requestPermission();
        if(perm !== 'granted'){ B.toast('لم يُسمح بالتنبيهات'); return; }
        const reg = await navigator.serviceWorker.ready;
        const sub = (await reg.pushManager.getSubscription()) || await reg.pushManager.subscribe({userVisibleOnly:true, applicationServerKey:b64uToU8(VAPID)});
        await postSub(sub, $('pushRegion').value);
        B.toast('تم تفعيل التنبيهات');
      }
    }catch(e){
      B.toast('تعذّر تغيير التنبيهات. تأكد من الاتصال وحاول مجددًا.');
    }finally{
      btn.disabled = false;
      await refreshPushState();
    }
  }
  async function regionChanged(){
    const region = $('pushRegion').value;
    lsSet(LS.pushRegion, region);
    const sub = await currentSub();
    if(sub && pushOn){ try{ await postSub(sub, region); B.toast('تم تحديث منطقة التنبيهات'); }catch(e){ B.toast('تعذّر تحديث المنطقة'); } }
    renderPushSettings();
  }

  // ---------- الأحداث العامة ----------
  document.addEventListener('click', ev=>{
    const t = ev.target.closest('[data-ev-act],[data-ev-open],[data-ev-filter],[data-ev-kind]');
    if(!t) return;
    if(t.dataset.evOpen){ openViewer(t.dataset.evOpen); return; }
    if(t.dataset.evFilter){ st.filter = t.dataset.evFilter; render(); return; }
    if(t.dataset.evKind){
      document.querySelectorAll('#evKinds .chip').forEach(c=>c.classList.toggle('active', c === t));
      if(st.draft) setStatus('');
      updateSendBtn(); return;
    }
    const e = st.events.find(x=>x.id === t.dataset.id);
    switch(t.dataset.evAct){
      case 'compose': openComposer(); break;
      case 'reload': fetchEvents(true).then(render); render(); break;
      case 'close': closeViewer(); break;
      case 'go': if(e){ closeViewer(); B.navigateTo(eventPlace(e)); } break;
      case 'map': if(e){ closeViewer(); B.openOnMap(eventPlace(e)); } break;
      case 'report': report(t.dataset.id); break;
      case 'push-settings': B.openSettings('pushBox'); break;
    }
  });
  $('evPhotoInput').addEventListener('change', e=>{ preparePhoto(e.target.files && e.target.files[0]); e.target.value = ''; });
  $('evPhotoPreview').addEventListener('click', ()=>$('evPhotoInput').click());
  $('evSend').addEventListener('click', send);
  $('evCancel').addEventListener('click', closeComposer);
  $('evSheet').addEventListener('click', e=>{ if(e.target === $('evSheet')) closeComposer(); });
  $('evViewer').addEventListener('click', e=>{ if(e.target === $('evViewer') || e.target.classList.contains('ev-v-img')) closeViewer(); });
  document.addEventListener('keydown', e=>{ if(e.key === 'Escape' && $('evViewer').classList.contains('show')) closeViewer(); });
  $('pushToggle').addEventListener('click', togglePush);
  $('pushRegion').addEventListener('change', regionChanged);

  let timer = 0;
  window.DalilEvents = {
    show(openId){
      if(openId) st.pendingOpen = openId;
      render();
      if(B.loadAds) B.loadAds().then(()=>{ if(paneVisible()) render(); });
      fetchEvents(false).then(()=>{
        render();
        if(st.pendingOpen){ const id = st.pendingOpen; st.pendingOpen = null; openViewer(id); }
      });
      clearInterval(timer);
      timer = setInterval(()=>{ if(paneVisible() && document.visibilityState === 'visible') fetchEvents(true).then(render); }, 120000);
    },
    hide(){ clearInterval(timer); },
    checkNew(){ return fetchEvents(false); },
    settings(){ refreshPushState(); }
  };
  refreshPushState();
})();
