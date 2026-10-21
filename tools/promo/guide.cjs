// لقطات دليل المستخدم: كل شاشة وميزة في دليل (تشغَّل في GitHub Actions مع خادم محلي يدعم byte ranges).
const { chromium } = require('playwright');
const fs = require('fs');
const OUT = 'guide'; fs.mkdirSync(OUT, { recursive: true });
const BASE = { lat: 27.5203, lng: 41.6960 };   // حائل
const log = (...a) => console.log(...a);
const W = 390, H = 844;
async function ctxFor(browser, o = {}) {
  return browser.newContext({ viewport: { width: W, height: o.h || H }, deviceScaleFactor: 2, locale: 'ar-SA', timezoneId: 'Asia/Riyadh', colorScheme: o.dark ? 'dark' : 'light',
    geolocation: { latitude: o.lat || BASE.lat, longitude: o.lng || BASE.lng }, permissions: ['geolocation', 'microphone', 'clipboard-read', 'clipboard-write'],
    extraHTTPHeaders: { Referer: 'https://f10f100a-debug.github.io/' } });
}
async function open(c, o = {}) {
  const p = await c.newPage();
  p.on('dialog', d => d.accept().catch(() => {}));
  await p.addInitScript(([theme, car]) => {
    localStorage.setItem('dalil_permissions_ready', '1'); localStorage.setItem('dalil_theme', theme); localStorage.setItem('dalil_room_terms_v1', '1');
    if (car) localStorage.setItem('dalil_car', JSON.stringify({ lat: 27.5232, lng: 41.7001, time: Date.now() - 3600e3 }));
  }, [o.dark ? 'dark' : 'light', !!o.car]);
  await p.goto('http://localhost:8765/index.html' + (o.q || ''));
  await p.waitForTimeout(1800);
  if (await p.isVisible('#skipPermissionsBtn').catch(() => false)) await p.click('#skipPermissionsBtn');
  await p.waitForTimeout(600);
  // بوصلة ثابتة (كأنها من الجوال) حتى لا تظهر «--°»
  await p.evaluate(() => { const f = () => window.__dalilNativeHeading && window.__dalilNativeHeading(38, 8); f(); setInterval(f, 700); }).catch(() => {});
  await p.evaluate(() => { const a = document.getElementById('navActivation'); if (a) a.style.display = 'none'; }).catch(() => {});
  await p.waitForTimeout(800);
  return p;
}
async function shot(p, n, fn) {
  try { if (fn) await fn(); await p.waitForTimeout(700); await p.screenshot({ path: `${OUT}/${n}.png` }); log('ok', n); }
  catch (e) { log('FAIL', n, e.message.split('\n')[0]); }
}
const tab = (p, s) => p.click(`.tab[data-screen="${s}"]`);
const frame = p => p.frameLocator('#trackMapFrame');
const later = async p => { await frame(p).getByText('لاحقًا', { exact: true }).first().click({ timeout: 2500 }).catch(() => {}); };
const mapGo = (p, lat, lng, zz) => p.frames().find(f => f.url().includes('map.html')).evaluate(([lat, lng, zz]) => {
  z = zz; setView('free'); const [wx, wy] = world(lat, lng); cx = wx + innerWidth / 2 - originX; cy = wy + innerHeight / 2 - originY; render();
}, [lat, lng, zz]);

(async () => {
  const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });

  // 1) صفحة البداية
  { const c = await ctxFor(browser); const p = await c.newPage(); await p.addInitScript(() => localStorage.setItem('dalil_theme', 'light'));
    await p.goto('http://localhost:8765/index.html'); await p.waitForTimeout(2000); await shot(p, '01-onboarding'); await c.close(); }

  const c = await ctxFor(browser); const p = await open(c, { car: true });

  // 2) البوصلة
  await shot(p, '02-compass');
  await shot(p, '03-compass-lower', () => p.evaluate(() => document.getElementById('emergencyBtn').scrollIntoView({ block: 'end' })));
  await p.evaluate(() => scrollTo(0, 0));

  // 3) الأماكن
  await tab(p, 'places'); await p.waitForTimeout(2500);
  await shot(p, '04-places');
  await shot(p, '05-places-search', async () => { await p.fill('#placeSearch', 'بنزين'); await p.waitForTimeout(3000); });
  // توجّه لأول نتيجة
  await p.locator('#screen-places >> text=توجّه').first().click({ timeout: 4000 }).catch(e => log('nav fail', e.message.split('\n')[0]));
  await p.waitForTimeout(2500);
  await shot(p, '06-compass-target');
  await p.fill('#placeSearch', '').catch(() => {});
  await tab(p, 'places'); await p.waitForTimeout(800);
  await shot(p, '07-add-place', async () => { await p.click('#addPlaceBtn'); await p.waitForTimeout(1200); });
  await p.keyboard.press('Escape').catch(() => {});
  await p.evaluate(() => { document.querySelectorAll('.overlay.show, .modal.show, .sheet.show').forEach(x => x.classList.remove('show')); }).catch(() => {});

  // 4) الخريطة
  await tab(p, 'track'); await p.waitForTimeout(5000); await later(p);
  await mapGo(p, 27.52, 41.69, 12); await p.waitForTimeout(5000);
  await shot(p, '08-map');
  await shot(p, '09-map-layers', async () => { await frame(p).locator('#layersBtn').click(); await p.waitForTimeout(1200); });
  await frame(p).locator('#lpClose').click().catch(() => {});
  await shot(p, '10-map-sat', async () => { await frame(p).locator('#onlineMode').click(); await p.waitForTimeout(7000); });
  await frame(p).locator('#localMode').click().catch(() => {});
  await mapGo(p, 27.6, 41.75, 9); await p.waitForTimeout(1500);
  await shot(p, '11-map-spring', async () => { await frame(p).locator('[data-q="ndvi"]').click(); await p.waitForTimeout(7000); });
  await frame(p).locator('[data-q="ndvi"]').click().catch(() => {});
  await shot(p, '12-map-terrain', async () => { await frame(p).locator('[data-q="topo"]').click(); await mapGo(p, 27.55, 41.62, 12); await p.waitForTimeout(6000); });
  await frame(p).locator('[data-q="topo"]').click().catch(() => {});
  await shot(p, '13-map-radar', async () => { await frame(p).locator('[data-q="rain"]').click(); await p.waitForTimeout(8000); });
  await frame(p).locator('[data-q="rain"]').click().catch(() => {});
  await shot(p, '14-track-tools', async () => { await p.click('#trackToolsToggle'); await p.waitForTimeout(800); await p.evaluate(() => document.getElementById('trackToolsPanel').scrollIntoView({ block: 'center' })); });
  await p.evaluate(() => scrollTo(0, 0));

  // 5) الأجواء
  await tab(p, 'weather'); await p.waitForTimeout(5000);
  await shot(p, '15-weather');
  await shot(p, '16-prayer', () => p.evaluate(() => document.getElementById('prayerCard').scrollIntoView({ block: 'center' })));
  await p.evaluate(() => scrollTo(0, 0));
  for (const [k, n] of [['wind', '17-wind'], ['spring', '18-spring'], ['ev', '19-events']]) {
    await shot(p, n, async () => { await p.click(`[data-wxpane="${k}"]`); await p.waitForTimeout(4000); });
  }
  await p.click('[data-wxpane="wx"]').catch(() => {});

  // 6) الإعدادات
  await tab(p, 'settings'); await p.waitForTimeout(1500);
  await shot(p, '20-settings');
  await shot(p, '21-settings-maps', () => p.evaluate(() => document.getElementById('importCatalogBtn').scrollIntoView({ block: 'center' })));
  await shot(p, '22-settings-push', () => p.evaluate(() => document.getElementById('pushTitle').scrollIntoView({ block: 'start' })));
  await c.close();

  // 7) العرض الثلاثي
  { const c3 = await ctxFor(browser, { lat: 27.86, lng: 42.03 }); const p3 = await c3.newPage();
    await p3.goto('http://localhost:8765/map2.html?mode=3d&lat=27.86&lng=42.03&z=13&tLat=28.06&tLng=41.98&tName=' + encodeURIComponent('نقطة في النفود'));
    await p3.waitForTimeout(12000);
    await p3.evaluate(() => document.querySelector('[data-mode="road"]').click()); await p3.waitForTimeout(8000);
    await p3.evaluate(() => document.getElementById('tdFollow').click()); await p3.waitForTimeout(500);
    await p3.evaluate(() => window.__map3 && window.__map3.jumpTo({ zoom: 11.3, pitch: 50, bearing: -10 })); await p3.waitForTimeout(8000);
    await shot(p3, '23-3d'); await c3.close(); }

  // 8) غرفة الرحلة: فهد وسالم وسعود
  const people = [{ n: 'فهد', la: 27.86, ln: 42.05, car: true }, { n: 'سالم', la: 27.8675, ln: 42.056, car: true }, { n: 'سعود', la: 27.891, ln: 42.032 }];
  const R = [];
  for (const u of people) { const cc = await ctxFor(browser, { lat: u.la, lng: u.ln }); const pp = await open(cc, { car: false });
    if (u.car) await pp.evaluate(([la, ln]) => { localStorage.setItem('dalil_car', JSON.stringify({ lat: la - 0.002, lng: ln + 0.002, time: Date.now() })); }, [u.la, u.ln]);
    await pp.reload(); await pp.waitForTimeout(1500); if (await pp.isVisible('#skipPermissionsBtn').catch(() => false)) await pp.click('#skipPermissionsBtn');
    await pp.evaluate(() => { const f = () => window.__dalilNativeHeading && window.__dalilNativeHeading(38, 8); f(); setInterval(f, 700); const a = document.getElementById('navActivation'); if (a) a.style.display = 'none'; });
    R.push(pp); }
  const [fahd, salem, saud] = R;
  await fahd.click('#roomBtn'); await fahd.waitForSelector('#rmName');
  await fahd.click('[data-rm="tab-create"]');
  await fahd.fill('#rmName', 'فهد'); await fahd.fill('#rmTrip', 'كشتة النفود'); await fahd.fill('#rmPin', '2026');
  await shot(fahd, '24-room-create');
  await fahd.check('#rmTerms'); await fahd.click('#rmGo'); await fahd.waitForSelector('.rm-code', { timeout: 20000 });
  const code = (await fahd.textContent('.rm-code')).trim();
  for (const [pp, u] of [[salem, people[1]], [saud, people[2]]]) {
    await pp.click('#roomBtn'); await pp.waitForSelector('#rmName');
    await pp.fill('#rmName', u.n); await pp.fill('#rmCode', code); await pp.fill('#rmPin', '2026');
    if (u.n === 'سالم') await shot(pp, '25-room-join');
    await pp.check('#rmTerms'); await pp.click('#rmGo');
    await pp.waitForSelector('.rm-code', { timeout: 30000 }).catch(async () => { log('join fail', u.n, (await pp.textContent('#roomSheet, .rm-sheet, body')).replace(/\s+/g, ' ').slice(0, 300)); await pp.screenshot({ path: `${OUT}/x-join-${u.n}.png` }); });
  }
  await fahd.waitForTimeout(10000);
  const box = await salem.locator('#rmPtt').boundingBox();
  await salem.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await salem.mouse.down();
  await salem.waitForTimeout(1500); await shot(salem, '26-room-recording'); await salem.waitForTimeout(1200); await salem.mouse.up();
  for (let i = 0; i < 20; i++) { await fahd.waitForTimeout(1000); if ((await fahd.textContent('#rmVoice')).includes('سالم')) break; }
  await salem.click('[data-rm="rally-set"]'); await salem.click('[data-mm="rally-here"]');
  for (let i = 0; i < 15; i++) { await fahd.waitForTimeout(1000); if ((await fahd.textContent('#rmRally')).includes('سالم')) break; }
  await fahd.waitForTimeout(2000);
  await shot(fahd, '27-room-main');
  await shot(fahd, '28-room-members', () => fahd.evaluate(() => document.querySelector('#rmMembers').scrollIntoView({ block: 'start' })));
  await shot(fahd, '29-room-voice', () => fahd.evaluate(() => document.querySelector('#rmVoice').scrollIntoView({ block: 'center' })));
  await shot(fahd, '30-member-menu', async () => { await fahd.click('#rmMembers [data-rm="menu"]'); await fahd.waitForTimeout(600); });
  await fahd.click('[data-mm="x"]').catch(() => {});
  await shot(fahd, '31-room-map', async () => { await fahd.click('[data-rm="map"]'); await fahd.waitForTimeout(6000); await later(fahd); await fahd.waitForTimeout(2500); });
  await saud.locator('#rmSos').scrollIntoViewIfNeeded();
  const sb = await saud.locator('#rmSos').boundingBox();
  await saud.mouse.move(sb.x + sb.width / 2, sb.y + sb.height / 2); await saud.mouse.down(); await saud.waitForTimeout(1400); await saud.mouse.up();
  await fahd.click('.tab[data-screen="compass"]'); await fahd.waitForTimeout(4000);
  await shot(fahd, '32-room-sos');
  await fahd.click('#rmSosAlert [data-sos="go"]').catch(() => {}); await fahd.waitForTimeout(2500);
  await shot(fahd, '33-compass-to-member');
  await fahd.click('#rmSosAlert [data-sos="x"]').catch(() => {});


  // 9) الوضع الليلي
  { const cd = await ctxFor(browser, { dark: true }); const pd = await open(cd, { dark: true, car: true }); await shot(pd, '35-dark'); await cd.close(); }
  await browser.close();
})().catch(e => { console.log('FATAL', e.message); process.exit(1); });
