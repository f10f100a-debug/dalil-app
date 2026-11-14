// فاحص الشاشات الآلي (14 نوفمبر): يفتح التطبيق على جوال آيفون وهمي في عدة مواقع، يمر على كل التبويبات، ويفحص
// التناقضات اللي كان أبو مالك يلقاها بعينه: عنوان الربيع يناقض القائمة، فيضة «مثل المعتاد» ونسبتها تحت 20٪، سطور مكررة،
// بطاقات الفياض تحت الطيور/الفقع، «undefined/NaN» ظاهرة، وأخطاء JavaScript. يحفظ صور الشاشات.
//   BASE=http://localhost:8804 OUT=qa-out node tools/qa/ui_check.js   → exit 1 إذا فيه خطأ، والتقرير في OUT/ui-qa.md
const {chromium, devices} = require('playwright');
const fs = require('fs'), path = require('path');
const BASE = process.env.BASE || 'http://localhost:8804';
const OUT = process.env.OUT || 'qa-out';
const SPOTS = [['بقعاء', 27.92, 42.36], ['الرياض', 24.71, 46.67], ['حائل', 27.52, 41.69], ['جازان', 16.89, 42.55], ['أم العصافير', 29.19, 43.56]];
const LEVEL_GREEN = ['بداية اخضرار', 'ربيع متوسط', 'ربيع جيد'];
const PILL_STRONG = ['مثل المعتاد', 'أخضر من المعتاد', 'أخضر من المعتاد بكثير'];
fs.mkdirSync(OUT, {recursive: true});
const sleep = ms=>new Promise(r=>setTimeout(r, ms));
(async()=>{
  const browser = await chromium.launch();
  const fails = [], notes = [];
  for(const [name, lat, lng] of SPOTS){
    const ctx = await browser.newContext({...devices['iPhone 13'], geolocation:{latitude:lat, longitude:lng}, permissions:['geolocation'], locale:'ar', serviceWorkers:'block'});
    // مثل التطبيق المثبّت: بدون شاشة «ثبّت دليل»
    await ctx.addInitScript(()=>{ try{ localStorage.setItem('dalil_install_guide_seen', '1'); localStorage.setItem('dalil_permissions_ready', '1'); }catch(e){} Object.defineProperty(navigator, 'standalone', {get:()=>true}); });
    const p = await ctx.newPage(); const errs = [];
    p.on('pageerror', e=>errs.push(e.message));
    // الشبكة الخارجية مقفولة (نتيجة ثابتة) — نفحص منطق التطبيق على بيانات المستودع نفسها
    await p.route(u=>!String(u).startsWith(BASE), r=>r.abort());
    // برد تجريبي (عواصف متفرقة بمنطقة مكة) — نفحص التسمية والتكرار
    const HL = [[21.3,39.0],[21.25,39.05],[20.9,39.4],[21.6,39.9],[20.5,40.3]].map((x,i)=>({lat:x[0],lng:x[1],t:new Date(Date.now()-i*1800e3).toISOString(),dbz:57,region:'مكة',rep:0,src:'radar'}));
    await p.route(/rpc\/recent_hail/, r=>r.fulfill({status:200, contentType:'application/json', body:JSON.stringify(HL)}));
    const F = (m)=>fails.push(`${name}: ${m}`);
    try{
      await p.goto(BASE + '/index.html', {waitUntil:'load'}); await sleep(2500);
      const shot = async k=>{ await p.screenshot({path:path.join(OUT, `${name}-${k}.png`), fullPage:false}); };
      const bodyBad = async k=>{ const t = await p.evaluate(()=>document.querySelector('.screen.active') ? document.querySelector('.screen.active').innerText : document.body.innerText);
        const m = t.match(/.{0,30}\b(undefined|NaN|null)\b.{0,30}/); if(m) F(`${k}: نص مكسور «${m[0].replace(/\n/g, ' ')}»`); };
      const dupes = async (sel, k)=>{ const rows = await p.$$eval(sel, a=>a.filter(e=>e.offsetParent).map(e=>e.innerText.replace(/\s+/g, ' ').trim()));
        const seen = new Set(); for(const r of rows){ if(r && seen.has(r)) F(`${k}: سطر مكرر «${r.slice(0, 60)}»`); seen.add(r); } };
      // البوصلة
      await shot('compass'); await bodyBad('البوصلة');
      // البر → الفياض
      await p.evaluate(()=>document.querySelector('[data-barr]').click()); await sleep(1200);
      await p.evaluate(()=>{ const b = document.querySelector('[data-barrb="fayd"]'); b && b.click(); }); await sleep(3500);
      await shot('fayd'); await bodyBad('الفياض'); await dupes('.fy-row', 'قائمة الفياض');
      const sp = await p.evaluate(()=>{ const b = document.getElementById('springBody'); const big = b && b.querySelector('.big'); return {lvl:big ? big.innerText.trim() : '', txt:b ? b.innerText : ''}; });
      if(LEVEL_GREEN.includes(sp.lvl)){
        const m = sp.txt.match(/على بعد ([\d.]+) كم/); if(m && Number(m[1]) > 10) F(`بطاقة الربيع: «${sp.lvl}» والفيضة على بعد ${m[1]} كم (لازم «حولك ما اخضرّ»)`);
      }
      const rows = await p.$$eval('#faydList .fy-row', a=>a.map(e=>({t:e.innerText.replace(/\s+/g, ' '), pill:(e.querySelector('.fy-pill') || {}).innerText || ''})));
      for(const r of rows){ const m = r.t.match(/\+(\d+)٪/); if(m && PILL_STRONG.includes(r.pill.trim()) && Number(m[1]) < 20) F(`قائمة الفياض: «${r.pill.trim()}» ونسبتها ${m[1]}٪ — «${r.t.slice(0, 50)}»`); }
      // البر → الفقع والطيور: ما يطلع فيها شي يخص الفياض
      for(const [k, ar] of [['fq', 'الفقع'], ['birds', 'الطيور']]){
        await p.evaluate(k=>{ const b = document.querySelector('[data-barrb="' + k + '"]'); b && b.click(); }, k); await sleep(1500);
        const leak = await p.evaluate(()=>['.sp-card', '#springMap', '#springCopernicus', '#faydCard'].filter(s=>{ const e = document.querySelector(s); return e && e.offsetParent; }));
        if(leak.length) F(`${ar}: يطلع فيه شي من الفياض (${leak.join(' ')})`);
        await shot(k); await bodyBad(ar);
        if(k === 'birds'){ await dupes('.br-row', 'الطيور'); const nost = await p.$$eval('.br-row', a=>a.filter(e=>!e.querySelector('.fy-pill')).length); if(nost) F(`الطيور: ${nost} طير بدون حالة`); }
      }
      // الأجواء
      await p.evaluate(()=>{ const t = document.querySelector('.tab[data-screen="weather"]'); t && t.click(); }); await sleep(1500);
      await p.evaluate(()=>{ const h = document.getElementById('hailCard'); h && h.scrollIntoView(); }); await sleep(2500);
      await shot('weather'); await bodyBad('الأجواء'); await dupes('#hailCard .hl-row', 'البرد');
      const hn = await p.$$eval('#hailCard .hl-row b', a=>a.map(e=>e.innerText.trim()));
      const rg = hn.filter(x=>x === 'مكة' || x === 'منطقة مفتوحة'); if(rg.length > 1) F(`البرد: ${rg.length} سطور باسم المنطقة بس («${rg[0]}») بدل اسم مكان`);
      if(!hn.length) notes.push(name + ': بطاقة البرد ما ظهرت');
      // الأماكن والخريطة
      for(const s of ['places', 'track']){ await p.evaluate(s=>{ const t = document.querySelector('.tab[data-screen="' + s + '"]'); t && t.click(); }, s); await sleep(1500); await shot(s); await bodyBad(s === 'places' ? 'الأماكن' : 'الخريطة'); }
      for(const e of [...new Set(errs)]) F('خطأ برمجي: ' + e.slice(0, 160));
      notes.push(`${name}: ${rows.length} فيضة بالقائمة · الربيع «${sp.lvl}»`);
    }catch(e){ F('تعذّر الفحص: ' + String(e).slice(0, 160)); }
    await ctx.close();
  }
  await browser.close();
  const rep = (fails.length ? `فحص الشاشات ${new Date().toISOString().slice(0, 10)}: ${fails.length} مشكلة\n\n` + fails.map(x=>'- ' + x).join('\n') : 'فحص الشاشات: كله سليم') + '\n\n' + notes.map(x=>'- ' + x).join('\n') + '\n';
  fs.writeFileSync(path.join(OUT, 'ui-qa.md'), rep); console.log(rep);
  process.exit(fails.length ? 1 : 0);
})();
