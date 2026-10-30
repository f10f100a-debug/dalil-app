// لقطات متجر Google Play (1080×1920) من الموقع الحي + صورة العرض 1024×500 — تشغيل مؤقت
const { chromium } = require('playwright');
const fs = require('fs');
const URL = 'https://f10f100a-debug.github.io/dalil-app/';
const OUT = 'out'; fs.mkdirSync(OUT, { recursive: true });
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 360, height: 640 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true,
    locale: 'ar-SA', timezoneId: 'Asia/Riyadh', geolocation: { latitude: 27.52, longitude: 41.69, accuracy: 15 }, permissions: ['geolocation'] });
  const p = await ctx.newPage();
  await p.goto(URL, { waitUntil: 'networkidle' }).catch(() => {});
  await p.waitForTimeout(3000);
  const sk = await p.$('#skipPermissionsBtn'); if (sk) await sk.click().catch(() => {});
  await p.waitForTimeout(1500);
  const hide = () => p.evaluate(() => { for (const id of ['pushAsk', 'regNudge']) { const e = document.getElementById(id); if (e) e.hidden = true, e.remove && id === 'regNudge' && e.remove(); } document.querySelectorAll('.toast').forEach(t => t.remove()); });
  const shot = async (screen, name, wait = 5000) => {
    await p.click(`.tab[data-screen="${screen}"]`).catch(() => {});
    await p.waitForTimeout(wait); await hide();
    await p.screenshot({ path: `${OUT}/${name}.png` });
    console.log('shot', name);
  };
  await shot('compass', '1-compass', 4000);
  await shot('track', '2-map', 12000);
  await shot('weather', '3-weather', 9000);
  await shot('places', '4-places', 4000);
  // صورة العرض
  const icon = fs.readFileSync('assets/icon-512.png').toString('base64');
  const f = await b.newPage({ viewport: { width: 1024, height: 500 }, deviceScaleFactor: 1 });
  await f.setContent(`<!doctype html><html dir="rtl"><head><link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Arabic:wght@500;700&display=swap" rel="stylesheet">
  <style>body{margin:0;width:1024px;height:500px;background:linear-gradient(135deg,#1C1A17 0%,#2E2A22 60%,#3A3226 100%);font-family:'IBM Plex Sans Arabic';color:#F2EFE9;display:flex;align-items:center;gap:56px;padding:0 80px;box-sizing:border-box;overflow:hidden}
  img{width:220px;height:220px;border-radius:48px;box-shadow:0 18px 40px rgba(0,0,0,.45)} h1{margin:0;font-size:84px;font-weight:700;line-height:1.1} h1 span{color:#C9964F}
  p{margin:14px 0 0;font-size:30px;font-weight:500;color:#E0D6C6;line-height:1.6}</style></head>
  <body><img src="data:image/png;base64,${icon}"><div><h1>دليل <span>بوصلة البر</span></h1><p>خرائط بدون إنترنت · رادار المطر<br>تنبيهات السيول · غرفة الرحلة</p></div></body></html>`, { waitUntil: 'networkidle' });
  await f.waitForTimeout(1500);
  await f.screenshot({ path: `${OUT}/feature-1024x500.png` });
  fs.copyFileSync('assets/icon-512.png', `${OUT}/icon-512.png`);
  await b.close();
})();
