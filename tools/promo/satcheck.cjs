const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch();
  for (const [name, lp] of [['sat-lt', { base: 'sat', lightning: true }], ['sat-dark', { base: 'sat', lightning: true }], ['barr-lt', { base: 'barr', lightning: true }]]) {
    const c = await b.newContext({ viewport: { width: 390, height: 700 }, deviceScaleFactor: 2, colorScheme: 'light' });
    const p = await c.newPage();
    await p.addInitScript(v => localStorage.setItem('dalil_map_layers', v), JSON.stringify(lp));
    await p.goto('http://localhost:8765/map.html?embed=1');
    await p.waitForTimeout(4000);
    await p.evaluate(t => document.documentElement.dataset.theme = t, name.endsWith('dark') ? 'dark' : 'light');
    await p.evaluate(() => { z = 14; setView('free'); const [wx, wy] = world(27.862, 42.03); cx = wx + innerWidth / 2 - originX; cy = wy + innerHeight / 2 - originY; render() });
    await p.waitForTimeout(9000);
    await p.screenshot({ path: `shots/${name}.png` });
    console.log(name, await p.evaluate(() => gl.getStyle().layers.filter(l => !(l.layout && l.layout.visibility === 'none') && l.type === 'raster').map(l => l.id + ':' + JSON.stringify(l.paint)).join(' | ')));
  }
  await b.close();
})();
