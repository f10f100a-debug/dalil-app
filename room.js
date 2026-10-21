// «غرفة الرحلة»: قناة صوتية بالضغط للتحدث + مواقع الأعضاء على الخريطة والبوصلة.
// المواقع تنتقل مباشرة بين الأعضاء (Realtime Broadcast) ولا تُخزَّن. الصوت يُحذف بعد ساعة. الغرفة تنتهي بعد 24 ساعة.
(function(){
  'use strict';
  const B = window.DalilBridge;
  if(!B || window.DalilRoom) return;

  const SB = 'https://penhpgvjtxytgyrhmetg.supabase.co';
  const KEY = 'sb_publishable_WUbfRD9na71sHZ1rxFwImQ_JGzDOyXw';
  const FN = SB + '/functions/v1/dalil-rooms';
  const WS = 'wss://penhpgvjtxytgyrhmetg.supabase.co/realtime/v1/websocket?apikey=' + KEY + '&vsn=1.0.0';
  const APP_LINK = 'https://apps.apple.com/sa/app/id6822651903';
  const WEB_LINK = 'https://f10f100a-debug.github.io/dalil-app/';
  const LS = {sess:'dalil_room_v1', name:'dalil_room_name', terms:'dalil_room_terms_v1'};
  const LAG_M = 3000, LAG_RESET_M = 2500, STALE_MS = 3 * 60e3, MAX_REC_S = 30;
  const $ = id=>document.getElementById(id);
  const esc = B.escapeHtml, ico = B.ico;
  const lsGet = k=>{ try{ return localStorage.getItem(k); }catch(e){ return null; } };
  const lsSet = (k, v)=>{ try{ v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); }catch(e){} };
  const ERR = {
    wrong_code:'رقم الغرفة أو الرمز السري غير صحيح', expired:'انتهت مدة الغرفة (24 ساعة)', full:'الغرفة ممتلئة (15 عضوًا)',
    rate_limited:'محاولات كثيرة، انتظر قليلًا ثم حاول', bad_pin:'الرمز السري من 4 إلى 8 أرقام', name_required:'اكتب اسمك أولًا',
    kicked:'أُخرجت من الغرفة بتصويت الأعضاء', not_member:'لم تعد عضوًا في هذه الغرفة', bad_code:'تأكد من رقم الغرفة (6 أرقام) والرمز السري',
    bad_audio:'تعذّر إرسال التسجيل', banned:'تم إيقاف استخدامك لغرف الرحلة بسبب مخالفة الشروط', too_large:'التسجيل طويل جدًا', server:'تعذّر الاتصال بالخادم، حاول مرة أخرى', net:'لا يوجد اتصال بالإنترنت'
  };
  const errText = e=>ERR[e] || ERR.server;

  // ---------- الحالة ----------
  const R = {
    sess:null,           // {room_id, member_id, token, code, pin, name}
    room:null,           // آخر رد من الخادم
    members:new Map(),   // member_id -> {name, color}
    pos:new Map(),       // member_id -> {lat,lng,acc,spd,t}
    voice:[], heard:new Set(), muted:new Set(),
    lagging:new Set(), sos:new Map(), mySos:null,
    navObj:null, open:false, tab:'join'
  };
  function loadSess(){ try{ const s = JSON.parse(lsGet(LS.sess) || 'null'); return s && s.room_id && s.token ? s : null; }catch(e){ return null; } }
  function saveSess(){ lsSet(LS.sess, R.sess ? JSON.stringify({...R.sess, muted:[...R.muted]}) : null); }
  const me = ()=>R.sess && R.sess.member_id;
  const authBody = (extra)=>({room_id:R.sess.room_id, member_id:R.sess.member_id, token:R.sess.token, ...(extra || {})});

  async function api(a, body){
    let r;
    try{
      r = await fetch(FN + '?a=' + a, {method:'POST', headers:{apikey:KEY, 'content-type':'application/json'}, body:JSON.stringify(body || {})});
    }catch(e){ return {ok:false, error:'net'}; }
    const j = await r.json().catch(()=>({}));
    return r.ok ? j : {...j, ok:false, error:j.error || 'server', status:r.status};
  }

  // ---------- الاتصال اللحظي (Phoenix websocket) ----------
  const RT = {
    ws:null, topic:null, ref:0, joinRef:null, joined:false, hb:null, retry:0, timer:null,
    connect(secret){
      const topic = 'realtime:room:' + secret;
      if(this.topic === topic && this.ws && this.ws.readyState <= 1) return;
      this.stop(); this.topic = topic; this.open();
    },
    open(){
      if(!this.topic) return;
      clearTimeout(this.timer);
      let ws;
      try{ ws = new WebSocket(WS); }catch(e){ return this.later(); }
      this.ws = ws; this.joined = false;
      ws.onopen = ()=>{
        this.joinRef = String(++this.ref);
        this.raw({topic:this.topic, event:'phx_join', ref:this.joinRef, join_ref:this.joinRef,
          payload:{config:{broadcast:{self:false, ack:false}, presence:{key:'', enabled:false}, postgres_changes:[], private:false}}});
        clearInterval(this.hb);
        this.hb = setInterval(()=>this.raw({topic:'phoenix', event:'heartbeat', payload:{}, ref:String(++this.ref)}), 25000);
      };
      ws.onmessage = ev=>{
        let m; try{ m = JSON.parse(ev.data); }catch(e){ return; }
        if(m.topic !== this.topic) return;
        if(m.event === 'phx_reply' && m.ref === this.joinRef){
          if(m.payload && m.payload.status === 'ok'){ this.joined = true; this.retry = 0; onLive(); }
          return;
        }
        if(m.event === 'broadcast' && m.payload) onBroadcast(m.payload.event, m.payload.payload || {});
        if(m.event === 'phx_error' || m.event === 'phx_close'){ try{ ws.close(); }catch(e){} }
      };
      ws.onclose = ()=>{ if(this.ws === ws){ this.joined = false; clearInterval(this.hb); renderStatus(); this.later(); } };
      ws.onerror = ()=>{};
    },
    later(){
      if(!this.topic) return;
      clearTimeout(this.timer);
      const wait = Math.min(30000, 1000 * 2 ** Math.min(this.retry++, 5));
      this.timer = setTimeout(()=>{ if(document.visibilityState === 'visible' || this.retry < 3) this.open(); }, wait);
    },
    raw(obj){ try{ if(this.ws && this.ws.readyState === 1){ this.ws.send(JSON.stringify(obj)); return true; } }catch(e){} return false; },
    send(event, payload){
      if(!this.joined) return false;
      return this.raw({topic:this.topic, event:'broadcast', ref:String(++this.ref), join_ref:this.joinRef,
        payload:{type:'broadcast', event, payload:{...payload, m:me()}}});
    },
    stop(){
      const ws = this.ws; this.topic = null; this.ws = null; this.joined = false;
      clearInterval(this.hb); clearTimeout(this.timer);
      if(ws){ try{ ws.close(); }catch(e){} }
    }
  };

  function onLive(){
    renderStatus();
    RT.send('hello', myPosPayload() || {});
    lastSent = null; tickPos();
  }

  function onBroadcast(ev, p){
    if(!R.sess || !p || p.m === me()) return;
    const id = String(p.m || '');
    switch(ev){
      case 'pos': setPos(id, p); break;
      case 'hello':
        if(Number.isFinite(p.lat)) setPos(id, p);
        if(!R.members.has(id)) refreshState();
        clearTimeout(helloReply); helloReply = setTimeout(()=>{ const mp = myPosPayload(); if(mp) RT.send('pos', mp); }, 300 + Math.random() * 1500);
        break;
      case 'voice': if(p.v && p.v.url) addVoice(p.v, true); break;
      case 'voice_live':
        if(p.id && typeof p.b64 === 'string' && p.b64.length < 160000 && /^audio\//.test(p.mime || '')){
          try{
            const bin = atob(p.b64), u8 = new Uint8Array(bin.length); for(let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
            addVoice({id:String(p.id), member_id:id, mime:p.mime, duration:Number(p.duration) || null, created_at:new Date().toISOString(), url:URL.createObjectURL(new Blob([u8], {type:p.mime}))}, true);
          }catch(e){}
        }
        break;
      case 'rally':
        R.rally = p.rally || null;
        if(p.rally) B.toast('📍 ' + (p.rally.by || 'أحد الأعضاء') + ' حدد نقطة التجمع');
        render(); syncMap();
        break;
      case 'sos': onSos(id, p); break;
      case 'sos_off': R.sos.delete(id); renderSos(); break;
      case 'join': case 'leave': case 'rekey': refreshState(); break;
    }
  }
  let helloReply = null;

  // ---------- المواقع ----------
  function myPosPayload(){
    const p = B.getPos();
    if(!p || !Number.isFinite(p.lat)) return null;
    return {lat:+p.lat.toFixed(6), lng:+p.lng.toFixed(6), acc:Number.isFinite(p.accuracy) ? Math.round(p.accuracy) : null,
      spd:Number.isFinite(p.speed) && p.speed >= 0 ? +p.speed.toFixed(1) : null, car:myCar()};
  }
  // موقع السيارة المحفوظ يُرسل مع الموقع لأعضاء الغرفة فقط (لا يُخزَّن في الخادم)
  // تطبيق الآيفون 1.3: بيانات العضوية لإرسال الموقع من الخلفية
  function bgAuth(){ return R.sess ? {url:FN + '?a=bgpos', key:KEY, room_id:R.sess.room_id, member_id:R.sess.member_id, token:R.sess.token, name:(R.room && R.room.name) || '', me:R.sess.name || ''} : null; }
  const bgSync = ()=>{ try{ window.__dalilBgSync && window.__dalilBgSync(); }catch(e){} };
  function myCar(){ try{ const c = B.getCar && B.getCar(); return c && Number.isFinite(c.lat) ? {lat:+c.lat.toFixed(6), lng:+c.lng.toFixed(6)} : null; }catch(e){ return null; } }
  let lastSent = null, posTimer = null;
  function tickPos(){
    if(!R.sess) return;
    const mp = myPosPayload();
    if(!mp) return;
    const now = Date.now();
    const moved = lastSent ? B.haversine(lastSent.lat, lastSent.lng, mp.lat, mp.lng) : Infinity;
    const carKey = mp.car ? mp.car.lat + ',' + mp.car.lng : '';
    if(!lastSent || moved > 15 || now - lastSent.t > 20000 || carKey !== lastSent.carKey){
      if(RT.send('pos', mp)) lastSent = {...mp, t:now, carKey};
    }
    checkLag();
    if(R.open) renderMembersSoon();
  }
  function setPos(id, p){
    if(!(Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180)) return;
    const car = p.car && Math.abs(p.car.lat) <= 90 && Math.abs(p.car.lng) <= 180 ? {lat:+p.car.lat, lng:+p.car.lng} : (p.bg ? (R.pos.get(id) || {}).car || null : null);
    R.pos.set(id, {lat:+p.lat, lng:+p.lng, acc:p.acc, spd:p.spd, car, t:Date.now()});
    if(R.navObj && R.navObj._car === id && car){ R.navObj.lat = car.lat; R.navObj.lng = car.lng; }
    if(R.navObj && R.navObj._member === id){ R.navObj.lat = +p.lat; R.navObj.lng = +p.lng; }
    checkLag(); renderMembersSoon(); syncMapSoon();
  }
  function distTo(id){
    const a = B.getPos(), b = R.pos.get(id);
    if(!a || !b) return null;
    return B.haversine(a.lat, a.lng, b.lat, b.lng);
  }
  // تنبيه القافلة: عضو ابتعد أكثر من 3 كم عنك (بموقع حديث)
  function checkLag(){
    for(const [id, m] of R.members){
      if(id === me()) continue;
      const p = R.pos.get(id), d = distTo(id);
      if(!p || d == null || Date.now() - p.t > STALE_MS) continue;
      if(d > LAG_M && !R.lagging.has(id)){
        R.lagging.add(id);
        B.toast('⚠️ ' + m.name + ' ابتعد عن القافلة — ' + B.fmtDist(d));
        if(navigator.vibrate) navigator.vibrate([120, 80, 120]);
      }else if(d < LAG_RESET_M) R.lagging.delete(id);
    }
  }

  // ---------- حالة الغرفة من الخادم ----------
  let stateBusy = null, stateTimer = null;
  function refreshState(){
    if(!R.sess) return Promise.resolve();
    if(stateBusy) return stateBusy;
    stateBusy = api('state', authBody()).then(j=>{
      stateBusy = null;
      if(!j.ok){
        if(['kicked', 'not_member', 'expired'].includes(j.error)) return endRoom(errText(j.error));
        return;
      }
      applyRoom(j);
    });
    return stateBusy;
  }
  function applyRoom(j){
    R.room = j; R.rally = j.rally || null;
    R.members = new Map((j.members || []).map(m=>[m.member_id, m]));
    for(const id of [...R.pos.keys()]) if(!R.members.has(id)) R.pos.delete(id);
    (j.voice || []).forEach(v=>addVoice(v, false));
    RT.connect(j.secret);
    render(); syncMap(); updateBtn();
  }

  // ---------- الدخول والإنشاء ----------
  // تطبيق الآيفون 1.2+: نسجّل رمز التنبيهات مع العضوية حتى تصله الاستغاثة والرسائل والتطبيق مغلق
  async function roomPush(){
    if(!R.sess || !window.DALIL_NATIVE_PUSH || !window.Capacitor) return;
    try{
      const C = window.Capacitor, PN = (C.Plugins && C.Plugins.PushNotifications) || C.registerPlugin('PushNotifications');
      let tok = null; try{ tok = localStorage.getItem('dalil_apns_token'); }catch(e){}
      if(!tok){
        let perm = await PN.checkPermissions();
        if(perm.receive === 'prompt' || perm.receive === 'prompt-with-rationale') perm = await PN.requestPermissions();
        if(perm.receive !== 'granted') return;
        tok = await new Promise((res, rej)=>{ let h1, h2; const end = (f, v)=>{ h1 && h1.remove(); h2 && h2.remove(); f(v); };
          PN.addListener('registration', t=>end(res, String(t.value || '').toLowerCase())).then(h=>h1 = h);
          PN.addListener('registrationError', e=>end(rej, e)).then(h=>h2 = h);
          setTimeout(()=>end(rej, 'timeout'), 15000); PN.register(); });
      }
      if(tok && R.sess) await api('push', authBody({push_token:tok}));
    }catch(e){}
  }
  async function enter(kind){
    const name = $('rmName').value.trim(), pin = $('rmPin').value.trim();
    const code = kind === 'join' ? $('rmCode').value.replace(/\D/g, '') : '';
    if(!name) return formErr(ERR.name_required, 'rmName');
    if(kind === 'join' && code.length !== 6) return formErr('رقم الغرفة 6 أرقام', 'rmCode');
    if(!/^[0-9]{4,8}$/.test(pin)) return formErr(ERR.bad_pin, 'rmPin');
    if(!$('rmTerms').checked) return formErr('وافق على شروط الاستخدام أولًا', 'rmTerms');
    lsSet(LS.name, name); lsSet(LS.terms, '1');
    const btn = $('rmGo'); btn.disabled = true; btn.textContent = 'جارٍ الاتصال…';
    const j = kind === 'join'
      ? await api('join', {code, pin, member_name:name})
      : await api('create', {pin, member_name:name, name:$('rmTrip').value.trim()});
    btn.disabled = false; renderLobbyBtn();
    if(!j.ok) return formErr(errText(j.error));
    R.sess = {room_id:j.room_id, member_id:j.me.member_id, token:j.token, code:j.code, pin, name};
    R.muted = new Set(); R.voice = []; R.heard = new Set(); R.pos.clear(); R.lagging.clear();
    (j.voice || []).forEach(v=>R.heard.add(v.id));   // لا نشغّل القديم تلقائيًا
    saveSess(); B.startGeo && B.startGeo(); bgSync();
    setTimeout(roomPush, 1500);
    applyRoom(j);
    setTimeout(()=>RT.send('join', {}), 1200);
    startLoops();
    if(kind === 'create') shareRoom();
  }
  function formErr(msg, focusId){
    const e = $('rmErr'); e.textContent = msg; e.hidden = false;
    if(focusId && $(focusId)) $(focusId).focus();
  }
  async function leave(){
    if(!R.sess) return;
    if(!confirm('تغادر غرفة الرحلة؟ لن يرى الأعضاء موقعك بعد الآن.')) return;
    RT.send('leave', {});
    api('leave', authBody());
    endRoom('غادرت الغرفة');
  }
  function endRoom(msg){
    if(R.mySos) stopMySos(true);
    RT.stop(); stopLoops();
    R.sess = null; R.room = null; R.members.clear(); R.pos.clear(); R.voice = []; R.sos.clear(); R.rally = null;
    if(R.navObj) R.navObj = null;
    saveSess(); syncMap(); updateBtn(); renderSos(); bgSync();
    if(msg) B.toast(msg);
    render();
  }

  function shareRoom(){
    if(!R.sess) return;
    const nm = R.room && R.room.name ? ' «' + R.room.name + '»' : '';
    // الرابط أولًا حتى يعرضه واتساب بطاقة كبيرة قابلة للضغط («تعال انضم لنا في غرفة الرحلة»)
    const text = WEB_LINK + '?room=' + R.sess.code + '&pin=' + encodeURIComponent(R.sess.pin) + '\n\n'
      + 'يا هلا 👋 تعال انضم لنا في غرفة الرحلة' + nm + ' على تطبيق دليل 🏕️\n'
      + 'اضغط البطاقة فوق وتدخل معنا على طول\n'
      + '(رقم الغرفة ' + R.sess.code + ' · الرمز ' + R.sess.pin + ')';
    if(navigator.share){ navigator.share({text}).catch(()=>{}); return; }
    (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject()).then(()=>B.toast('تم نسخ بيانات الغرفة'), ()=>{
      window.location.href = 'https://wa.me/?text=' + encodeURIComponent(text);
    });
  }

  // ---------- الصوت: تسجيل بالضغط المطوّل ----------
  const player = new Audio();
  player.preload = 'auto';
  let unlocked = false, queue = [], playing = null;
  function unlockAudio(){
    audioCtx();
    if(unlocked) return; unlocked = true;
    // ملف صامت قصير لفتح تشغيل الصوت بعد أول لمسة (قيود iOS)
    const n = 800, buf = new ArrayBuffer(44 + n), v = new DataView(buf), w = (o, s)=>{ for(let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    w(0, 'RIFF'); v.setUint32(4, 36 + n, true); w(8, 'WAVEfmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, 8000, true); v.setUint32(28, 8000, true); v.setUint16(32, 1, true); v.setUint16(34, 8, true); w(36, 'data'); v.setUint32(40, n, true);
    for(let i = 0; i < n; i++) v.setUint8(44 + i, 128);
    player.src = URL.createObjectURL(new Blob([buf], {type:'audio/wav'}));
    player.play().catch(()=>{});
  }
  function addVoice(v, live){
    if(!v || !v.id || R.voice.some(x=>x.id === v.id)) return;
    R.voice.push(v);
    R.voice.sort((a, b)=>new Date(a.created_at) - new Date(b.created_at));
    if(R.voice.length > 60) R.voice.splice(0, R.voice.length - 60);
    if(v.member_id === me()) R.heard.add(v.id);
    else if(live && !R.muted.has(v.member_id)){ queue.push(v); playNext(); }
    renderVoiceSoon(); updateBtn();
  }
  function playNext(){
    if(playing || rec.on || !queue.length) return;
    const v = queue.shift();
    if(R.muted.has(v.member_id) || !v.url) return playNext();
    playClip(v);
  }
  function playClip(v, noTone){
    playing = v; R.heard.add(v.id);
    player.src = v.url;
    const wait = noTone ? 0 : tone('in');
    (wait ? new Promise(res=>setTimeout(res, wait)) : Promise.resolve()).then(()=>player.play()).then(()=>{ renderVoiceSoon(); }, ()=>{ playing = null; renderVoiceSoon(); if(R.open) B.toast('اضغط ▶ لتشغيل رسالة ' + memberName(v.member_id)); });
    renderVoiceSoon(); updateBtn();
  }
  player.addEventListener('ended', ()=>{ playing = null; renderVoiceSoon(); playNext(); });
  player.addEventListener('error', ()=>{ if(playing){ playing = null; renderVoiceSoon(); playNext(); } });

  const rec = {on:false, stream:null, mr:null, chunks:[], t0:0, timer:null, idle:null, cancelled:false};
  function pickMime(){
    if(!window.MediaRecorder) return null;
    const c = ['audio/mp4', 'audio/aac', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'];
    return c.find(t=>MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(t)) || '';
  }
  async function recStart(){
    if(rec.on || !R.sess) return;
    unlockAudio();
    const mime = pickMime();
    if(mime === null) return B.toast('جهازك لا يدعم التسجيل الصوتي');
    rec.on = true; rec.cancelled = false; player.pause(); playing = null;
    renderPtt('wait');
    try{
      if(!rec.stream || !rec.stream.active) rec.stream = await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true, noiseSuppression:true, autoGainControl:true}});
    }catch(e){
      rec.on = false; renderPtt();
      return B.toast(window.DALIL_NATIVE ? 'اسمح لدليل باستخدام الميكروفون: الإعدادات ← دليل ← الميكروفون' : 'اسمح باستخدام الميكروفون لإرسال الصوت');
    }
    if(!rec.on){ releaseMicLater(); return; }   // رفع الإصبع قبل جاهزية الميكروفون
    clearTimeout(rec.idle);
    rec.chunks = [];
    const tw = tone('start'); if(tw) await new Promise(res=>setTimeout(res, tw + 40));
    if(!rec.on){ releaseMicLater(); renderPtt(); return; }
    try{ rec.mr = mime ? new MediaRecorder(rec.stream, {mimeType:mime, audioBitsPerSecond:24000}) : new MediaRecorder(rec.stream); }
    catch(e){ rec.mr = new MediaRecorder(rec.stream); }
    rec.mr.ondataavailable = e=>{ if(e.data && e.data.size) rec.chunks.push(e.data); };
    rec.mr.onstop = onRecStop;
    rec.mr.start();
    rec.t0 = Date.now();
    if(navigator.vibrate) navigator.vibrate(30);
    renderPtt('rec');
    rec.timer = setInterval(()=>{
      const s = (Date.now() - rec.t0) / 1000;
      const el = $('rmPttTime'); if(el) el.textContent = Math.floor(s) + 'ث';
      if(s >= MAX_REC_S) recStop();
    }, 250);
  }
  function recStop(cancel){
    if(!rec.on) return;
    rec.on = false; rec.cancelled = !!cancel;
    clearInterval(rec.timer);
    if(rec.mr && rec.mr.state !== 'inactive') rec.mr.stop();
    else renderPtt();
  }
  async function onRecStop(){
    const dur = (Date.now() - rec.t0) / 1000, type = (rec.mr && rec.mr.mimeType) || (rec.chunks[0] && rec.chunks[0].type) || 'audio/mp4';
    const blob = new Blob(rec.chunks, {type});
    rec.mr = null; releaseMicLater(); renderPtt();
    setTimeout(playNext, 300);
    if(rec.cancelled) return;
    if(dur < 0.6 || blob.size < 400) return B.toast('اضغط مطوّلًا وتكلّم، ثم ارفع إصبعك');
    renderPtt('send');
    tone('end');
    const vid = (crypto.randomUUID && crypto.randomUUID()) || '';
    const local = {id:vid || ('l' + Date.now()), member_id:me(), mime:type.split(';')[0], duration:+dur.toFixed(1), created_at:new Date().toISOString(), url:URL.createObjectURL(blob)};
    // المقاطع القصيرة تصل للأعضاء فورًا عبر القناة المباشرة، والرفع للخادم يكمل بالتوازي (للتاريخ والبلاغات)
    let liveSent = false;
    if(vid && blob.size <= 110000){
      try{
        const b64 = await new Promise((res, rej)=>{ const fr = new FileReader(); fr.onload = ()=>res(String(fr.result).split(',')[1]); fr.onerror = rej; fr.readAsDataURL(blob); });
        liveSent = RT.send('voice_live', {id:vid, mime:local.mime, duration:local.duration, b64});
      }catch(e){}
    }
    if(liveSent){ addVoice(local, false); renderPtt(); }
    const fd = new FormData();
    if(vid) fd.append('id', vid);
    fd.append('room_id', R.sess.room_id); fd.append('member_id', R.sess.member_id); fd.append('token', R.sess.token);
    fd.append('duration', dur.toFixed(1));
    fd.append('audio', new File([blob], 'v.' + (type.includes('webm') ? 'webm' : type.includes('ogg') ? 'ogg' : 'm4a'), {type:type.split(';')[0]}));
    let j = {};
    try{
      const r = await fetch(FN + '?a=voice', {method:'POST', headers:{apikey:KEY}, body:fd});
      j = await r.json().catch(()=>({}));
      if(!r.ok) j.ok = false;
    }catch(e){ j = {ok:false, error:'net'}; }
    renderPtt();
    if(!j.ok){
      if(['kicked', 'not_member', 'expired'].includes(j.error)) return endRoom(errText(j.error));
      return liveSent ? null : B.toast(errText(j.error));
    }
    if(liveSent){ const x = R.voice.find(q=>q.id === j.voice.id); if(x) x.url_srv = j.voice.url; }
    else addVoice(j.voice, false);
    RT.send('voice', {v:j.voice});
  }
  function releaseMicLater(){
    clearTimeout(rec.idle);
    rec.idle = setTimeout(()=>{ if(!rec.on && rec.stream){ rec.stream.getTracks().forEach(t=>t.stop()); rec.stream = null; } }, 90000);
  }

  // ---------- الاستغاثة داخل الغرفة ----------
  function sendSos(){
    const mp = myPosPayload();
    if(!mp) return B.toast('انتظر حتى يتحدد موقعك');
    api('sos', authBody()).catch(()=>{});
    R.mySos = {t:Date.now()};
    RT.send('sos', mp);
    clearInterval(R.mySosTimer);
    R.mySosTimer = setInterval(()=>{
      if(!R.mySos || Date.now() - R.mySos.t > 15 * 60e3) return stopMySos();
      const p = myPosPayload(); if(p) RT.send('sos', p);
    }, 20000);
    if(navigator.vibrate) navigator.vibrate(200);
    B.toast('🆘 أُرسلت استغاثتك وموقعك لكل أعضاء الغرفة');
    render();
  }
  function stopMySos(silent){
    clearInterval(R.mySosTimer); R.mySos = null;
    RT.send('sos_off', {});
    if(!silent) B.toast('أُلغيت الاستغاثة');
    render();
  }
  function onSos(id, p){
    const first = !R.sos.has(id);
    R.sos.set(id, {lat:+p.lat, lng:+p.lng, t:Date.now()});
    setPos(id, p);
    if(first){
      if(navigator.vibrate) navigator.vibrate([400, 150, 400, 150, 400]);
      beep();
    }
    renderSos();
  }
  // نغمات اللاسلكي: قبل الكلام، بعد الإرسال، وقبل تشغيل رسالة واردة
  let actx = null;
  function audioCtx(){ try{ if(!actx){ const C = window.AudioContext || window.webkitAudioContext; if(C) actx = new C(); } if(actx && actx.state === 'suspended') actx.resume(); }catch(e){} return actx; }
  function tone(kind){
    const ctx = audioCtx(); if(!ctx) return 0;
    const seq = kind === 'start' ? [[1200, .07], [1600, .09]] : kind === 'end' ? [[1600, .06], [1000, .1]] : [[900, .06], [1300, .06], [1800, .09]];
    let t = ctx.currentTime + .01;
    for(const [f, d] of seq){
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'sine'; o.frequency.value = f;
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(.18, t + .01); g.gain.setValueAtTime(.18, t + d - .015); g.gain.linearRampToValueAtTime(0, t + d);
      o.connect(g); g.connect(ctx.destination); o.start(t); o.stop(t + d + .01); t += d + .02;
    }
    return Math.round((t - ctx.currentTime) * 1000);
  }
  function beep(){
    try{
      const C = window.AudioContext || window.webkitAudioContext; if(!C) return;
      const ctx = new C(), o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'square'; o.frequency.value = 880; g.gain.value = 0.08;
      o.connect(g); g.connect(ctx.destination); o.start();
      [0, .3, .6, .9].forEach((t, i)=>{ o.frequency.setValueAtTime(i % 2 ? 660 : 880, ctx.currentTime + t); });
      o.stop(ctx.currentTime + 1.2); o.onended = ()=>ctx.close();
    }catch(e){}
  }

  // ---------- أدوات ----------
  function memberName(id){ const m = R.members.get(id); return m ? m.name : 'عضو سابق'; }
  function memberColor(id){ const m = R.members.get(id); return m ? m.color : '#9A9287'; }
  function ago(t){
    const s = Math.max(0, (Date.now() - t) / 1000);
    if(s < 60) return 'الآن';
    if(s < 3600) return 'قبل ' + Math.round(s / 60) + 'د';
    return 'قبل ' + Math.round(s / 3600) + 'س';
  }
  function navToCar(id){
    const p = R.pos.get(id); if(!p || !p.car) return B.toast('لا توجد سيارة محفوظة');
    R.navObj = {id:'room-car-' + id, _car:id, name:'سيارة ' + memberName(id), icon:'🚗', cat:'other', lat:p.car.lat, lng:p.car.lng, alt:null, createdAt:Date.now()};
    close();
    B.navigateTo(R.navObj);
  }
  function navTo(id){
    const p = id === 'rally' ? R.rally : R.pos.get(id);
    if(!p) return B.toast('لا يوجد موقع بعد');
    R.navObj = {id:'room-' + id, _member:id === 'rally' ? null : id, name:id === 'rally' ? (R.rally.label || 'نقطة التجمع') : memberName(id),
      icon:id === 'rally' ? '🚩' : '👤', cat:'other', lat:p.lat, lng:p.lng, alt:null, createdAt:Date.now()};
    close();
    B.navigateTo(R.navObj);
  }

  // ---------- الخريطة ----------
  let mapTimer = null;
  function syncMapSoon(){ if(!mapTimer) mapTimer = setTimeout(()=>{ mapTimer = null; syncMap(); }, 1500); }
  function syncMap(fit){
    const marks = [];
    if(R.sess) for(const [id, m] of R.members){
      if(id === me()) continue;
      const p = R.pos.get(id); if(!p) continue;
      marks.push({lat:p.lat, lng:p.lng, name:m.name, color:m.color, stale:Date.now() - p.t > STALE_MS, sos:R.sos.has(id)});
      if(p.car) marks.push({lat:p.car.lat, lng:p.car.lng, name:'سيارة ' + m.name, car:true});
    }
    B.postToMap({type:'DALIL_ROOM_UPDATE', fit:!!fit, marks, rally:R.sess && R.rally ? {lat:R.rally.lat, lng:R.rally.lng, name:R.rally.label} : null});
  }

  // ---------- الواجهة ----------
  const CSS = `
  .rm-sheet{max-height:94vh; display:flex; flex-direction:column; padding-bottom:0}
  .rm-scroll{overflow-y:auto; flex:1; min-height:0; padding-bottom:12px}
  .rm-head{display:flex; align-items:center; gap:10px; margin-bottom:12px}
  .rm-head h3{flex:1; margin:0; font-size:18px}
  .rm-x{width:40px; height:40px; border-radius:50%; border:1px solid var(--line); background:var(--panel-2); color:var(--text); font-size:20px; cursor:pointer}
  .rm-note{font-size:12.5px; line-height:1.75; color:var(--text-dim); background:var(--panel-2); border:1px solid var(--line); border-radius:14px; padding:10px 12px; margin:10px 0}
  .rm-field{display:block; margin-bottom:10px}
  .rm-field span{display:block; font-size:13px; font-weight:600; margin-bottom:5px}
  .rm-field input{width:100%; min-height:48px; border-radius:14px; border:1px solid var(--line); background:var(--panel-2); color:var(--text); font:inherit; font-size:16px; padding:0 14px}
  .rm-field input.num{direction:ltr; text-align:center; letter-spacing:4px; font-weight:700}
  .rm-terms{display:flex; gap:8px; align-items:flex-start; font-size:12.5px; line-height:1.7; color:var(--text-dim); margin:6px 0 12px}
  .rm-terms input{width:20px; height:20px; flex:0 0 auto; margin-top:2px}
  .rm-terms a{color:var(--sand-dim)}
  .rm-err{color:var(--danger); font-size:13px; font-weight:600; margin:0 0 10px}
  .rm-seg{display:grid; grid-template-columns:1fr 1fr; gap:6px; background:var(--panel-2); border:1px solid var(--line); border-radius:14px; padding:4px; margin-bottom:12px}
  .rm-seg button{min-height:40px; border:0; border-radius:10px; background:transparent; color:var(--text-dim); font:inherit; font-weight:700; cursor:pointer}
  .rm-seg button.on{background:var(--panel); color:var(--text); box-shadow:0 1px 3px rgba(0,0,0,.12)}
  .rm-info{display:flex; align-items:center; gap:10px; flex-wrap:wrap; font-size:12.5px; color:var(--text-dim); margin-bottom:10px}
  .rm-code{direction:ltr; font-weight:800; font-size:15px; color:var(--text); letter-spacing:2px}
  .rm-live{display:inline-flex; align-items:center; gap:5px}
  .rm-live i{width:8px; height:8px; border-radius:50%; background:var(--text-faint)}
  .rm-live.on i{background:#3E8E5A}
  .rm-chip{border:1px solid var(--line); background:var(--panel-2); color:var(--text); border-radius:100px; padding:5px 12px; font:inherit; font-size:12.5px; font-weight:600; cursor:pointer}
  .rm-title{font-size:13px; font-weight:700; color:var(--text-dim); margin:14px 2px 8px}
  .rm-rally{display:flex; align-items:center; gap:10px; background:#FBF3E6; border:1px solid #EAD6B5; border-radius:16px; padding:10px 12px}
  :is(html[data-theme="dark"],html[data-theme="red"]) .rm-rally{background:#2A2319; border-color:#4A3C28}
  .rm-rally b{display:block; font-size:14px}
  .rm-rally small{display:block; font-size:12px; color:var(--text-dim)}
  .rm-rally .grow{flex:1; min-width:0}
  .rm-mem{display:flex; align-items:center; gap:10px; padding:9px 10px; border:1px solid var(--line); background:var(--panel-2); border-radius:16px; margin-bottom:6px}
  .rm-av{width:36px; height:36px; border-radius:50%; display:grid; place-items:center; color:#fff; font-weight:800; font-size:15px; flex:0 0 auto}
  .rm-mem .grow{flex:1; min-width:0}
  .rm-mem b{display:block; font-size:14.5px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis}
  .rm-mem small{display:block; font-size:12px; color:var(--text-dim)}
  .rm-mem .rm-car{display:block; margin-top:3px; padding:0; border:0; background:none; font:inherit; font-size:12px; font-weight:600; color:var(--gold-ink, #8a5a1f); cursor:pointer; text-align:right}
  .rm-mem small.lag{color:var(--danger); font-weight:700}
  .rm-mem.stale .rm-av{opacity:.45}
  .rm-ib{width:40px; height:40px; border-radius:12px; border:1px solid var(--line); background:var(--panel); color:var(--sand-dim); display:grid; place-items:center; cursor:pointer; flex:0 0 auto}
  .rm-ib svg{width:20px; height:20px}
  .rm-v{display:flex; align-items:center; gap:8px; padding:7px 8px; border-radius:12px; font-size:13px}
  .rm-v.new{background:var(--panel-2)}
  .rm-v .dot{width:10px; height:10px; border-radius:50%; flex:0 0 auto}
  .rm-v .grow{flex:1; min-width:0; white-space:nowrap; overflow:hidden; text-overflow:ellipsis}
  .rm-v small{color:var(--text-faint); font-size:11.5px}
  .rm-v.muted{opacity:.45}
  .rm-play{min-width:44px; height:34px; border-radius:10px; border:1px solid var(--line); background:var(--panel); color:var(--text); font:inherit; font-size:12.5px; cursor:pointer}
  .rm-v.playing .rm-play{background:var(--sand); color:#1C1A17}
  .rm-foot[hidden]{display:none}
  .rm-info{gap:12px}
  .rm-sosnote{background:var(--cp-red-bg); color:var(--cp-red); border-color:#EFCFC9}
  .rm-radar{display:block; position:relative; width:100%; padding:0; border:1px solid var(--line); background:var(--panel-2); border-radius:18px; cursor:pointer; overflow:hidden; min-height:120px; font:inherit; color:var(--text)}
  .rm-radar svg{display:block; width:100%; height:auto}
  .rr-ring{fill:none; stroke:var(--line); stroke-width:1.3}
  .rr-lab{font-size:10px; fill:var(--text-faint); direction:ltr}
  .rr-n{font-size:12px; font-weight:800; fill:#C0392B; text-anchor:middle}
  .rr-ch{font-size:12px; font-weight:800; fill:#fff; text-anchor:middle}
  .rr-flag{font-size:16px; text-anchor:middle}
  .rr-me{fill:#2688ff; stroke:#fff; stroke-width:3}
  .rr-stale{opacity:.45}
  .rr-sos{fill:rgba(192,57,43,.35); animation:rmBlink 1s ease-in-out infinite}
  @keyframes rmBlink{50%{opacity:.2}}
  .rm-radar-go{position:absolute; top:8px; left:8px; display:inline-flex; align-items:center; gap:4px; font-size:12px; font-weight:700; color:var(--sand-dim); background:var(--panel); border:1px solid var(--line); border-radius:100px; padding:3px 10px}
  .rm-radar-go svg{width:14px; height:14px}
  .rm-radar-wait{display:block; padding:44px 12px; text-align:center; font-size:13px; color:var(--text-dim)}
  .rm-radar-wait.bottom{position:absolute; inset:auto 0 6px; padding:0; font-size:12px}
  .rm-rally.empty{background:var(--panel-2); border-color:var(--line); margin-top:14px; padding:8px 12px}
  .rm-rally.empty b{font-size:13.5px}
  .rm-invite{display:flex; align-items:center; gap:10px; margin-top:14px; padding:10px 12px; border:1px solid var(--line); background:var(--panel-2); border-radius:16px}
  .rm-invite .grow{flex:1; min-width:0}
  .rm-invite small{display:block; font-size:11.5px; color:var(--text-dim)}
  .rm-invite .cp-btn{width:auto; min-height:44px; padding:0 14px; font-size:14px}
  .rm-leave{display:block; margin:4px auto 6px; border:0; background:none; color:var(--danger); font:inherit; font-size:13.5px; font-weight:600; text-decoration:underline; cursor:pointer; padding:8px}
  .rm-foot{border-top:1px solid var(--line); padding:12px 0 calc(12px + env(safe-area-inset-bottom)); display:flex; gap:10px; align-items:center}
  .rm-ptt{flex:1; min-height:64px; border-radius:22px; border:0; background:var(--sand); color:#1C1A17; font:inherit; font-size:16px; font-weight:800; display:flex; align-items:center; justify-content:center; gap:8px;
    -webkit-user-select:none; user-select:none; -webkit-touch-callout:none; touch-action:none; cursor:pointer}
  .rm-ptt svg{width:24px; height:24px}
  .rm-ptt.rec{background:#C0392B; color:#fff; animation:rmPulse 1s ease-in-out infinite}
  .rm-ptt.wait,.rm-ptt.send{opacity:.7}
  @keyframes rmPulse{50%{box-shadow:0 0 0 8px rgba(192,57,43,.25)}}
  .rm-sos{width:64px; min-height:64px; border-radius:22px; border:1px solid #EFCFC9; background:var(--cp-red-bg); color:var(--cp-red); font:inherit; font-size:12px; font-weight:800; cursor:pointer;
    -webkit-user-select:none; user-select:none; -webkit-touch-callout:none; position:relative; overflow:hidden}
  .rm-sos.holding::after{content:''; position:absolute; inset:0; background:rgba(142,30,23,.25); transform-origin:right; animation:rmFill 1s linear forwards}
  .rm-sos.on{background:#C0392B; color:#fff}
  @keyframes rmFill{from{transform:scaleX(0)}to{transform:scaleX(1)}}
  .rm-menu .cp-sheet-item{min-height:52px}
  #rmSosAlert{position:fixed; inset:auto 12px calc(84px + env(safe-area-inset-bottom)); z-index:1200; display:none}
  #rmSosAlert.show{display:block}
  .rm-sos-card{background:#8E1E17; color:#fff; border-radius:20px; padding:14px; box-shadow:0 10px 30px rgba(0,0,0,.35); max-width:456px; margin:0 auto}
  .rm-sos-card b{display:block; font-size:16px; margin-bottom:4px}
  .rm-sos-card .row{display:flex; gap:8px; margin-top:10px}
  .rm-sos-card button{flex:1; min-height:44px; border-radius:14px; border:0; font:inherit; font-weight:700; cursor:pointer}
  .rm-sos-card .go{background:#fff; color:#8E1E17}
  .rm-sos-card .x{background:rgba(255,255,255,.18); color:#fff}
  `;

  function build(){
    if($('roomOverlay')) return;
    const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
    const ov = document.createElement('div');
    ov.className = 'overlay'; ov.id = 'roomOverlay';
    ov.innerHTML = `<div class="sheet cp-sheet rm-sheet" role="dialog" aria-modal="true" aria-labelledby="rmTitle">
      <div class="rm-head"><h3 id="rmTitle">غرفة الرحلة</h3><button class="rm-x" type="button" id="rmClose" aria-label="إغلاق">×</button></div>
      <div class="rm-scroll" id="rmBody"></div>
      <div class="rm-foot" id="rmFoot" hidden>
        <button class="rm-sos" type="button" id="rmSos">استغاثة</button>
        <button class="rm-ptt" type="button" id="rmPtt"></button>
      </div>
    </div>`;
    document.body.appendChild(ov);
    const menu = document.createElement('div');
    menu.className = 'overlay'; menu.id = 'roomMenu'; menu.style.zIndex = '60';
    menu.innerHTML = '<div class="sheet cp-sheet rm-menu" role="dialog" aria-modal="true"><div class="sheet-handle"></div><div id="rmMenuBody"></div></div>';
    document.body.appendChild(menu);
    const alert = document.createElement('div');
    alert.id = 'rmSosAlert'; alert.setAttribute('role', 'alert');
    document.body.appendChild(alert);

    ov.addEventListener('click', e=>{ if(e.target === ov) close(); });
    menu.addEventListener('click', e=>{ if(e.target === menu) menu.classList.remove('show'); });
    ov.addEventListener('pointerdown', unlockAudio, {passive:true});
    $('rmClose').onclick = close;
    $('rmBody').addEventListener('click', onBodyClick);
    $('rmBody').addEventListener('input', e=>{ if(e.target.classList.contains('num')) e.target.value = e.target.value.replace(/\D/g, ''); if($('rmErr')) $('rmErr').hidden = true; });
    const ptt = $('rmPtt');
    ptt.addEventListener('pointerdown', e=>{ if(e.button > 0) return; e.preventDefault(); try{ ptt.setPointerCapture(e.pointerId); }catch(_){} recStart(); });
    ptt.addEventListener('pointerup', ()=>recStop());
    ptt.addEventListener('pointercancel', ()=>recStop(true));
    ptt.addEventListener('contextmenu', e=>e.preventDefault());
    ptt.addEventListener('keydown', e=>{ if((e.key === ' ' || e.key === 'Enter') && !e.repeat){ e.preventDefault(); recStart(); } });
    ptt.addEventListener('keyup', e=>{ if(e.key === ' ' || e.key === 'Enter') recStop(); });
    // استغاثة: ضغط مطوّل ثانية، أو ضغطة لإلغاء الاستغاثة القائمة
    const sos = $('rmSos'); let sosT = null;
    sos.addEventListener('pointerdown', e=>{
      if(R.mySos) return;
      e.preventDefault(); sos.classList.add('holding');
      sosT = setTimeout(()=>{ sos.classList.remove('holding'); sosT = null; sendSos(); }, 1000);
    });
    const sosUp = ()=>{ if(sosT){ clearTimeout(sosT); sosT = null; sos.classList.remove('holding'); B.toast('اضغط مطوّلًا ثانية لإرسال استغاثة للغرفة'); } };
    sos.addEventListener('pointerup', sosUp); sos.addEventListener('pointercancel', ()=>{ clearTimeout(sosT); sosT = null; sos.classList.remove('holding'); });
    sos.addEventListener('contextmenu', e=>e.preventDefault());
    // النقرة التي تلي الضغط المطوّل نفسه لا تُلغي الاستغاثة
    sos.addEventListener('click', ()=>{ if(R.mySos && Date.now() - R.mySos.t > 1500 && confirm('إلغاء الاستغاثة؟')) stopMySos(); });
  }

  function open(prefillCode, prefillPin){
    build();
    R.open = true;
    if(prefillCode){ R.tab = 'join'; R.prefill = prefillCode; R.prefillPin = prefillPin || ''; }
    $('roomOverlay').classList.add('show');
    render();
    if(R.sess) refreshState();
  }
  function close(){
    R.open = false;
    const ov = $('roomOverlay'); if(ov) ov.classList.remove('show');
    updateBtn();
  }

  function render(){
    if(!$('rmBody')) return;
    $('rmFoot').hidden = !R.sess;
    if(!R.sess) return renderLobby();
    renderRoomBody();
  }

  function renderLobby(){
    const name = esc(lsGet(LS.name) || ''), join = R.tab === 'join';
    $('rmTitle').textContent = 'غرفة الرحلة';
    $('rmBody').innerHTML = `
      <div class="rm-note">تكلّم مع جماعتك بالضغط على زر واحد مثل اللاسلكي، وشوف مواقعهم على الخريطة وكم يبعدون عنك. حتى 15 شخصًا، والغرفة تنتهي بعد 24 ساعة.</div>
      <div class="rm-seg" role="tablist">
        <button type="button" data-rm="tab-join" class="${join ? 'on' : ''}">دخول غرفة</button>
        <button type="button" data-rm="tab-create" class="${join ? '' : 'on'}">إنشاء غرفة</button>
      </div>
      <label class="rm-field"><span>اسمك (يظهر للأعضاء)</span><input id="rmName" maxlength="24" autocomplete="nickname" value="${name}" placeholder="مثال: أبو مالك"></label>
      ${join
        ? `<label class="rm-field"><span>رقم الغرفة</span><input id="rmCode" class="num" inputmode="numeric" maxlength="6" placeholder="000000" value="${esc(R.prefill || '')}"></label>`
        : `<label class="rm-field"><span>اسم الرحلة (اختياري)</span><input id="rmTrip" maxlength="40" placeholder="مثال: كشتة النفود"></label>`}
      <label class="rm-field"><span>${join ? 'الرمز السري' : 'اختر رمزًا سريًا (4 أرقام أو أكثر)'}</span><input id="rmPin" class="num" inputmode="numeric" maxlength="8" placeholder="••••" autocomplete="off" value="${join ? esc(R.prefillPin || '') : ''}"></label>
      <label class="rm-terms"><input type="checkbox" id="rmTerms" ${lsGet(LS.terms) ? 'checked' : ''}><span>أوافق على <a href="support.html#room-terms" target="_blank" rel="noopener">شروط غرفة الرحلة</a>: لا ألفاظ مسيئة ولا إزعاج. يمكن للأعضاء كتمي وإخراجي والإبلاغ عني.</span></label>
      <div class="rm-err" id="rmErr" hidden></div>
      <button class="cp-btn cp-btn-gold cp-btn-lg" type="button" id="rmGo" data-rm="go"></button>
      <div class="rm-note">🔒 موقعك يظهر لأعضاء الغرفة فقط وأنت داخلها ودليل مفتوح، ولا يُحفظ عندنا. الرسائل الصوتية تُحذف بعد ساعة.</div>`;
    renderLobbyBtn();
  }
  function renderLobbyBtn(){ const b = $('rmGo'); if(b) b.textContent = R.tab === 'join' ? 'ادخل الغرفة' : 'أنشئ الغرفة'; }

  function renderRoomBody(){
    const room = R.room || {};
    $('rmTitle').textContent = room.name || 'غرفة الرحلة';
    const left = room.expires_at ? Math.max(0, (new Date(room.expires_at) - Date.now()) / 3600e3) : null;
    const nm = R.members.size;
    $('rmBody').innerHTML = `
      <div class="rm-info">
        <span class="rm-live" id="rmLive"><i></i><span></span></span>
        <span id="rmCount">${nm} ${nm === 1 ? 'عضو' : nm === 2 ? 'عضوان' : nm <= 10 ? 'أعضاء' : 'عضوًا'}</span>
        ${left != null ? `<span>تنتهي بعد ${left >= 1 ? Math.floor(left) + ' س' : Math.ceil(left * 60) + ' د'}</span>` : ''}
      </div>
      ${R.mySos ? `<div class="rm-note rm-sosnote"><b>🆘 استغاثتك مرسلة</b> — يتجدد موقعك للأعضاء كل 20 ثانية. اضغط «إلغاء» بالأسفل لإيقافها.</div>` : ''}
      <button type="button" class="rm-radar" data-rm="map" aria-label="عرض الأعضاء على الخريطة" id="rmRadar"></button>
      <div class="rm-title" id="rmMemTitle">الأعضاء</div>
      <div id="rmMembers"></div>
      <div class="rm-title">الرسائل الصوتية</div>
      <div id="rmVoice"></div>
      <div id="rmRally"></div>
      <div class="rm-invite">
        <div class="grow"><small>رقم الغرفة</small><b class="rm-code">${esc(R.sess.code)}</b></div>
        <div class="grow"><small>الرمز السري</small><b class="rm-code">${esc(R.sess.pin || '••••')}</b></div>
        <button class="cp-btn cp-btn-gold" type="button" data-rm="share">دعوة أصحابك</button>
      </div>
      <div class="rm-note">أبقِ دليل مفتوحًا أثناء السير ليستمر ظهور موقعك ووصول الرسائل الصوتية.</div>
      <button type="button" class="rm-leave" data-rm="leave">مغادرة الغرفة</button>`;
    renderRadar(); renderRally(); renderMembers(); renderVoice(); renderStatus(); renderPtt();
    $('rmSos').classList.toggle('on', !!R.mySos);
    $('rmSos').textContent = R.mySos ? 'إلغاء' : 'استغاثة';
  }
  function renderStatus(){
    const el = $('rmLive'); if(!el) return;
    el.classList.toggle('on', RT.joined);
    el.querySelector('span').textContent = RT.joined ? 'متصل' : 'جارٍ الاتصال…';
  }
  function renderRally(){
    const el = $('rmRally'); if(!el) return;
    if(!R.rally){
      el.innerHTML = `<div class="rm-rally empty"><span>🚩</span><div class="grow"><b>نقطة التجمع</b><small>لم تُحدَّد — أي عضو يقدر يحددها</small></div>
        <button class="rm-chip" type="button" data-rm="rally-set">حدّدها</button></div>`;
      return;
    }
    const a = B.getPos(), d = a ? B.haversine(a.lat, a.lng, R.rally.lat, R.rally.lng) : null;
    el.innerHTML = `<div class="rm-title">نقطة التجمع</div><div class="rm-rally"><span style="font-size:22px">🚩</span><div class="grow"><b>${esc(R.rally.label || 'نقطة التجمع')}</b>
      <small>${d != null ? B.fmtDist(d) + ' · ' + B.directionWord(B.bearing(a.lat, a.lng, R.rally.lat, R.rally.lng)) + ' · ' : ''}حدّدها ${esc(R.rally.by || '')}</small></div>
      <button class="rm-ib" type="button" data-rm="nav" data-id="rally" aria-label="توجّه لنقطة التجمع">${ico('nav')}</button>
      <button class="rm-ib" type="button" data-rm="rally-set" aria-label="تغيير نقطة التجمع">${ico('edit')}</button></div>`;
  }

  // رادار: مواقع الأعضاء حولك (الشمال للأعلى) بحلقات مسافة تتكيّف تلقائيًا
  function renderRadar(){
    const el = $('rmRadar'); if(!el) return;
    const a = B.getPos();
    if(!a){ el.innerHTML = '<span class="rm-radar-wait">بانتظار موقعك لعرض الأعضاء حولك…</span>'; return; }
    const pts = [];
    for(const [id, m] of R.members){
      if(id === me()) continue;
      const p = R.pos.get(id); if(!p) continue;
      pts.push({lat:p.lat, lng:p.lng, color:m.color, ch:(m.name || '؟').trim().charAt(0), stale:Date.now() - p.t > STALE_MS, sos:R.sos.has(id)});
    }
    if(R.rally) pts.push({lat:R.rally.lat, lng:R.rally.lng, rally:true});
    const k = Math.cos(a.lat * Math.PI / 180);
    pts.forEach(p=>{ p.dx = (p.lng - a.lng) * 111320 * k; p.dy = (p.lat - a.lat) * 110540; p.d = Math.hypot(p.dx, p.dy); });
    const max = Math.max(60, ...pts.map(p=>p.d));
    const steps = [20, 50, 100, 200, 250, 500, 1000, 2000, 2500, 5000, 10000, 20000, 25000, 50000, 100000, 200000, 500000];
    const step = steps.find(v=>v * 3 >= max * 1.08) || steps[steps.length - 1];
    const W = 340, H = 210, cx = W / 2, cy = H / 2, Rm = 92, sc = Rm / (step * 3);
    const lab = v=>v >= 1000 ? (v / 1000) + ' كم' : v + ' م';
    let svg = `<svg viewBox="0 0 ${W} ${H}" aria-hidden="true">`;
    for(let i = 1; i <= 3; i++) svg += `<circle cx="${cx}" cy="${cy}" r="${Rm * i / 3}" class="rr-ring"/><text x="${cx + 4}" y="${cy - Rm * i / 3 + 11}" class="rr-lab">${lab(step * i)}</text>`;
    svg += `<text x="${cx}" y="${cy - Rm - 4}" class="rr-n">ش</text>`;
    // نقطة التجمع أولًا ثم الأعضاء فوقها
    for(const p of pts.sort((x, y)=>(y.rally ? 1 : 0) - (x.rally ? 1 : 0))){
      const x = cx + p.dx * sc, y = cy - p.dy * sc;
      if(p.rally) svg += `<text x="${x}" y="${y + 6}" class="rr-flag">🚩</text>`;
      else svg += `<g class="${p.stale ? 'rr-stale' : ''}">${p.sos ? `<circle cx="${x}" cy="${y}" r="17" class="rr-sos"/>` : ''}<circle cx="${x}" cy="${y}" r="12" fill="${esc(p.color)}" stroke="#fff" stroke-width="2"/><text x="${x}" y="${y + 5}" class="rr-ch">${esc(p.ch)}</text></g>`;
    }
    svg += `<circle cx="${cx}" cy="${cy}" r="7" class="rr-me"/></svg><span class="rm-radar-go">${ico('map')}الخريطة</span>`;
    if(!pts.some(p=>!p.rally)) svg += '<span class="rm-radar-wait bottom">بانتظار مواقع الأعضاء…</span>';
    el.innerHTML = svg;
  }
  let memTimer = null;
  function renderMembersSoon(){ if(R.open && !memTimer) memTimer = setTimeout(()=>{ memTimer = null; renderMembers(); renderRally(); renderRadar(); }, 700); }
  function renderMembers(){
    const el = $('rmMembers'); if(!el) return;
    const a = B.getPos(), list = [...R.members.values()];
    $('rmMemTitle').textContent = 'الأعضاء (' + list.length + '/15) · الأقرب أولًا';
    list.sort((x, y)=>(x.member_id === me() ? -1 : y.member_id === me() ? 1 : (distTo(x.member_id) ?? 1e12) - (distTo(y.member_id) ?? 1e12)));
    el.innerHTML = list.map(m=>{
      const mine = m.member_id === me(), p = R.pos.get(m.member_id), stale = p && Date.now() - p.t > STALE_MS;
      let sub;
      if(mine) sub = a ? 'أنت · موقعك يظهر للأعضاء' : 'أنت · بانتظار موقعك';
      else if(!p) sub = 'بانتظار موقعه';
      else{
        const d = a ? B.haversine(a.lat, a.lng, p.lat, p.lng) : null;
        sub = (d != null ? B.fmtDist(d) + ' · ' + B.directionWord(B.bearing(a.lat, a.lng, p.lat, p.lng)) : 'موقعه وصل') + (Number.isFinite(p.spd) && p.spd > 2 ? ' · ' + Math.round(p.spd * 3.6) + ' كم/س' : '') + (stale ? ' · آخر ظهور ' + ago(p.t) : '');
      }
      const lag = !mine && R.lagging.has(m.member_id), sos = R.sos.has(m.member_id), muted = R.muted.has(m.member_id);
      const car = mine ? myCar() : p && p.car;
      const carLine = car ? (mine ? '<small class="rm-car">🚗 سيارتك محفوظة وتظهر للأعضاء</small>'
        : `<button type="button" class="rm-car" data-rm="navcar" data-id="${esc(m.member_id)}">🚗 سيارته${a ? ' · ' + esc(B.fmtDist(B.haversine(a.lat, a.lng, car.lat, car.lng))) + ' ' + esc(B.directionWord(B.bearing(a.lat, a.lng, car.lat, car.lng))) : ''} — توجّه</button>`) : '';
      return `<div class="rm-mem${stale ? ' stale' : ''}">
        <span class="rm-av" style="background:${esc(m.color)}">${esc((m.name || '؟').trim().charAt(0))}</span>
        <div class="grow"><b>${sos ? '🆘 ' : ''}${esc(m.name)}${muted ? ' 🔇' : ''}</b><small class="${lag || sos ? 'lag' : ''}">${lag ? 'بعيد عن القافلة · ' : ''}${esc(sub)}</small>${carLine}</div>
        ${mine ? '' : `<button class="rm-ib" type="button" data-rm="nav" data-id="${esc(m.member_id)}" aria-label="توجّه إلى ${esc(m.name)}" ${p ? '' : 'disabled'}>${ico('nav')}</button>
        <button class="rm-ib" type="button" data-rm="menu" data-id="${esc(m.member_id)}" aria-label="خيارات ${esc(m.name)}">${ico('more')}</button>`}
      </div>`;
    }).join('');
  }
  let voiceTimer = null;
  function renderVoiceSoon(){ if(!voiceTimer) voiceTimer = setTimeout(()=>{ voiceTimer = null; renderVoice(); }, 120); }
  function renderVoice(){
    const el = $('rmVoice'); if(!el) return;
    const list = R.voice.slice(-6).reverse();
    if(!list.length){ el.innerHTML = '<div class="rm-note" style="margin:0">لا توجد رسائل بعد. اضغط مطوّلًا على «اضغط وتكلّم» بالأسفل.</div>'; return; }
    el.innerHTML = list.map(v=>{
      const mine = v.member_id === me(), muted = R.muted.has(v.member_id), isNew = !R.heard.has(v.id), pl = playing && playing.id === v.id;
      return `<div class="rm-v${isNew ? ' new' : ''}${muted ? ' muted' : ''}${pl ? ' playing' : ''}">
        <span class="dot" style="background:${esc(memberColor(v.member_id))}"></span>
        <span class="grow">${mine ? 'أنت' : esc(memberName(v.member_id))}${v.duration ? ' · ' + Math.round(v.duration) + 'ث' : ''} <small>${ago(new Date(v.created_at).getTime())}</small></span>
        <button class="rm-play" type="button" data-rm="play" data-id="${esc(v.id)}">${pl ? '■' : '▶'}</button>
      </div>`;
    }).join('');
  }
  function renderPtt(mode){
    const b = $('rmPtt'); if(!b) return;
    mode = mode || (rec.on ? 'rec' : '');
    b.className = 'rm-ptt' + (mode ? ' ' + mode : '');
    b.innerHTML = mode === 'rec' ? '● يسجّل… <span id="rmPttTime">0ث</span> — ارفع إصبعك للإرسال'
      : mode === 'wait' ? 'لحظة…' : mode === 'send' ? 'جارٍ الإرسال…' : ico('radio') + 'اضغط مطوّلًا وتكلّم';
  }

  function onBodyClick(e){
    const t = e.target.closest('[data-rm]'); if(!t) return;
    const act = t.dataset.rm, id = t.dataset.id;
    if(act === 'tab-join' || act === 'tab-create'){
      const keep = {name:$('rmName').value, pin:$('rmPin').value};
      R.tab = act === 'tab-join' ? 'join' : 'create'; renderLobby();
      $('rmName').value = keep.name; $('rmPin').value = keep.pin;
    }
    else if(act === 'go') enter(R.tab);
    else if(act === 'share') shareRoom();
    else if(act === 'leave') leave();
    else if(act === 'map'){ close(); B.showMap(); setTimeout(()=>syncMap(true), 400); }
    else if(act === 'nav') navTo(id);
    else if(act === 'navcar') navToCar(id);
    else if(act === 'menu') memberMenu(id);
    else if(act === 'rally-set') rallyMenu();
    else if(act === 'play'){
      const v = R.voice.find(x=>x.id === id); if(!v) return;
      if(playing && playing.id === id){ player.pause(); playing = null; renderVoice(); return; }
      if(!v.url) return B.toast('انتهت صلاحية التسجيل');
      queue = []; playClip(v, true);
    }
  }

  function showMenu(html){
    $('rmMenuBody').innerHTML = html;
    $('roomMenu').classList.add('show');
    $('rmMenuBody').onclick = e=>{
      const t = e.target.closest('[data-mm]'); if(!t) return;
      $('roomMenu').classList.remove('show');
      menuAction(t.dataset.mm, t.dataset.id, t.dataset.arg);
    };
  }
  const item = (mm, idv, title, sub, arg)=>`<button type="button" class="cp-sheet-item" data-mm="${mm}" data-id="${esc(idv || '')}" data-arg="${esc(arg || '')}"><span class="grow" style="flex:1"><b>${title}</b>${sub ? `<small>${sub}</small>` : ''}</span></button>`;
  function memberMenu(id){
    const n = esc(memberName(id)), muted = R.muted.has(id);
    showMenu(`<h3 style="margin:0 0 12px">${n}</h3><div class="cp-sheet-list">
      ${item('nav', id, 'توجّه إليه بالبوصلة', 'السهم يتبع موقعه أولًا بأول')}
      ${muted ? item('unmute', id, 'إلغاء الكتم', 'تسمع رسائله من جديد')
        : item('mute', id, 'كتم', 'لن تسمع رسائله. إذا كتمه 3 أعضاء يخرج من الغرفة')}
      ${item('report', id, 'إبلاغ عن إساءة', 'يصل البلاغ لإدارة دليل وتتم مراجعته خلال 24 ساعة')}
    </div><button type="button" class="cp-btn cp-btn-white" data-mm="x">إلغاء</button>`);
  }
  function rallyMenu(){
    const t = B.getNavTarget && B.getNavTarget();
    const hasT = t && Number.isFinite(t.lat) && !String(t.id || '').startsWith('room-');
    showMenu(`<h3 style="margin:0 0 12px">نقطة التجمع</h3><div class="cp-sheet-list">
      ${item('rally-here', '', 'موقعي الحالي', 'يشوفها كل الأعضاء ويتوجهون لها')}
      ${hasT ? item('rally-target', '', 'وجهتي الحالية: ' + esc(t.name || 'نقطة'), 'الوجهة المحددة في البوصلة') : ''}
      ${R.rally ? item('rally-clear', '', 'إزالة نقطة التجمع', '') : ''}
    </div><button type="button" class="cp-btn cp-btn-white" data-mm="x">إلغاء</button>`);
  }
  async function menuAction(mm, id){
    if(mm === 'nav') return navTo(id);
    if(mm === 'mute' || mm === 'unmute'){
      if(mm === 'mute') R.muted.add(id); else R.muted.delete(id);
      saveSess(); render();
      const j = await api('mute', authBody({target:id, unmute:mm === 'unmute'}));
      if(j.ok && j.kicked){
        RT.send('rekey', {target:id});
        B.toast('خرج ' + memberName(id) + ' من الغرفة بتصويت ' + j.votes + ' أعضاء');
        setTimeout(refreshState, 600);
      }else if(j.ok && mm === 'mute' && j.need) B.toast('تم الكتم (' + j.votes + ' من ' + j.need + ' لإخراجه من الغرفة)');
      return;
    }
    if(mm === 'report'){
      const reasons = ['ألفاظ مسيئة أو سب', 'إزعاج متكرر', 'محتوى غير لائق', 'تهديد أو تحرش', 'سبب آخر'];
      showMenu(`<h3 style="margin:0 0 12px">سبب البلاغ عن ${esc(memberName(id))}</h3><div class="cp-sheet-list">
        ${reasons.map(r=>item('report-send', id, esc(r), '', r)).join('')}</div><button type="button" class="cp-btn cp-btn-white" data-mm="x">إلغاء</button>`);
      return;
    }
    if(mm === 'report-send'){
      const reason = arguments[2];
      const last = R.voice.filter(v=>v.member_id === id).pop();
      const j = await api('report', authBody({target:id, reason, voice_id:last ? last.id : null}));
      if(j.ok){ R.muted.add(id); saveSess(); render(); B.toast('وصل بلاغك، شكرًا لك. كتمناه لك أيضًا'); }
      else B.toast(errText(j.error));
      return;
    }
    if(mm === 'rally-here' || mm === 'rally-target' || mm === 'rally-clear'){
      let body;
      if(mm === 'rally-clear') body = {clear:true};
      else if(mm === 'rally-here'){ const p = B.getPos(); if(!p) return B.toast('انتظر حتى يتحدد موقعك'); body = {lat:p.lat, lng:p.lng, label:'عند ' + R.sess.name}; }
      else{ const t = B.getNavTarget(); body = {lat:t.lat, lng:t.lng, label:t.name || 'نقطة التجمع'}; }
      const j = await api('rally', authBody(body));
      if(!j.ok) return B.toast(errText(j.error));
      R.rally = j.rally; RT.send('rally', {rally:j.rally});
      render(); syncMap();
      B.toast(j.rally ? 'تم تحديد نقطة التجمع للجميع 🚩' : 'أُزيلت نقطة التجمع');
    }
  }

  function renderSos(){
    build();
    const el = $('rmSosAlert');
    const [id, s] = [...R.sos.entries()].pop() || [];
    if(!id || !R.sess){ el.classList.remove('show'); el.innerHTML = ''; syncMap(); return; }
    const a = B.getPos(), d = a ? B.haversine(a.lat, a.lng, s.lat, s.lng) : null;
    el.innerHTML = `<div class="rm-sos-card"><b>🆘 ${esc(memberName(id))} يطلب المساعدة</b>
      <div>${d != null ? 'على بُعد ' + B.fmtDist(d) + ' · ' + B.directionWord(B.bearing(a.lat, a.lng, s.lat, s.lng)) : 'موقعه وصل'} · ${ago(s.t)}</div>
      <div class="row"><button class="go" type="button" data-sos="go">توجّه إليه</button><button class="x" type="button" data-sos="x">إخفاء</button></div></div>`;
    el.classList.add('show');
    el.onclick = e=>{
      const b = e.target.closest('[data-sos]'); if(!b) return;
      if(b.dataset.sos === 'go') navTo(id);
      R.sos.delete(id); renderSos();
    };
    syncMap();
  }

  // ---------- زر الغرفة في البوصلة ----------
  function updateBtn(){
    const b = document.getElementById('roomBtn'); if(!b) return;
    const badge = b.querySelector('.rm-badge'), dot = b.querySelector('.rm-new');
    if(badge){ badge.hidden = !R.sess; badge.textContent = R.sess ? R.members.size + ' في الغرفة' : ''; }
    b.classList.toggle('live', !!R.sess);
    const sub = b.querySelector('.rm-txt small'); if(sub) sub.textContent = R.sess ? 'متصل — اضغط لفتح الغرفة' : 'كلّم جماعتك بضغطة · مواقعهم حولك';
    if(dot) dot.hidden = !R.sess || R.open || !R.voice.some(v=>!R.heard.has(v.id) && !R.muted.has(v.member_id));
  }

  // ---------- الحلقات الدورية ----------
  function startLoops(){
    stopLoops();
    posTimer = setInterval(tickPos, 3000);
    stateTimer = setInterval(()=>{ if(document.visibilityState === 'visible') refreshState(); }, 60000);
  }
  function stopLoops(){ clearInterval(posTimer); clearInterval(stateTimer); posTimer = stateTimer = null; }
  document.addEventListener('visibilitychange', ()=>{
    if(document.visibilityState !== 'visible' || !R.sess) return;
    if(!RT.ws || RT.ws.readyState > 1){ RT.retry = 0; RT.open(); }
    refreshState();
  });
  window.addEventListener('online', ()=>{ if(R.sess){ RT.retry = 0; RT.open(); refreshState(); } });

  // استعادة الغرفة بعد إعادة فتح التطبيق
  (function resume(){
    const s = loadSess();
    if(!s) return;
    R.sess = {room_id:s.room_id, member_id:s.member_id, token:s.token, code:s.code, pin:s.pin, name:s.name};
    R.muted = new Set(s.muted || []);
    setTimeout(roomPush, 4000);
    setTimeout(bgSync, 1500);
    api('state', authBody()).then(j=>{
      if(!j.ok){
        if(['kicked', 'not_member', 'expired'].includes(j.error)) return endRoom(j.error === 'expired' ? 'انتهت غرفة الرحلة (24 ساعة)' : errText(j.error));
        return;   // خطأ شبكة: نبقى ونحاول لاحقًا
      }
      (j.voice || []).forEach(v=>R.heard.add(v.id));
      applyRoom(j);
    });
    startLoops();
  })();

  window.DalilRoom = {
    open, close, syncMap,
    get active(){ return !!R.sess; },
    // زر الطوارئ الرئيسي يرسل موقعك أيضًا لأعضاء الغرفة
    bgAuth,
    broadcastSos(){ if(R.sess && RT.joined){ sendSos(); return true; } return false; }
  };
  updateBtn();
})();
