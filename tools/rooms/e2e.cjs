// اختبار واجهة غرفة الرحلة بمتصفحين حقيقيين (Playwright) ضد خادم Supabase الفعلي.
// يشغَّل في GitHub Actions: يخدم المستودع على localhost:8765 ثم يحاكي مستخدمَين.
const { chromium } = require('playwright');
const fs = require('fs');
const OUT = process.env.SHOTS || 'shots';
fs.mkdirSync(OUT, { recursive: true });
let fails = 0; const passed = [];
const ok = (c, msg) => { if (c) passed.push(msg.slice(0, 60)); else { console.log(`::error::✗ ${msg}`); fails++; } };

async function user(browser, name, lat, lng) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: 'ar-SA',
    geolocation: { latitude: lat, longitude: lng }, permissions: ['geolocation', 'microphone', 'clipboard-read', 'clipboard-write'] });
  const p = await ctx.newPage();
  if(name === 'بدر') await p.addInitScript(() => localStorage.setItem('dalil_car', JSON.stringify({lat:27.5560, lng:41.7200, time:Date.now()})));
  p.errors = [];
  p.on('dialog', d => d.accept().catch(() => {}));
  p.on('pageerror', e => p.errors.push(e.message));
  p.on('console', m => { if (m.type() === 'error' && !/pmtiles|Byte Serving|tile|Failed to load resource/i.test(m.text())) p.errors.push(m.text()); });
  await p.goto('http://localhost:8765/index.html?roombeta=1');
  await p.waitForTimeout(1500);
  if (await p.isVisible('#onboardBtn')) await p.click('#onboardBtn');
  await p.waitForTimeout(1500);
  await p.click('#roomBtn');
  await p.waitForSelector('#rmName');
  await p.fill('#rmName', name);
  p.label = name;
  return p;
}
const shot = (p, n) => p.screenshot({ path: `${OUT}/${n}.png` });

(async () => {
  const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
  const A = await user(browser, 'أحمد', 27.5200, 41.6900);
  const B = await user(browser, 'بدر', 27.5530, 41.7150);   // ~4.4 كم: يجب أن يظهر تنبيه القافلة

  // إنشاء الغرفة
  await A.click('[data-rm="tab-create"]');
  await A.fill('#rmName', 'أحمد');
  await A.fill('#rmTrip', 'كشتة الاختبار');
  await A.fill('#rmPin', '4321');
  await A.check('#rmTerms');
  await A.click('#rmGo');
  await A.waitForSelector('.rm-code', { timeout: 15000 }).catch(() => {});
  const code = (await A.textContent('.rm-code').catch(() => '')) || '';
  ok(/^\d{6}$/.test(code.trim()), `room created code=${code}`);
  await A.waitForTimeout(2500);
  await shot(A, '1-A-created');

  // دخول B
  await B.fill('#rmCode', code.trim());
  await B.fill('#rmPin', '4321');
  await B.check('#rmTerms');
  await B.click('#rmGo');
  await B.waitForSelector('.rm-code', { timeout: 15000 }).catch(() => {});
  await B.waitForTimeout(9000);
  const aMem = await A.textContent('#rmMembers').catch(() => '');
  const bMem = await B.textContent('#rmMembers').catch(() => '');
  ok(aMem.includes('بدر') && /كم|م ·/.test(aMem), `A sees B with distance: ${aMem.replace(/\s+/g, ' ').slice(0, 120)}`);
  ok(bMem.includes('أحمد'), `B sees A`);
  ok(/بعيد عن القافلة/.test(aMem), 'convoy lag shown');
  ok(/سيارته/.test(aMem), `A sees B's car: ${aMem.replace(/\s+/g, ' ').slice(0, 160)}`);
  ok((await A.textContent('#rmLive')).includes('متصل'), 'A realtime connected');
  await shot(A, '2-A-members'); await shot(B, '2-B-members');

  // تنبيهات الغرفة: حفظ رمز وهمي ثم استغاثة (السيرفر يقبلها حتى لو رفضت Apple الرمز)
  const pushRes = await A.evaluate(async () => { const s = JSON.parse(localStorage.getItem('dalil_room_sess') || localStorage.getItem('dalil_room') || 'null'); return s; });
  const sessA = await A.evaluate(() => { for (const k of Object.keys(localStorage)) { try { const v = JSON.parse(localStorage.getItem(k)); if (v && v.room_id && v.token) return v; } catch (e) {} } return null; });
  const call = (a, body) => A.evaluate(async ([a, body]) => (await fetch('https://penhpgvjtxytgyrhmetg.supabase.co/functions/v1/dalil-rooms?a=' + a, { method: 'POST', headers: { apikey: 'sb_publishable_WUbfRD9na71sHZ1rxFwImQ_JGzDOyXw', 'content-type': 'application/json' }, body: JSON.stringify(body) })).json(), [a, body]);
  const auth = sessA && { room_id: sessA.room_id, member_id: sessA.member_id, token: sessA.token };
  ok(auth && (await call('push', { ...auth, push_token: 'ab'.repeat(32) })).ok, 'push token saved');
  ok(auth && (await call('push', { ...auth, push_token: 'zz' })).error === 'bad_token', 'bad push token rejected');
  ok(auth && (await call('sos', auth)).ok, 'sos action ok');
  // 1.4: رمز اللاسلكي (PushToTalk)
  ok(auth && (await call('ptt', { ...auth, ptt_token: 'cd'.repeat(32) })).ok, 'ptt token saved');
  ok(auth && (await call('ptt', { ...auth, ptt_token: 'xyz' })).error === 'bad_token', 'bad ptt token rejected');
  ok(auth && (await call('ptt', { ...auth, ptt_token: '' })).ok, 'ptt token cleared');
  // 1.3: موقع B من الخلفية (كما يرسله تطبيق الآيفون) يصل لـ A عبر السيرفر
  const bg = await B.evaluate(() => window.DalilRoom.bgAuth());
  ok(bg && /a=bgpos/.test(bg.url), 'bgAuth ready');
  const bgRes = await B.evaluate(async (bg) => (await fetch(bg.url, { method: 'POST', headers: { apikey: bg.key, 'content-type': 'application/json' },
    body: JSON.stringify({ room_id: bg.room_id, member_id: bg.member_id, token: bg.token, lat: 27.5531, lng: 41.7151, acc: 12, spd: 15 }) })).json(), bg);
  ok(bgRes && bgRes.ok, `bgpos broadcast ${JSON.stringify(bgRes)}`);
  let aBg = '';
  for (let i = 0; i < 20 && !aBg.includes('54 كم/س'); i++) { await A.waitForTimeout(250); aBg = await A.textContent('#rmMembers').catch(() => ''); }
  ok(aBg.includes('54 كم/س'), `A got background position: ${aBg.replace(/\s+/g, ' ').slice(0, 140)}`);
  ok(/سيارته/.test(aBg), 'car kept after background position');
  // 1.3: رابط dalil://room يفتح نافذة الدخول معبّأة
  const C = await (await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'ar-SA' })).newPage();
  C.errors = []; C.label = 'deeplink'; C.on('pageerror', e => C.errors.push(e.message));
  await C.goto('http://localhost:8765/index.html?roombeta=1'); await C.waitForTimeout(2500);
  if (await C.isVisible('#onboardBtn')) await C.click('#onboardBtn');
  const opened = await C.evaluate((c) => window.__dalilOpenUrl('dalil://room?code=' + c + '&pin=4321'), code.trim());
  await C.waitForSelector('#rmCode', { timeout: 8000 }).catch(() => {});
  await C.waitForTimeout(800);
  const dl = await C.evaluate(() => [document.getElementById('rmCode')?.value, document.getElementById('rmPin')?.value]);
  ok(opened === true && dl[0] === code.trim() && dl[1] === '4321', `deep link prefills join: ${JSON.stringify([opened, dl])}`);
  await shot(C, '2b-deeplink');
  ok(C.errors.length === 0, `deeplink page no JS errors ${C.errors.slice(0, 2).join(' | ')}`);
  await C.context().close();
  // صوت: B يضغط مطوّلًا 2.5 ثانية
  const box = await B.locator('#rmPtt').boundingBox();
  await B.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await B.mouse.down();
  await B.waitForTimeout(1200);
  await shot(B, '3-B-recording');
  await B.waitForTimeout(1500);
  await B.mouse.up(); const tUp = Date.now();
  let aVoice = '';
  for (let i = 0; i < 80 && !aVoice.includes('بدر'); i++) { await A.waitForTimeout(250); aVoice = await A.textContent('#rmVoice').catch(() => ''); }
  ok(true, `voice delivered in ${((Date.now() - tUp) / 1000).toFixed(1)}s`);
  const bVoice = await B.textContent('#rmVoice').catch(() => '');
  ok(bVoice.includes('أنت'), `B sees own voice: ${bVoice.replace(/\s+/g, ' ').slice(0, 80)}`);
  ok(aVoice.includes('بدر'), `A received voice: ${aVoice.replace(/\s+/g, ' ').slice(0, 80)}`);
  await shot(A, '3-A-voice');

  // نقطة التجمع من A
  await A.click('[data-rm="rally-set"]');
  await A.click('[data-mm="rally-here"]');
  let bRally = '';
  for (let i = 0; i < 15 && !bRally.includes('أحمد'); i++) { await B.waitForTimeout(1000); bRally = await B.textContent('#rmRally').catch(() => ''); }
  ok(bRally.includes('أحمد'), `B sees rally: ${bRally.replace(/\s+/g, ' ').slice(0, 80)}`);
  await shot(B, '4-B-rally');

  // التوجّه لعضو بالبوصلة
  await B.click(`#rmMembers [data-rm="nav"]`);
  await B.waitForTimeout(1500);
  await shot(B, '5-B-compass-nav');

  // الخريطة
  await B.click('#roomBtn');
  await B.click('[data-rm="map"]');
  await B.waitForTimeout(6000);
  await shot(B, '6-B-map');

  // استغاثة من A (ضغط مطوّل)
  const sb = await A.locator('#rmSos').boundingBox();
  await A.mouse.move(sb.x + sb.width / 2, sb.y + sb.height / 2);
  await A.mouse.down(); await A.waitForTimeout(1400); await A.mouse.up();
  await B.waitForTimeout(3000);
  ok(await B.isVisible('#rmSosAlert.show'), 'B got SOS alert');
  await shot(B, '7-B-sos');
  await shot(A, '7-A-sos');

  // محرك النغمات ما يبقى شغال: يتوقف بعد 20 ث بدون نغمات (لو بقى يصرف البطارية في الخلفية)
  { const st0 = await B.evaluate(() => window.__dalilToneState && window.__dalilToneState());
    await B.waitForTimeout(22000);
    const st1 = await B.evaluate(() => window.__dalilToneState && window.__dalilToneState());
    ok(st1 !== 'running', 'tone engine sleeps when idle (' + st0 + ' → ' + st1 + ')'); }

  // إيقاف مؤقت (صلاة/اجتماع): A يوقف 15 د → ما يشتغل صوت، B يشوفه «متوقف»، الرسالة تنحفظ ويسمعها لما يرجع
  for (const p of [A, B]) { await p.evaluate(() => { const s = document.getElementById('rmSosAlert'); if (s) s.classList.remove('show'); window.DalilRoom.open(); }); }
  await A.waitForTimeout(800);
  await A.click('#rmSos'); await A.waitForTimeout(800);   // نلغي استغاثة A (الإيقاف ممنوع وأنت مستغيث)
  ok(auth && (await call('pause', { ...auth, minutes: 90 })).error === 'bad_request', 'pause > 60 min rejected');
  await A.click('[data-rm="pause"]'); await A.waitForTimeout(400);
  await shot(A, '8a-A-pause-menu');
  await A.click('[data-mm="pause"][data-arg="15"]'); await A.waitForTimeout(1500);
  ok((await A.textContent('#rmPauseBar').catch(() => '')).includes('متوقف مؤقتًا'), 'A paused bar shown');
  ok(await A.evaluate(() => window.DalilRoom.bgAuth() === null), 'paused: background location/PTT off (bgAuth null)');
  let bPz = '';
  for (let i = 0; i < 30 && !bPz.includes('متوقف مؤقتًا'); i++) { await B.waitForTimeout(250); bPz = await B.textContent('#rmMembers').catch(() => ''); }
  ok(bPz.includes('متوقف مؤقتًا'), `B sees A paused: ${bPz.replace(/\s+/g, ' ').slice(0, 120)}`);
  await shot(B, '8b-B-sees-paused');
  { const pb = await B.locator('#rmPtt').boundingBox();
    await B.mouse.move(pb.x + pb.width / 2, pb.y + pb.height / 2); await B.mouse.down(); await B.waitForTimeout(2200); await B.mouse.up(); }
  let aPz = '';
  for (let i = 0; i < 60 && !aPz.includes('وصلتك'); i++) { await A.waitForTimeout(250); aPz = await A.textContent('#rmPauseBar').catch(() => ''); }
  ok(aPz.includes('وصلتك رسالة'), `A paused got message saved (not played): ${aPz.replace(/\s+/g, ' ').slice(0, 80)}`);
  await shot(A, '8c-A-paused-msg');
  // إعادة فتح الصفحة وهو موقف: يبقى موقف والرسالة ما تنحسب مسموعة
  await A.reload(); await A.waitForTimeout(3000);
  if (await A.isVisible('#onboardBtn')) await A.click('#onboardBtn');
  await A.evaluate(() => window.DalilRoom.open()); await A.waitForTimeout(2500);
  aPz = await A.textContent('#rmPauseBar').catch(() => '');
  ok(aPz.includes('متوقف مؤقتًا') && aPz.includes('وصلتك رسالة'), `pause kept after reload: ${aPz.replace(/\s+/g, ' ').slice(0, 80)}`);
  await A.click('[data-rm="resume"]'); await A.waitForTimeout(1500);
  aPz = await A.textContent('#rmPauseBar').catch(() => '');
  ok(aPz.includes('فاتتك رسالة'), `after resume: missed banner: ${aPz.replace(/\s+/g, ' ').slice(0, 80)}`);
  await shot(A, '8d-A-missed');
  ok(await A.evaluate(() => !!window.DalilRoom.bgAuth()), 'resumed: bgAuth back');
  const bNew = await B.textContent('#rmVoice .rm-v').catch(() => '');
  ok(bNew.includes('أُرسلت') && !bNew.includes('سمعها'), `B's new message not marked heard while A paused: ${bNew.replace(/\s+/g, ' ').slice(0, 80)}`);
  await A.click('[data-rm="play-missed"]');
  let bHeard = '';
  for (let i = 0; i < 40 && !bHeard.includes('سمعها'); i++) { await B.waitForTimeout(250); bHeard = await B.textContent('#rmVoice .rm-v').catch(() => ''); }
  ok(bHeard.includes('سمعها أحمد'), `B sees «سمعها أحمد» after A listened: ${bHeard.replace(/\s+/g, ' ').slice(0, 100)}`);
  for (let i = 0; i < 30 && bPz.includes('متوقف مؤقتًا'); i++) { await B.waitForTimeout(250); bPz = await B.textContent('#rmMembers').catch(() => ''); }
  ok(!bPz.includes('متوقف مؤقتًا'), 'B sees A back (not paused)');
  // خيارات العضو (كتم/بلاغ) — نعرض القائمة فقط
  await A.click('#rmMembers [data-rm="menu"]');
  await A.waitForTimeout(500);
  await shot(A, '8-A-member-menu');
  await A.click('[data-mm="x"]');

  // إعادة فتح الصفحة: تُستعاد الغرفة تلقائيًا
  await A.reload(); await A.waitForTimeout(3000);
  if (await A.isVisible('#onboardBtn')) await A.click('#onboardBtn');
  await A.waitForTimeout(2000);
  ok((await A.textContent('#roomBtn')).includes('في الغرفة'), 'session restored after reload');

  // مغادرة
  for (const p of [A, B]) {
    await p.evaluate(() => window.DalilRoom.open()); await p.waitForTimeout(800);
    await p.click('[data-rm="leave"]').catch(() => {});
    await p.waitForTimeout(1000);
  }
  await shot(A, '9-A-left');
  for (const p of [A, B]) ok(p.errors.length === 0, `${p.label} no JS errors ${p.errors.slice(0, 3).join(' | ')}`);
  await browser.close();
  console.log(`::notice::E2E fails=${fails} passed=${passed.length}: ${passed.join(' | ')}`.slice(0, 3900));
  process.exit(fails ? 1 : 0);
})().catch(e => { console.log('::error::' + e.message.split('\n')[0]); process.exit(1); });
