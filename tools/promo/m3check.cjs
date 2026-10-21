const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  for (const [name, q] of [['m3-plain', ''], ['m3-nav', '&tLat=27.56&tLng=41.70&tName=' + encodeURIComponent('جبل السمراء')]]) {
    const c = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, geolocation: { latitude: 27.505, longitude: 41.62 }, permissions: ['geolocation'], extraHTTPHeaders: { Referer: 'https://f10f100a-debug.github.io/' } });
    const p = await c.newPage(); const errs = [];
    p.on('pageerror', e => errs.push(e.message));
    p.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 120)); });
    await p.goto('http://localhost:8765/map2.html?mode=3d&sat=1&lat=27.505&lng=41.62&z=13' + q);
    await p.waitForTimeout(25000);
    const info = await p.evaluate(() => { try { const m = document.querySelector('canvas'); return { canvas: !!m, w: m && m.width } } catch (e) { return String(e) } });
    console.log(name, JSON.stringify(info), (await p.textContent('#tdNav')).trim(), 'errors:', errs.slice(0, 4).join(' | '));
    await p.screenshot({ path: `shots/${name}.png`, timeout: 60000 });
    await c.close();
  }
  await b.close();
})();
