const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const c = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, geolocation: { latitude: 27.49, longitude: 41.66 }, permissions: ['geolocation'], extraHTTPHeaders: { Referer: 'https://f10f100a-debug.github.io/' } });
  const p = await c.newPage(); const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:8765/map2.html?mode=3d&sat=1&lat=27.49&lng=41.66&z=13&tLat=27.80&tLng=42.10&tName=' + encodeURIComponent('بقعاء'));
  await p.waitForTimeout(12000);
  await p.click('[data-mode="road"]'); await p.waitForTimeout(12000);
  console.log('route:', await p.textContent('#tdRouteMsg'), '| nav:', await p.textContent('#tdNavS'), '| errors:', errs.slice(0, 3).join(' | '));
  await p.screenshot({ path: 'shots/m3-road.png', timeout: 60000 });
  await p.click('#tdMin'); await p.waitForTimeout(1500);
  await p.screenshot({ path: 'shots/m3-min.png', timeout: 60000 });
  const p2 = await c.newPage();
  await p2.goto('http://localhost:8765/map2.html?mode=3d&lat=27.49&lng=41.66&z=12'); await p2.waitForTimeout(8000);
  await p2.screenshot({ path: 'shots/m3-min-notarget.png', timeout: 60000 });
  await b.close();
})();
