// لقطات دعائية حقيقية من دليل: غرفة رحلة بأربعة أعضاء (فهد وسالم وسعود وحمد) + البحث + الأجواء.
const { chromium } = require('playwright');
const fs = require('fs');
const OUT = 'promo'; fs.mkdirSync(OUT, { recursive: true });
const BASE = { lat: 27.86, lng: 42.05 };   // نفود قريب من حائل
const PEOPLE = [
  { name: 'فهد', dLat: 0, dLng: 0 },
  { name: 'سالم', dLat: 0.0075, dLng: 0.006 },     // ~1 كم
  { name: 'حمد', dLat: -0.0045, dLng: 0.0035 },    // ~600 م
  { name: 'سعود', dLat: 0.031, dLng: -0.018 },     // ~3.9 كم: تنبيه القافلة
];
async function user(browser, u, i) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, locale: 'ar-SA', colorScheme: 'light',
    geolocation: { latitude: BASE.lat + u.dLat, longitude: BASE.lng + u.dLng }, permissions: ['geolocation', 'microphone', 'clipboard-read', 'clipboard-write'] });
  const p = await ctx.newPage();
  p.on('dialog', d => d.accept().catch(() => {}));
  await p.addInitScript(() => { localStorage.setItem('dalil_permissions_ready', '1'); localStorage.setItem('dalil_theme', 'light'); localStorage.setItem('dalil_room_terms_v1', '1'); });
  await p.goto('http://localhost:8765/index.html');
  await p.waitForTimeout(1500);
  if (await p.isVisible('#skipPermissionsBtn')) await p.click('#skipPermissionsBtn');
  await p.waitForTimeout(800);
  return p;
}
const shot = (p, n) => p.screenshot({ path: `${OUT}/${n}.png` });
(async () => {
  const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
  // صفحة البداية
  {
    const c = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, locale: 'ar-SA' });
    const p = await c.newPage(); await p.addInitScript(() => localStorage.setItem('dalil_theme', 'light'));
    await p.goto('http://localhost:8765/index.html'); await p.waitForTimeout(2000); await shot(p, 'onboarding'); await c.close();
  }
  const P = [];
  for (let i = 0; i < PEOPLE.length; i++) P.push(await user(browser, PEOPLE[i], i));
  const [fahd, salem, hamad, saud] = P;
  // فهد ينشئ الغرفة
  await fahd.click('#roomBtn'); await fahd.waitForSelector('#rmName');
  await fahd.click('[data-rm="tab-create"]');
  await fahd.fill('#rmName', 'فهد'); await fahd.fill('#rmTrip', 'كشتة النفود'); await fahd.fill('#rmPin', '2026');
  await fahd.check('#rmTerms'); await fahd.click('#rmGo');
  await fahd.waitForSelector('.rm-code', { timeout: 20000 });
  const code = (await fahd.textContent('.rm-code')).trim();
  for (const [p, u] of [[salem, PEOPLE[1]], [hamad, PEOPLE[2]], [saud, PEOPLE[3]]]) {
    await p.click('#roomBtn'); await p.waitForSelector('#rmName');
    await p.fill('#rmName', u.name); await p.fill('#rmCode', code); await p.fill('#rmPin', '2026');
    await p.check('#rmTerms'); await p.click('#rmGo'); await p.waitForSelector('.rm-code', { timeout: 20000 });
  }
  await fahd.waitForTimeout(10000);
  // سالم يرسل رسالة صوتية
  const box = await salem.locator('#rmPtt').boundingBox();
  await salem.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await salem.mouse.down();
  await salem.waitForTimeout(1500); await shot(salem, 'room-recording'); await salem.waitForTimeout(1500); await salem.mouse.up();
  for (let i = 0; i < 20; i++) { await fahd.waitForTimeout(1000); if ((await fahd.textContent('#rmVoice')).includes('سالم')) break; }
  // حمد يحدد نقطة التجمع
  await hamad.click('[data-rm="rally-set"]'); await hamad.click('[data-mm="rally-here"]');
  for (let i = 0; i < 15; i++) { await fahd.waitForTimeout(1000); if ((await fahd.textContent('#rmRally')).includes('حمد')) break; }
  await fahd.waitForTimeout(2500);
  await shot(fahd, 'room-main');
  await fahd.evaluate(() => document.querySelector('#rmMembers').scrollIntoView({ block: 'start' })); await fahd.waitForTimeout(500);
  await shot(fahd, 'room-members');
  // الخريطة مع الأعضاء
  await fahd.click('[data-rm="map"]'); await fahd.waitForTimeout(6000);
  for (const t of ['لاحقًا']) { await fahd.frameLocator('#trackMapFrame').getByText(t, { exact: true }).first().click({ timeout: 3000 }).catch(() => {}); }
  await fahd.waitForTimeout(3000); await shot(fahd, 'room-map');
  // استغاثة من سعود
  await saud.locator('#rmSos').scrollIntoViewIfNeeded();
  const sb = await saud.locator('#rmSos').boundingBox();
  await saud.mouse.move(sb.x + sb.width / 2, sb.y + sb.height / 2); await saud.mouse.down(); await saud.waitForTimeout(1400); await saud.mouse.up();
  await fahd.click('.tab[data-screen="compass"]'); await fahd.waitForTimeout(4000); await shot(fahd, 'room-sos');
  // التوجه إلى سعود بالبوصلة
  await fahd.click('#rmSosAlert [data-sos="go"]').catch(() => {}); await fahd.waitForTimeout(2500); await shot(fahd, 'compass-to-saud');
  // إخفاء تنبيه الاستغاثة عند حمد قبل لقطات البحث والأجواء
  await hamad.click('#rmSosAlert [data-sos="x"]').catch(() => {});
  // البحث عن محطة وقود
  await hamad.click('.tab[data-screen="places"]').catch(async () => { await hamad.evaluate(() => window.DalilRoom && DalilRoom.close()); await hamad.click('.tab[data-screen="places"]'); });
  await hamad.fill('#placeSearch', 'بنزين'); await hamad.waitForTimeout(3500); await shot(hamad, 'places-fuel');
  // الأجواء
  await hamad.click('.tab[data-screen="weather"]'); await hamad.waitForTimeout(4000); await shot(hamad, 'weather');
  for (const p of P) { await p.evaluate(() => window.DalilRoom && DalilRoom.close()).catch(() => {}); }
  await browser.close();
  console.log('::notice::promo shots done code=' + code);
})().catch(e => { console.log('::error::' + e.message.split('\n')[0]); process.exit(1); });
