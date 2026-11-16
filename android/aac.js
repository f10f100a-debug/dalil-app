// دليل للأندرويد فقط (يحمّله تطبيق الأندرويد 1.6+ من جسره الأصلي — صفحة الآيفون ما تحمّله أبدًا).
// المشكلة: متصفح الأندرويد يسجّل رسائل غرفة الرحلة بصيغة Opus داخل MP4 مقطّع، والآيفون وهو مقفل ما يشغّلها صح.
// الحل: بعد ما يخلص التسجيل نحوّله داخل الجوال إلى M4A (AAC) عادي — نفس صيغة الآيفون بالضبط — قبل الإرسال.
// إذا الجوال ما يدعم التحويل (أو طوّل أكثر من 3 ثواني) يرسل التسجيل الأصلي مثل قبل.
(function(){
  if(window.__dalAac || !window.MediaRecorder || !/DalilAndroid\//.test(navigator.userAgent)) return;
  window.__dalAac = 1;
  const SR = 44100, BR = 48000;
  const FREQ = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350];

  // ---------- صناديق MP4 ----------
  const u32 = n=>[(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
  const u16 = n=>[(n >> 8) & 255, n & 255];
  const str = s=>Array.from(s).map(c=>c.charCodeAt(0));
  const box = (type, ...parts)=>{ const body = [].concat(...parts); return [...u32(8 + body.length), ...str(type), ...body]; };
  const full = (type, v, flags, ...parts)=>box(type, [v, (flags >> 16) & 255, (flags >> 8) & 255, flags & 255], ...parts);
  const desc = (tag, body)=>[tag, body.length, ...body];   // أطوال صغيرة (< 128)
  const zeros = n=>new Array(n).fill(0);

  // ملف M4A عادي (moov قبل mdat، بدون تقطيع) من إطارات AAC خام
  function muxM4a(frames, durs, asc, sr){
    const total = durs.reduce((a, b)=>a + b, 0);
    const esds = full('esds', 0, 0, desc(3, [...u16(0), 0, ...desc(4, [0x40, 0x15, 0, 0x18, 0, ...u32(BR), ...u32(BR), ...desc(5, asc)]), ...desc(6, [2])]));
    const mp4a = box('mp4a', zeros(6), u16(1), zeros(8), u16(1), u16(16), zeros(4), u32(sr * 65536), esds);
    // stts: نجمع المدد المتساوية
    const runs = []; for(const d of durs){ const l = runs[runs.length - 1]; if(l && l[1] === d) l[0]++; else runs.push([1, d]); }
    const stts = full('stts', 0, 0, u32(runs.length), ...runs.map(r=>[...u32(r[0]), ...u32(r[1])]));
    const stsc = full('stsc', 0, 0, u32(1), u32(1), u32(frames.length), u32(1));
    const stsz = full('stsz', 0, 0, u32(0), u32(frames.length), ...frames.map(f=>u32(f.length)));
    const build = off=>{
      const stbl = box('stbl', full('stsd', 0, 0, u32(1), mp4a), stts, stsc, stsz, full('stco', 0, 0, u32(1), u32(off)));
      const minf = box('minf', full('smhd', 0, 0, zeros(4)), box('dinf', full('dref', 0, 0, u32(1), full('url ', 0, 1))), stbl);
      const mdia = box('mdia', full('mdhd', 0, 0, zeros(8), u32(sr), u32(total), u16(0x55c4), u16(0)),
        full('hdlr', 0, 0, zeros(4), str('soun'), zeros(12), str('SoundHandler'), [0]), minf);
      const tkhd = full('tkhd', 0, 3, zeros(8), u32(1), zeros(4), u32(total), zeros(8), u16(0), u16(0), u16(0x0100), u16(0),
        u32(0x10000), zeros(12), u32(0x10000), zeros(12), u32(0x40000000), u32(0), u32(0));
      const mvhd = full('mvhd', 0, 0, zeros(8), u32(sr), u32(total), u32(0x10000), u16(0x0100), zeros(10),
        u32(0x10000), zeros(12), u32(0x10000), zeros(12), u32(0x40000000), zeros(24), u32(2));
      return box('moov', mvhd, box('trak', tkhd, mdia));
    };
    const ftyp = box('ftyp', str('M4A '), u32(0), str('M4A '), str('isom'), str('mp42'));
    const dataLen = frames.reduce((a, f)=>a + f.length, 0);
    const moov = build(ftyp.length + build(0).length + 8);   // الإزاحة لبداية بيانات الصوت داخل mdat
    const out = new Uint8Array(ftyp.length + moov.length + 8 + dataLen);
    out.set(ftyp, 0); out.set(moov, ftyp.length);
    let p = ftyp.length + moov.length; out.set([...u32(8 + dataLen), ...str('mdat')], p); p += 8;
    for(const f of frames){ out.set(f, p); p += f.length; }
    return out;
  }
  window.__dalMuxM4a = muxM4a;   // للفحص الآلي

  // ---------- التحويل ----------
  async function toM4a(blob){
    if(!window.AudioEncoder || !window.OfflineAudioContext) throw new Error('no_webcodecs');
    const cfg = {codec:'mp4a.40.2', sampleRate:SR, numberOfChannels:1, bitrate:BR};
    const sup = await AudioEncoder.isConfigSupported(cfg);
    if(!sup || !sup.supported) throw new Error('no_aac');
    const ab = await blob.arrayBuffer();
    const pcm = await new OfflineAudioContext(1, 1, SR).decodeAudioData(ab);   // يفك Opus ويعيد العيّنات لـ44.1 كيلوهرتز
    let mono = pcm.getChannelData(0);
    if(pcm.numberOfChannels > 1){ mono = new Float32Array(mono); const b = pcm.getChannelData(1); for(let i = 0; i < mono.length; i++) mono[i] = (mono[i] + b[i]) / 2; }
    const frames = [], durs = []; let asc = null, err = null;
    const enc = new AudioEncoder({
      output:(chunk, meta)=>{
        const b = new Uint8Array(chunk.byteLength); chunk.copyTo(b); frames.push(b);
        durs.push(Math.max(1, Math.round((chunk.duration || 1024 * 1e6 / SR) * SR / 1e6)));
        if(!asc && meta && meta.decoderConfig && meta.decoderConfig.description) asc = Array.from(new Uint8Array(meta.decoderConfig.description instanceof ArrayBuffer ? meta.decoderConfig.description : meta.decoderConfig.description.buffer || meta.decoderConfig.description));
      },
      error:e=>{ err = e; }
    });
    enc.configure(cfg);
    const step = SR;   // ثانية لكل دفعة
    for(let i = 0; i < mono.length; i += step){
      const part = mono.subarray(i, Math.min(mono.length, i + step));
      enc.encode(new AudioData({format:'f32-planar', sampleRate:SR, numberOfFrames:part.length, numberOfChannels:1, timestamp:Math.round(i * 1e6 / SR), data:part}));
    }
    await enc.flush(); enc.close();
    if(err) throw err;
    if(!frames.length) throw new Error('empty');
    // AAC-LC، 44.1 كيلوهرتز، قناة وحدة (إذا المشفّر ما أعطانا الإعداد)
    if(!asc || !asc.length){ const fi = FREQ.indexOf(SR); asc = [(2 << 3) | (fi >> 1), ((fi & 1) << 7) | (1 << 3)]; }
    // بعض المشفّرات تطلع إطارات ADTS — نشيل الرأس
    const raw = frames.map(f=>f.length > 7 && f[0] === 0xff && (f[1] & 0xf0) === 0xf0 ? f.subarray((f[1] & 1) ? 7 : 9) : f);
    return new Blob([muxM4a(raw, durs, asc, SR)], {type:'audio/mp4'});
  }

  const withTimeout = (p, ms)=>Promise.race([p, new Promise((_, rej)=>setTimeout(()=>rej(new Error('timeout')), ms))]);
  const stat = window.__dalAacStat = {ok:0, fail:0, last:''};

  // ---------- غلاف MediaRecorder: نفس الواجهة اللي تستخدمها الغرفة ----------
  const O = window.MediaRecorder;
  function W(stream, opts){
    const r = new O(stream, opts), self = this, chunks = [];
    this._r = r; this._mime = ''; this._busy = false;
    this.stream = stream; this.ondataavailable = null; this.onstop = null; this.onerror = null; this.onstart = null; this.onpause = null; this.onresume = null;
    r.ondataavailable = e=>{ if(e.data && e.data.size) chunks.push(e.data); };
    r.onstart = e=>{ self.onstart && self.onstart(e); };
    r.onerror = e=>{ self.onerror && self.onerror(e); };
    r.onpause = e=>{ self.onpause && self.onpause(e); };
    r.onresume = e=>{ self.onresume && self.onresume(e); };
    r.onstop = async()=>{
      self._busy = true;
      const orig = new Blob(chunks, {type:r.mimeType || 'audio/mp4'});
      let out = orig;
      if(/mp4|webm|ogg/.test(orig.type) && orig.size > 400){
        try{ out = await withTimeout(toM4a(orig), 3000); stat.ok++; stat.last = 'ok'; }
        catch(e){ out = orig; stat.fail++; stat.last = String(e && e.message || e).slice(0, 40); }
      }
      self._mime = out.type || r.mimeType;
      self._busy = false;
      try{ self.ondataavailable && self.ondataavailable({data:out}); }catch(e){}
      try{ self.onstop && self.onstop({}); }catch(e){}
    };
  }
  W.prototype.start = function(t){ return this._r.start(t); };
  W.prototype.stop = function(){ return this._r.stop(); };
  W.prototype.pause = function(){ return this._r.pause(); };
  W.prototype.resume = function(){ return this._r.resume(); };
  W.prototype.requestData = function(){};
  W.prototype.addEventListener = function(){ return this._r.addEventListener.apply(this._r, arguments); };
  W.prototype.removeEventListener = function(){ return this._r.removeEventListener.apply(this._r, arguments); };
  Object.defineProperty(W.prototype, 'state', {get(){ return this._busy ? 'inactive' : this._r.state; }});
  Object.defineProperty(W.prototype, 'mimeType', {get(){ return this._mime || this._r.mimeType; }});
  W.isTypeSupported = t=>O.isTypeSupported(t);
  window.MediaRecorder = W;

  // 16 نوفمبر (تجربة): الأندرويد ما يرسل «النسخة السريعة» من الرسالة (voice_live) — يرسلها بنفس طريقة الآيفون:
  // يرفعها للسيرفر وبعدها يبلّغ الغرفة. النسخة السريعة كانت توصل صفحة الآيفون قبل إشعار اللاسلكي، وتطبيق الآيفون ما يشغّل الرسالة.
  const WS = window.WebSocket && window.WebSocket.prototype;
  if(WS && !WS.__dalNoLive){
    const send = WS.send;
    WS.send = function(d){ if(typeof d === 'string' && d.indexOf('"event":"voice_live"') > 0 && d.indexOf('"type":"broadcast"') > 0){ stat.noLive = (stat.noLive || 0) + 1; return; } return send.apply(this, arguments); };
    WS.__dalNoLive = 1;
  }
})();
