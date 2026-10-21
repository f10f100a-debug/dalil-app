const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const nav = '&tLat=27.56&tLng=41.70&tName=' + encodeURIComponent('جبل السمراء');
  const cases = [
    ['m3-nav-wait', nav, null],
    ['m3-nav-nofollow', nav, m => { document.getElementById('tdFollow').click(); m.jumpTo({ zoom: 13, pitch: 62, bearing: 0, padding: { top: 0, bottom: 0, left: 0, right: 0 } }); }],
  ];
  for (const [name, q, fn] of cases) {
    const c = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, geolocation: { latitude: 27.505, longitude: 41.62 }, permissions: ['geolocation'], extraHTTPHeaders: { Referer: 'https://f10f100a-debug.github.io/' } });
    const p = await c.newPage(); const errs = [];
    p.on('pageerror', e => errs.push(e.message));
    await p.goto('http://localhost:8765/map2.html?mode=3d&sat=1&lat=27.505&lng=41.62&z=13' + q);
    await p.waitForTimeout(12000);
    if (fn) await p.evaluate(`(${fn.toString()})(window.__map3)`);
    await p.waitForTimeout(20000);
    const info = await p.evaluate(() => { const m = window.__map3; return { z: m.getZoom().toFixed(2), p: m.getPitch(), navLayer: !!m.getLayer('nav-line'), idx: m.getStyle().layers.findIndex(l => l.id === 'nav-line'), n: m.getStyle().layers.length, feats: m.querySourceFeatures('nav').length, rendered: m.queryRenderedFeatures({ layers: ['nav-line', 'nav-t'] }).length, data: JSON.stringify(m.getStyle().sources.nav && m.getStyle().sources.nav.data).slice(0, 200) } });
    console.log(name, JSON.stringify(info), 'errors:', errs.slice(0, 4).join(' | '));
    await p.screenshot({ path: `shots/${name}.png`, timeout: 60000 });
    await c.close();
  }
  await b.close();
})();
