// يعيد تشغيل تنبيه المطر على بيانات الرادار الحقيقية لموقع معيّن، كأن الوقت هو T (آخر صورة ≤ T)
const { chromium } = require('playwright');
const [lat, lng] = (process.env.POS || '27.9196,42.3619').split(',').map(Number);
const URL = process.env.PAGE || 'https://f10f100a-debug.github.io/dalil-app/index.html';
(async()=>{
  const real = await (await fetch('https://api.rainviewer.com/public/weather-maps.json')).json();
  const times = real.radar.past.map(f=>f.time);
  const fmt = t=>new Date((t+3*3600)*1000).toISOString().slice(11,16);
  console.log('frames:', times.map(fmt).join(' '));
  const ends = times.slice(5);  // نحتاج 4 صور على الأقل قبل كل لحظة
  const b = await chromium.launch();
  for(const T of ends){
    const ctx = await b.newContext({geolocation:{latitude:lat, longitude:lng}, permissions:['geolocation'], viewport:{width:390, height:844}});
    await ctx.route('https://api.rainviewer.com/**', r=>r.fulfill({contentType:'application/json', body:JSON.stringify({...real, radar:{...real.radar, past:real.radar.past.filter(f=>f.time<=T)}})}));
    await ctx.addInitScript(()=>localStorage.setItem('dalil_permissions_ready','1'));
    const p = await ctx.newPage(); const errs = []; p.on('pageerror', e=>errs.push(e.message));
    await p.goto(URL + '?t=' + Date.now());
    let txt = '';
    for(let i = 0; i < 40 && !txt; i++){ await p.waitForTimeout(1000); txt = await p.evaluate(()=>{ const c = document.getElementById('stormCard'); return c && !c.hidden ? c.textContent : ''; }); }
    console.log(fmt(T), '|', txt.replace(/[⁦-⁩]/g,'').replace(/\s+/g,' ').trim(), errs.length ? 'ERR ' + errs[0] : '');
    await ctx.close();
  }
  await b.close();
})();
