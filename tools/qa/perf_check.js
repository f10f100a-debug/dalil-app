// فحص السرعة والطبقات (22 نوفمبر) — بعد يوم ثقّل فيه التنقل (تاريخ ينحسب كل ثانية ونص والخريطة شغالة وهي مخفية)
// ويوم اختفت فيه بطاقة الربيع. يقيس:
//   1) شغل الخريطة وهي مخفية ورا البوصلة (لازم تقريبًا صفر)   2) شغلها وهي قدامك بدون حركة
//   3) وقت التنقل بين الأيقونات والخريطة                      4) الخريطة مع وجهة محفوظة: بطاقة الربيع وطبقته تطلع بدون أخطاء
//   BASE=http://localhost:8804 OUT=qa-out node tools/qa/perf_check.js   → exit 1 إذا فيه مشكلة، والتقرير في OUT/perf-qa.md
//   SPRING_DIR=<نسخة من فرع spring-data> (اختياري، للتجربة بدون نت)
const {chromium} = require('playwright');
const fs = require('fs'), path = require('path');
const BASE = process.env.BASE || 'http://localhost:8804';
const OUT = process.env.OUT || 'qa-out';
const SD = process.env.SPRING_DIR;
// الحدود (ملّي ثانية شغل جافاسكربت في 10 ثواني) — فيها مجال؛ قبل الإصلاح كانت ~3000 للحالتين
const LIM = {hidden: 400, visible: 1500, tab: +(process.env.TAB_LIM || 900)};   // أجهزة GitHub أبطأ: TAB_LIM=2000
fs.mkdirSync(OUT, {recursive: true});
const fails = [], notes = [];
const ARGS = ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'];

async function ctxOf(b, layers){
  const c = await b.newContext({viewport:{width:400, height:860}, serviceWorkers:'block', geolocation:{latitude:28.58, longitude:44.47}, permissions:['geolocation']});
  await c.route(/fonts\.goog|supabase|gstatic/, r=>r.abort());
  if(SD) await c.route(/raw\.githubusercontent\.com\/f10f100a-debug\/dalil-app\/spring-data\//, r=>{
    const f = path.join(SD, new URL(r.request().url()).pathname.split('/spring-data/')[1]);
    if(fs.existsSync(f)) r.fulfill({body:fs.readFileSync(f), headers:{'access-control-allow-origin':'*', 'content-type':f.endsWith('json')?'application/json':f.endsWith('png')?'image/png':'image/webp'}});
    else r.fulfill({status:404, headers:{'access-control-allow-origin':'*'}});
  });
  await c.addInitScript(l=>{for(const k of ['dalil_onboarded','dalil_install_guide_seen','dalil_permissions_ready'])localStorage.setItem(k,'1');localStorage.setItem('dalil_map_layers', JSON.stringify(l))}, layers);
  return c;
}
async function busy(cdp, p, ms){   // شغل جافاسكربت (بدون الخمول) خلال ms
  await cdp.send('Profiler.start'); await p.waitForTimeout(ms);
  const {profile} = await cdp.send('Profiler.stop'); const by = {}; profile.nodes.forEach(n=>by[n.id]=n);
  let t = 0, top = {};
  profile.samples.forEach((id, i)=>{const f = by[id].callFrame; if(/^\((idle|program|garbage collector)\)$/.test(f.functionName))return;
    const d = (profile.timeDeltas[i] || 0) / 1000; t += d; const k = (f.functionName || '(anon)') + ' ' + f.url.split('/').pop().split('?')[0] + ':' + f.lineNumber; top[k] = (top[k] || 0) + d});
  return [Math.round(t), Object.entries(top).sort((a, b)=>b[1]-a[1]).slice(0, 3).map(([k, v])=>k + ' ' + Math.round(v) + 'ms').join(' · ')];
}
(async()=>{
  const b = await chromium.launch({args:ARGS});
  try{
    // 1–3: التطبيق كامل
    const c = await ctxOf(b, {ndvi:true});
    const p = await c.newPage(); const errs = []; p.on('pageerror', e=>errs.push(e.message));
    await p.goto(BASE + '/index.html'); await p.waitForTimeout(9000);
    await p.click('.tab[data-screen="track"]'); await p.waitForTimeout(5000);
    const cdp = await c.newCDPSession(p); await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', {interval:500});
    await p.click('.tab[data-screen="compass"]'); await p.waitForTimeout(2500);
    const [h, ht] = await busy(cdp, p, 10000);
    notes.push(`الخريطة مخفية ورا البوصلة: ${h} م.ث شغل في 10 ثواني (الحد ${LIM.hidden})` + (ht ? ` — ${ht}` : ''));
    if(h > LIM.hidden) fails.push(`الخريطة تشتغل وهي مخفية: ${h} م.ث في 10 ثواني (الحد ${LIM.hidden}) — ${ht}`);
    await p.click('.tab[data-screen="track"]'); await p.waitForTimeout(3000);
    const [v, vt] = await busy(cdp, p, 10000);
    notes.push(`الخريطة قدامك بدون حركة: ${v} م.ث (الحد ${LIM.visible})` + (vt ? ` — ${vt}` : ''));
    if(v > LIM.visible) fails.push(`الخريطة ثقيلة وهي واقفة: ${v} م.ث في 10 ثواني (الحد ${LIM.visible}) — ${vt}`);
    const times = [];
    for(const s of ['compass', 'track', 'places', 'track', 'weather', 'track', 'settings', 'track']){
      times.push(await p.evaluate(async s=>{const el = document.querySelector('.tab[data-screen="' + s + '"]'); const t0 = performance.now(); el.click();
        await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))); return Math.round(performance.now() - t0)}, s));
      await p.waitForTimeout(700);
    }
    const mx = Math.max(...times), md = times.slice().sort((a, b)=>a-b)[times.length >> 1];
    notes.push(`التنقل بين الأيقونات: الوسيط ${md} م.ث، الأبطأ ${mx} م.ث (الحد ${LIM.tab}) [${times.join(', ')}]`);
    if(mx > LIM.tab) fails.push(`التنقل بطيء: أبطأ نقلة ${mx} م.ث (الحد ${LIM.tab}) [${times.join(', ')}]`);
    for(const e of [...new Set(errs)]) fails.push('التطبيق: خطأ برمجي: ' + e.slice(0, 160));
    await c.close();
    // 4: الخريطة مع وجهة (فيضة طراح) — لازم تطلع بطاقة الربيع وطبقته
    const c2 = await ctxOf(b, {ndvi:true});
    const q = await c2.newPage(); const e2 = []; q.on('pageerror', e=>e2.push(e.message));
    await q.goto(BASE + '/map.html?lat=28.5795&lng=44.4727&label=' + encodeURIComponent('فيضة طراح')); await q.waitForTimeout(20000);
    const st = await q.evaluate(()=>{const l = document.getElementById('sprLegend');
      return {lg:!!l && l.style.display !== 'none', ly:typeof gl !== 'undefined' && ['spr-', 'sprt-c'].some(k=>gl.getStyle().layers.some(x=>x.id.startsWith(k) && gl.getLayoutProperty(x.id, 'visibility') === 'visible'))}});
    notes.push(`خريطة مع وجهة: بطاقة الربيع ${st.lg ? 'ظاهرة' : 'مختفية'} · الطبقة ${st.ly ? 'ظاهرة' : 'مختفية'}`);
    if(!st.lg) fails.push('بطاقة طبقة الربيع ما طلعت (الخريطة مع وجهة محفوظة)');
    if(!st.ly) fails.push('طبقة الربيع ما طلعت على الخريطة عند فيضة طراح');
    for(const e of [...new Set(e2)]) fails.push('الخريطة: خطأ برمجي: ' + e.slice(0, 160));
    await c2.close();
  }catch(e){ fails.push('تعذّر فحص السرعة: ' + String(e).slice(0, 200)); }
  await b.close();
  const rep = (fails.length ? `فحص السرعة ${new Date().toISOString().slice(0, 10)}: ${fails.length} مشكلة\n\n` + fails.map(x=>'- ' + x).join('\n') : 'فحص السرعة: كله سليم') + '\n\n' + notes.map(x=>'- ' + x).join('\n') + '\n';
  fs.writeFileSync(path.join(OUT, 'perf-qa.md'), rep); console.log(rep);
  process.exit(fails.length ? 1 : 0);
})();
