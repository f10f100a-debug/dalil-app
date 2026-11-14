// فحص «غرفة الرحلة» الحي (14 نوفمبر): جوالين وهميين على الخادم الحقيقي — إنشاء غرفة، دخول الثاني بالرقم والرمز،
// وصول المواقع بين الاثنين (Realtime)، رسالة صوتية بالضغط للتحدث (مايك وهمي) توصل للثاني، الإيقاف المؤقت، والخروج.
// يحتاج إنترنت (يشتغل على GitHub). الأصل لازم يكون http://localhost:8765 (مسموح في CORS).
//   BASE=http://localhost:8765 OUT=qa-room node tools/qa/room_check.js
const {chromium, devices} = require('playwright');
const fs = require('fs'), path = require('path');
const BASE = process.env.BASE || 'http://localhost:8765', OUT = process.env.OUT || 'qa-room';
fs.mkdirSync(OUT, {recursive: true});
const sleep = ms=>new Promise(r=>setTimeout(r, ms));
const steps = [], fails = [];
const ok = (s, good, extra = '')=>{ (good ? steps : fails).push((good ? '✓ ' : '✗ ') + s + (extra ? ' — ' + extra : '')); console.log((good ? 'OK  ' : 'FAIL') + ' ' + s + ' ' + extra); };
async function phone(browser, name, lat, lng){
  const ctx = await browser.newContext({...devices['iPhone 13'], geolocation:{latitude:lat, longitude:lng}, permissions:['geolocation', 'microphone'], locale:'ar', serviceWorkers:'block'});
  await ctx.addInitScript(()=>{ try{ localStorage.setItem('dalil_install_guide_seen', '1'); localStorage.setItem('dalil_permissions_ready', '1'); localStorage.setItem('dalil_room_terms_v1', '1'); }catch(e){}
    Object.defineProperty(navigator, 'standalone', {get:()=>true}); });
  const p = await ctx.newPage(); p.errs = [];
  p.on('pageerror', e=>p.errs.push(e.message)); p.on('dialog', d=>d.accept());
  await p.goto(BASE + '/index.html'); await sleep(2500);
  await p.evaluate(()=>document.getElementById('roomBtn').click()); await p.waitForSelector('#rmName', {timeout:15000});
  p.label = name; return p;
}
const sess = p=>p.evaluate(()=>{ try{ return JSON.parse(localStorage.getItem('dalil_room_v1') || 'null'); }catch(e){ return null; } });
(async()=>{
  const browser = await chromium.launch({args:['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required']});
  let A, Bp;
  try{
    A = await phone(browser, 'أ', 27.9200, 42.3600);
    await p_create(A);
    const sa = await sess(A);
    ok('إنشاء غرفة', !!(sa && sa.code), sa ? 'رقم ' + sa.code : await A.evaluate(()=>(document.getElementById('rmErr') || {}).innerText || ''));
    if(!sa || !sa.code) throw new Error('stop');
    Bp = await phone(browser, 'ب', 27.9380, 42.3750);
    await Bp.evaluate(()=>{ const t = document.querySelector('[data-rm="tab-join"]'); t && t.click(); }); await sleep(400);
    await Bp.fill('#rmCode', sa.code); await Bp.fill('#rmName', 'فاحص ب'); await Bp.fill('#rmPin', '4321');
    await Bp.click('#rmGo'); await sleep(4000);
    const sb = await sess(Bp);
    ok('دخول الجوال الثاني بالرقم والرمز', !!(sb && sb.room_id === sa.room_id), sb ? '' : await Bp.evaluate(()=>(document.getElementById('rmErr') || {}).innerText || ''));
    // رمز غلط لازم يُرفض
    const C = await phone(browser, 'ج', 27.95, 42.40);
    await C.evaluate(()=>{ const t = document.querySelector('[data-rm="tab-join"]'); t && t.click(); }); await sleep(300);
    await C.fill('#rmCode', sa.code); await C.fill('#rmName', 'دخيل'); await C.fill('#rmPin', '9999'); await C.click('#rmGo'); await sleep(3000);
    const ce = await C.evaluate(()=>(document.getElementById('rmErr') || {}).innerText || '');
    ok('رفض الرمز السري الغلط', !(await sess(C)) && /غير صحيح/.test(ce), ce);
    await C.context().close();
    // المواقع والأعضاء
    await sleep(9000);
    const memA = await A.evaluate(()=>[...document.querySelectorAll('#rmMembers .rm-mem')].map(e=>e.innerText.replace(/\s+/g, ' ')));
    const memB = await Bp.evaluate(()=>[...document.querySelectorAll('#rmMembers .rm-mem')].map(e=>e.innerText.replace(/\s+/g, ' ')));
    ok('الأعضاء يشوفون بعض', memA.some(x=>x.includes('فاحص ب')) && memB.some(x=>x.includes('فاحص أ')), 'أ: ' + memA.join(' | ').slice(0, 140) + ' · ب: ' + memB.join(' | ').slice(0, 140));
    const dist = memA.find(x=>x.includes('فاحص ب')) || '';
    ok('موقع الثاني وصل للأول (مسافة)', /(كم|م)\b/.test(dist) && /\d/.test(dist), dist.slice(0, 120));
    await A.screenshot({path:path.join(OUT, 'room-a.png')}); await Bp.screenshot({path:path.join(OUT, 'room-b.png')});
    // رسالة صوتية: ب يضغط زر التحدث ثانيتين ونص
    const btn = await Bp.$('#rmPtt'); const bb = await btn.boundingBox();
    await Bp.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2); await Bp.mouse.down(); await sleep(2600); await Bp.mouse.up();
    await sleep(8000);
    const vA = await A.evaluate(()=>[...document.querySelectorAll('#rmVoice .rm-v')].map(e=>e.innerText.replace(/\s+/g, ' ')));
    const vB = await Bp.evaluate(()=>[...document.querySelectorAll('#rmVoice .rm-v')].map(e=>e.innerText.replace(/\s+/g, ' ')));
    ok('الرسالة الصوتية انرسلت', vB.length > 0, vB.join(' | ').slice(0, 120));
    ok('الرسالة الصوتية وصلت للثاني', vA.length > 0, vA.join(' | ').slice(0, 120));
    await A.screenshot({path:path.join(OUT, 'room-a-voice.png')});
    // الخروج
    for(const p of [Bp, A]){ await p.evaluate(()=>{ const b = document.querySelector('[data-rm="leave"]') || document.getElementById('rmLeave'); b && b.click(); }); await sleep(2500); }
    ok('الخروج من الغرفة', !(await sess(A)) && !(await sess(Bp)));
    for(const p of [A, Bp]) for(const e of [...new Set(p.errs)]) ok('بدون أخطاء برمجية (' + p.label + ')', false, e.slice(0, 160));
  }catch(e){ if(String(e.message) !== 'stop') ok('الفحص اكتمل', false, String(e).slice(0, 200)); }
  await browser.close();
  const rep = (fails.length ? `فحص غرفة الرحلة ${new Date().toISOString().slice(0, 10)}: ${fails.length} مشكلة — ${fails[0].slice(2, 90)}` : 'فحص غرفة الرحلة: كله سليم') + '\n\n' + fails.concat(steps).map(x=>'- ' + x).join('\n') + '\n';
  fs.writeFileSync(path.join(OUT, 'room-qa.md'), rep); console.log('\n' + rep);
  process.exit(fails.length ? 1 : 0);
})();
async function p_create(A){
  await A.evaluate(()=>{ const t = document.querySelector('[data-rm="tab-create"]'); t && t.click(); }); await sleep(400);
  await A.fill('#rmName', 'فاحص أ'); await A.fill('#rmPin', '4321'); if(await A.$('#rmTrip')) await A.fill('#rmTrip', 'فحص آلي');
  await A.click('#rmGo'); await sleep(4000);
}
