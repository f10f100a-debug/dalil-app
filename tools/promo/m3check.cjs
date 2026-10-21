const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const c = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, geolocation: { latitude: 27.505, longitude: 41.62 }, permissions: ['geolocation'], extraHTTPHeaders: { Referer: 'https://f10f100a-debug.github.io/' } });
  const p = await c.newPage(); const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:8765/map2.html?mode=3d&sat=1&lat=27.505&lng=41.62&z=13&tLat=27.56&tLng=41.70&tName=' + encodeURIComponent('جبل السمراء'));
  await p.waitForTimeout(15000);
  console.log('nav:', await p.textContent('#tdNav'), 'errors:', errs.slice(0, 3).join(' | '));
  await p.screenshot({ path: 'shots/m3.png' });
  await b.close();
})();
