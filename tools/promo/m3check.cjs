const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const spots = [['water-asfar', 25.53, 49.80, 11], ['water-hair', 24.38, 46.83, 12], ['water-tabuk', 28.0, 36.5, 9]];
  for (const [name, lat, lng, zz] of spots) {
    const c = await b.newContext({ viewport: { width: 390, height: 700 }, deviceScaleFactor: 1, colorScheme: 'light' });
    const p = await c.newPage(); const errs = [];
    p.on('pageerror', e => errs.push(e.message));
    p.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 120)); });
    await p.addInitScript(() => localStorage.setItem('dalil_map_layers', JSON.stringify({ base: 'barr', water: true })));
    await p.goto('http://localhost:8765/map.html?embed=1');
    await p.waitForTimeout(4000);
    await p.evaluate(([la, ln, zz]) => { z = zz; setView('free'); const [wx, wy] = world(la, ln); cx = wx + innerWidth / 2 - originX; cy = wy + innerHeight / 2 - originY; render() }, [lat, lng, zz]);
    await p.waitForTimeout(12000);
    console.log(name, 'errors:', errs.slice(0, 4).join(' | '));
    await p.screenshot({ path: `shots/${name}.png`, timeout: 60000 });
    await c.close();
  }
  await b.close();
})().catch(e => { console.log('FAIL', e.message.split('\n')[0]); process.exit(1); });
