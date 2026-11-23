// فيديو الإدارة (22 نوفمبر، أبو مالك: «اضف الفيديو بالإدارة، وتكون أعلى دقة»)
// يضغط الفيديو في المتصفح إلى MP4 (H.264) بدقة 1080p حتى 15 ثانية (~6 ميقا) — نفس طريقة التطبيق (events.js) بس بدقة أعلى.
// إذا طلع أكبر من 7.5 ميقا يعيد بدقة 720p. يرجّع {video, photo, thumb, w, h, dur}
(function(){
  const VMAX = 15, LIMIT = 7.5 * 1024 * 1024;
  // 22 نوفمبر: آيفون علّق على «100٪» (إنهاء الضغط ما رجع) — كل خطوة إنهاء لها مهلة، وإذا تعلّقت نعيد بدقة 720p
  const tmo = (p, ms)=>Promise.race([p, new Promise((_, rej)=>setTimeout(()=>rej(new Error('timeout')), ms))]);
  let srcSnd = [];
  let stage = ()=>{}, why = '', sndNote = '', apath = '';   // apath: من وين جا الصوت (للتشخيص)   // why: سبب فشل آخر طريقة (يطلع تحت الرسالة عشان نعرف وين علق)
  const Q_HI = {px:1920, wc:3200000, mr:3200000}, Q_MID = {px:1280, wc:2000000, mr:2000000};
  function loadVideo(file){
    return new Promise((resolve, reject)=>{
      const url = URL.createObjectURL(file), v = document.createElement('video');
      v.muted = true; v.playsInline = true; v.setAttribute('playsinline', ''); v.preload = 'auto';
      v.style.cssText = 'position:fixed;left:10px;bottom:10px;width:110px;max-height:110px;border-radius:10px;background:#000;z-index:50;pointer-events:none;box-shadow:0 2px 8px rgba(0,0,0,.3)';   // 23 نوفمبر: كان مخفي (2px شفاف) — الآيفون يوقف إطارات الفيديو المخفي
      document.body.appendChild(v);
      let done = false;
      const fail = why=>{ if(done) return; done = true; clearTimeout(to); v.remove(); URL.revokeObjectURL(url); reject(new Error(why)); };
      const ok = ()=>{ if(done) return; done = true; clearTimeout(to); resolve({v, url}); };
      const to = setTimeout(()=>fail('timeout'), 20000);
      v.onloadedmetadata = ()=>{ if(!v.videoWidth) return; const p = v.play(); if(p && p.then) p.then(()=>{ v.pause(); ok(); }).catch(()=>ok()); else ok(); };
      v.onerror = ()=>fail('decode');
      v.src = url; v.load();
    });
  }
  const seek = (v, t)=>new Promise(res=>{ const done = ()=>{ v.removeEventListener('seeked', done); res(); }; v.addEventListener('seeked', done); v.currentTime = t; setTimeout(done, 3000); });
  function frameJpeg(v, maxSide, q){
    const s = Math.min(1, maxSide / Math.max(v.videoWidth, v.videoHeight));
    const c = document.createElement('canvas'); c.width = Math.round(v.videoWidth * s); c.height = Math.round(v.videoHeight * s);
    c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
    return new Promise(res=>c.toBlob(b=>res({blob:b, w:c.width, h:c.height}), 'image/jpeg', q));
  }
  let muxerP = null;
  function loadMuxer(){
    if(window.Mp4Muxer) return Promise.resolve(true);
    if(!muxerP) muxerP = new Promise(res=>{ const sc = document.createElement('script'); sc.src = 'vendor/mp4-muxer.min.js?v=1'; sc.onload = ()=>res(!!window.Mp4Muxer); sc.onerror = ()=>{ muxerP = null; res(false); }; document.head.appendChild(sc); });
    return muxerP;
  }
  async function decodeAudio(file){
    let ac = null;
    try{
      const C = window.AudioContext || window.webkitAudioContext; if(!C) return null;
      try{ ac = new C({sampleRate:48000}); }catch(e){ ac = new C(); }
      const buf = await new Promise((res, rej)=>{ file.arrayBuffer().then(ab=>{ const p = ac.decodeAudioData(ab, res, rej); if(p && p.then) p.then(res, rej); }, rej); });
      return buf && buf.length ? buf : null;
    }catch(e){ return null; }
    finally{ if(ac && ac.close) ac.close().catch(()=>{}); }
  }
  async function pickAudioCodec(sr, ch){
    if(!window.AudioEncoder) return null;
    for(const [codec, mux] of [['mp4a.40.2', 'aac'], ['opus', 'opus']]){
      try{ const r = await AudioEncoder.isConfigSupported({codec, sampleRate:sr, numberOfChannels:ch, bitrate:64000}); if(r && r.supported) return {codec, mux}; }catch(e){}
    }
    return null;
  }
  // 23 نوفمبر: سفاري الآيفون ما يقدر يضغط الصوت (ما فيه AudioEncoder) — ناخذ صوت AAC من ملف الفيديو نفسه كما هو (بدون إعادة ضغط)
  // ونركّبه مع الفيديو. قارئ صغير لصناديق MP4/MOV: moov → trak (soun) → stsd/esds + جداول العينات
  async function aacTrack(file){
    const rd = async (o, n)=>new DataView(await file.slice(o, o + n).arrayBuffer());
    const typ = (dv, o)=>String.fromCharCode(dv.getUint8(o), dv.getUint8(o + 1), dv.getUint8(o + 2), dv.getUint8(o + 3));
    let off = 0, moov = null;
    while(off + 8 <= file.size){
      const h = await rd(off, 16); let sz = h.getUint32(0); const t = typ(h, 4);
      if(sz === 1) sz = h.getUint32(8) * 4294967296 + h.getUint32(12); else if(sz === 0) sz = file.size - off;
      if(sz < 8) return null;
      if(t === 'moov'){ if(sz > 60e6) return null; moov = await rd(off, sz); break; }
      off += sz;
    }
    if(!moov) return null;
    let sounds = []; srcSnd = sounds;   // الآيفون مع «الصوت المكاني» يحط أكثر من مسار صوت (apac + aac) — ناخذ أول مسار AAC
    const kids = (s, e)=>{ const out = []; let o = s; while(o + 8 <= e){ let sz = moov.getUint32(o); let hs = 8; if(sz === 1){ sz = moov.getUint32(o + 8) * 4294967296 + moov.getUint32(o + 12); hs = 16; } else if(sz === 0) sz = e - o; if(sz < 8 || o + sz > e) break; out.push({t:typ(moov, o + 4), s:o + hs, e:o + sz}); o += sz; } return out; };
    const find = (b, t)=>kids(b.s, b.e).find(x=>x.t === t);
    for(const trak of kids(8, moov.byteLength).filter(x=>x.t === 'trak')){
      const mdia = find(trak, 'mdia'); if(!mdia) continue;
      const hdlr = find(mdia, 'hdlr'); if(!hdlr || typ(moov, hdlr.s + 8) !== 'soun') continue;
      const mdhd = find(mdia, 'mdhd'); const ts = moov.getUint8(mdhd.s) === 1 ? moov.getUint32(mdhd.s + 20) : moov.getUint32(mdhd.s + 12);
      const minf = find(mdia, 'minf'); if(!minf) continue;
      const stbl = find(minf, 'stbl'); if(!stbl) continue;
      const stsd = find(stbl, 'stsd'); if(!stsd) continue;
      const ent = {s:stsd.s + 8, e:stsd.e}, e0 = kids(ent.s, ent.e)[0]; if(e0) sounds.push(e0.t); if(!e0 || e0.t !== 'mp4a') continue;
      const ver = moov.getUint16(e0.s + 8), extra = ver === 1 ? 16 : ver === 2 ? 36 : 0;
      const sub = {s:e0.s + 28 + extra, e:e0.e};
      let esds = find(sub, 'esds'); if(!esds){ const wave = find(sub, 'wave'); if(wave) esds = find(wave, 'esds'); }
      if(!esds) continue;
      // واصفات esds: 03 (ES) → 04 (DecoderConfig) → 05 (DecoderSpecificInfo = ASC)
      let o = esds.s + 4, asc = null;
      const len = ()=>{ let n = 0; for(let k = 0; k < 4; k++){ const b = moov.getUint8(o++); n = (n << 7) | (b & 127); if(!(b & 128)) break; } return n; };
      while(o < esds.e && !asc){
        const tag = moov.getUint8(o++), n = len();
        if(tag === 3){ o += 2; const fl = moov.getUint8(o++); if(fl & 128) o += 2; if(fl & 64) o += 1 + moov.getUint8(o); if(fl & 32) o += 2; }
        else if(tag === 4) o += 13;
        else if(tag === 5){ asc = new Uint8Array(moov.buffer, moov.byteOffset + o, n).slice(); }
        else o += n;
      }
      if(!asc || asc.length < 2) continue;
      const aot = asc[0] >> 3, fi = ((asc[0] & 7) << 1) | (asc[1] >> 7), chc = (asc[1] >> 3) & 15;
      const SR = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350];
      if(aot !== 2 && aot !== 5 && aot !== 29) continue;
      const sr = SR[fi], ch = chc || 2; if(!sr) continue;
      // جداول العينات
      const stsz = find(stbl, 'stsz'), stsc = find(stbl, 'stsc'), stts = find(stbl, 'stts'), stco = find(stbl, 'stco') || find(stbl, 'co64');
      if(!stsz || !stsc || !stts || !stco) continue;
      const fixed = moov.getUint32(stsz.s + 4), nS = moov.getUint32(stsz.s + 8), sizes = [];
      for(let i = 0; i < nS; i++) sizes.push(fixed || moov.getUint32(stsz.s + 12 + i * 4));
      const nC = moov.getUint32(stco.s + 4), c64 = stco.t === 'co64', chunks = [];
      for(let i = 0; i < nC; i++) chunks.push(c64 ? moov.getUint32(stco.s + 8 + i * 8) * 4294967296 + moov.getUint32(stco.s + 12 + i * 8) : moov.getUint32(stco.s + 8 + i * 4));
      const nE = moov.getUint32(stsc.s + 4), sc = [];
      for(let i = 0; i < nE; i++) sc.push([moov.getUint32(stsc.s + 8 + i * 12), moov.getUint32(stsc.s + 12 + i * 12)]);
      const nT = moov.getUint32(stts.s + 4), deltas = [];
      for(let i = 0; i < nT; i++){ const c = moov.getUint32(stts.s + 8 + i * 8), d = moov.getUint32(stts.s + 12 + i * 8); for(let k = 0; k < c && deltas.length < nS; k++) deltas.push(d); }
      const samples = []; let si = 0, t = 0;
      for(let ci = 0; ci < nC && si < nS; ci++){
        let per = 0; for(const [fc, n] of sc){ if(fc <= ci + 1) per = n; else break; }
        let p = chunks[ci];
        for(let k = 0; k < per && si < nS; k++, si++){ const d = deltas[si] || 1024; samples.push({o:p, n:sizes[si], t:t / ts * 1e6, d:d / ts * 1e6}); p += sizes[si]; t += d; }
      }
      if(!samples.length) continue;
      sounds.push('ok'); return {asc, sr, ch, codec:'mp4a.40.' + aot, samples, read:async smp=>new Uint8Array(await file.slice(smp.o, smp.o + smp.n).arrayBuffer())};
    }
    return sounds.length ? {noAac:sounds.join('+')} : null;
  }
  async function pickVideoCfg(W, H, bitrate){
    // 1080p يحتاج مستوى 4.0: High ثم Main ثم Baseline
    for(const codec of ['avc1.420028', 'avc1.4d0028', 'avc1.640028', 'avc1.42E01F']){
      const cfg = {codec, width:W, height:H, bitrate, framerate:30, avc:{format:'avc'}};
      try{ const r = await VideoEncoder.isConfigSupported(cfg); if(r && r.supported) return cfg; }catch(e){}
    }
    return null;
  }
  async function encodeWC(file, ab, v, dur, q, onProgress){
    if(!window.VideoEncoder || !window.VideoFrame || !v.requestVideoFrameCallback){ why = 'wc-none'; return null; }
    if(!(await loadMuxer())){ why = 'muxer'; return null; }
    const end = Math.min(dur, VMAX);
    const s = Math.min(1, q.px / Math.max(v.videoWidth, v.videoHeight));
    const W = Math.round(v.videoWidth * s / 2) * 2, H = Math.round(v.videoHeight * s / 2) * 2;
    const vcfg = await pickVideoCfg(W, H, q.wc); if(!vcfg){ why = 'wc-cfg'; return null; }
    const ch = ab ? Math.min(2, ab.numberOfChannels) : 0;
    const acodec = ab ? await pickAudioCodec(ab.sampleRate, ch) : null;
    let pt = null;   // صوت الملف كما هو (الآيفون)
    let noSnd = '';
    try{ pt = await tmo(aacTrack(file), 15000); }catch(e){ pt = null; }
    if(pt && pt.noAac){ noSnd = pt.noAac; pt = null; }
    if(acodec){ pt = null; noSnd = ''; }
    if(ab && !acodec && !pt && !noSnd){ why = 'wc-noaudio'; return null; }   // (التسجيل في الآيفون يطلع صامت أصلًا، فلو الصوت بصيغة غريبة نكمل بدون صوت مع تنبيه)
    if(noSnd && !acodec) why = 'nosound-' + noSnd;   // فيه صوت بصيغة ما نقدر عليها (مثل الصوت المكاني apac) → فيديو بدون صوت مع تنبيه   // فيه صوت وما قدرنا ناخذه → التسجيل (صوت السيل مهم)   // سفاري الآيفون: ما فيه ضغط صوت → التسجيل (صوت السيل مهم)
    const M = window.Mp4Muxer;
    const muxer = new M.Muxer({target:new M.ArrayBufferTarget(), fastStart:'in-memory', firstTimestampBehavior:'offset',
      video:{codec:'avc', width:W, height:H}, ...(acodec ? {audio:{codec:acodec.mux, sampleRate:ab.sampleRate, numberOfChannels:ch}} : pt ? {audio:{codec:'aac', sampleRate:pt.sr, numberOfChannels:pt.ch}} : {})});
    let err = null;
    const venc = new VideoEncoder({output:(c, m)=>muxer.addVideoChunk(c, m), error:e=>{ err = e; }});
    venc.configure(vcfg);
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const x = c.getContext('2d');
    v.muted = true;
    await seek(v, 0);
    let lastTs = -1, lastKey = -1e9, frames = 0;
    await new Promise(res=>{
      let fin = false;
      const finish = ()=>{ if(fin) return; fin = true; v.removeEventListener('ended', finish); clearTimeout(guard); res(); };
      v.addEventListener('ended', finish);
      const grab = (now, meta)=>{
        if(fin || err) return finish();
        const t = meta && Number.isFinite(meta.mediaTime) ? meta.mediaTime : v.currentTime;
        if(t > end + 0.02){ finish(); return; }
        const ts = Math.round(t * 1e6);
        if(ts > lastTs){
          x.drawImage(v, 0, 0, W, H);
          const f = new VideoFrame(c, {timestamp:ts});
          const key = ts - lastKey >= 2e6; if(key) lastKey = ts;
          if(venc.encodeQueueSize < 8 || key) venc.encode(f, {keyFrame:key}); f.close();
          lastTs = ts; frames++;
        }
        onProgress(Math.min(1, t / end));
        if(t >= end - 0.03 || v.ended){ finish(); return; }
        v.requestVideoFrameCallback(grab);
      };
      v.requestVideoFrameCallback(grab);
      const guard = setTimeout(finish, (end + 5) * 1000);
      const p = v.play(); if(p && p.catch) p.catch(()=>finish());
    });
    v.pause();
    stage('جارٍ إنهاء الفيديو…');
    try{ await tmo(venc.flush(), 20000); }catch(e){ try{ venc.close(); }catch(x){} why = 'wc-flush'; return null; }
    try{ venc.close(); }catch(e){}
    if(err || frames < 3){ why = 'wc-' + (err ? 'err' : 'frames' + frames); return null; }
    if(pt){
      stage('جارٍ تجهيز الصوت…');
      const lim = lastTs + 40000; let first = true;
      try{
        for(const smp of pt.samples){
          if(smp.t > lim) break;
          const data = await pt.read(smp);
          muxer.addAudioChunkRaw(data, 'key', Math.round(smp.t), Math.round(smp.d), first ? {decoderConfig:{codec:pt.codec, sampleRate:pt.sr, numberOfChannels:pt.ch, description:pt.asc}} : undefined);
          first = false;
        }
      }catch(e){ why = 'wc-pt'; return null; }
    }else if(acodec){
      const sr = ab.sampleRate, n = Math.min(ab.length, Math.round((lastTs / 1e6 + 1 / 30) * sr));
      const aenc = new AudioEncoder({output:(c, m)=>muxer.addAudioChunk(c, m), error:e=>{ err = e; }});
      aenc.configure({codec:acodec.codec, sampleRate:sr, numberOfChannels:ch, bitrate:64000});
      const chans = [...Array(ch)].map((_, k)=>ab.getChannelData(k));
      for(let i = 0; i < n && !err; i += 4800){
        const len = Math.min(4800, n - i), data = new Float32Array(len * ch);
        for(let k = 0; k < ch; k++) data.set(chans[k].subarray(i, i + len), k * len);
        const ad = new AudioData({format:'f32-planar', sampleRate:sr, numberOfFrames:len, numberOfChannels:ch, timestamp:Math.round(i / sr * 1e6), data});
        aenc.encode(ad); ad.close();
      }
      stage('جارٍ تجهيز الصوت…');
      try{ await tmo(aenc.flush(), 20000); }catch(e){ try{ aenc.close(); }catch(x){} why = 'wc-aflush'; return null; }
      try{ aenc.close(); }catch(e){}
      if(err){ why = 'wc-aerr'; return null; }
    }
    muxer.finalize();
    apath = acodec ? 'enc ' + acodec.codec : pt ? 'pt ' + pt.codec + ' ' + pt.sr + 'Hz ' + pt.ch + 'ch' : 'none';
    sndNote = /^nosound-/.test(why) ? why : '';
    return new Blob([muxer.target.buffer], {type:'video/mp4'});
  }
  // أجهزة بدون WebCodecs (سفاري قديم): تسجيل اللوحة بـ MediaRecorder
  // 23 نوفمبر: كانت تعلق في الآيفون — تشغيل الصوت (AudioContext) يحتاج ضغطة من المستخدم وإلا ينتظر للأبد.
  // الحين: الفيديو صامت دائمًا، والصوت من الملف نفسه (decodeAudio) عبر AudioContext انفتح وقت الضغط على «جهّز الفيديو»، وكل انتظار له مهلة
  async function encodeMR(v, dur, q, onProgress, ab, ac){
    if(!window.MediaRecorder || !MediaRecorder.isTypeSupported){ why = 'mr-none'; return null; }
    const mime = ['video/mp4;codecs=avc1.640028,mp4a.40.2', 'video/mp4;codecs=avc1', 'video/mp4'].find(t=>{ try{ return MediaRecorder.isTypeSupported(t); }catch(e){ return false; } });
    if(!mime){ why = 'mr-mime'; return null; }
    const s = Math.min(1, q.px / Math.max(v.videoWidth, v.videoHeight));
    const c = document.createElement('canvas'); c.width = Math.round(v.videoWidth * s / 2) * 2; c.height = Math.round(v.videoHeight * s / 2) * 2;
    const x = c.getContext('2d'), stream = c.captureStream(30);
    let dest = null, bsrc = null;
    if(ab && ac){
      try{ if(ac.state !== 'running') await tmo(ac.resume(), 2500); }catch(e){}
      if(ac.state === 'running'){ try{ dest = ac.createMediaStreamDestination(); dest.stream.getAudioTracks().forEach(t=>stream.addTrack(t)); }catch(e){ dest = null; } }
    }
    v.muted = true;
    await seek(v, 0);
    x.drawImage(v, 0, 0, c.width, c.height);
    const rec = new MediaRecorder(stream, {mimeType:mime, videoBitsPerSecond:q.mr, ...(dest ? {audioBitsPerSecond:96000} : {})});
    const parts = []; rec.ondataavailable = e=>{ if(e.data && e.data.size) parts.push(e.data); };
    const stopped = new Promise(res=>rec.onstop = res);
    rec.start(500);
    const end = Math.min(dur, VMAX);
    try{ await tmo(v.play(), 6000); }catch(e){ try{ rec.stop(); }catch(_){} why = 'mr-play'; return null; }
    if(dest){ try{ bsrc = ac.createBufferSource(); bsrc.buffer = ab; bsrc.connect(dest); bsrc.start(0, Math.max(0, v.currentTime), end); }catch(e){} }
    await new Promise(res=>{
      let fin = false;
      const finish = ()=>{ if(fin) return; fin = true; clearTimeout(guard); res(); };
      v.addEventListener('ended', finish, {once:true});
      const draw = ()=>{ if(fin) return; x.drawImage(v, 0, 0, c.width, c.height); onProgress(Math.min(1, v.currentTime / end));
        if(v.currentTime >= end - 0.03 || v.ended || v.paused){ finish(); return; }
        requestAnimationFrame(draw); };   // rAF: يمشي حتى لو الجهاز ما يرسل إطارات الفيديو
      draw();
      const guard = setTimeout(finish, (end + 4) * 1000);
    });
    v.pause(); try{ if(bsrc) bsrc.stop(); }catch(e){} rec.stop(); try{ await tmo(stopped, 15000); }catch(e){ why = 'mr-stop'; return null; }
    stream.getTracks().forEach(t=>t.stop());
    if(!parts.length){ why = 'mr-empty'; return null; }
    if(ab && !dest) why = 'mr-nosound';
    apath = dest ? 'mr' : 'mr-silent';
    return new Blob(parts, {type:'video/mp4'});
  }
  window.AdminVideo = {
    VMAX, LIMIT,
    async prepare(file, onProgress, onStage, ac){
      stage = onStage || (()=>{}); why = ''; sndNote = ''; apath = ''; srcSnd = [];
      const {v, url} = await loadVideo(file);
      try{
        const dur = v.duration;
        if(!Number.isFinite(dur) || dur <= 0.3) throw new Error('decode');
        await seek(v, Math.min(0.6, dur / 2));
        const photo = await frameJpeg(v, 2048, 0.84), thumb = await frameJpeg(v, 420, 0.7);
        let vid = null;
        const ab = await tmo(decodeAudio(file), 20000).catch(()=>null);
        // ضغط سريع 1080p ← 720p، وإذا الجهاز ما يقدر (آيفون: ما فيه ضغط صوت) تسجيل 1080p ← 720p
        const plan = [[Q_HI, 'wc'], [Q_MID, 'wc'], [Q_HI, 'mr'], [Q_MID, 'mr']];
        for(let k = 0; k < plan.length; k++){
          const [q, how] = plan[k];
          if(how === 'wc' && k > 0 && /^wc-(none|cfg|noaudio)$|^muxer$/.test(why)) continue;   // نفس السبب بيتكرر — لا نضيّع وقت
          let out = null;
          try{ out = how === 'wc' ? await encodeWC(file, ab, v, dur, q, onProgress) : await encodeMR(v, dur, q, onProgress, ab, ac); }catch(e){ out = null; why = how + '-x'; }
          if(out && out.size <= LIMIT){ vid = out; if(why !== 'mr-nosound') why = sndNote || ''; break; }
          if(out){ if(!vid || out.size < vid.size) vid = out; why = how + '-big'; }
          const skip = /^wc-(none|cfg|noaudio)$|^muxer$/.test(why);
          let n = k + 1; while(n < plan.length && plan[n][1] === 'wc' && skip) n++;
          if(n < plan.length) stage((plan[n][1] === 'mr' ? 'نسجّل الفيديو' : 'نعيد') + (plan[n][0] === Q_MID ? ' بدقة 720p' : ' بدقة 1080p') + '… [' + why + ']');
        }
        if(!vid) throw new Error('nosupport:' + why);
        if(vid.size > LIMIT) throw new Error('big');
        let lv = null; if(ab){ let m = 0; const d0 = ab.getChannelData(0); for(let i = 0; i < d0.length; i += 64){ const a = Math.abs(d0[i]); if(a > m) m = a; } lv = m > 0 ? Math.round(20 * Math.log10(m)) : -99; }
        return {diag:'🔊 ' + (apath || '?') + ' · المصدر: ' + (srcSnd.join('+') || 'بدون مسار صوت') + ' · قوة الأصل: ' + (lv == null ? 'ما انقرأ' : lv + 'dB'), why, video:vid, photo:photo.blob, thumb:thumb.blob, w:photo.w, h:photo.h, dur:Math.min(dur, VMAX), full:dur > VMAX + 0.5 ? dur : 0};
      } finally { v.pause(); v.remove(); URL.revokeObjectURL(url); }
    },
  };
})();
