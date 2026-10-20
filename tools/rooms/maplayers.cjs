// لقطة لطبقات الطقس الجديدة (رادار + برق) على الخريطة للتحقق من عملها.
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 430, height: 900 }, geolocation: { latitude: 24.7, longitude: 46.7 }, permissions: ['geolocation'] });
  const p = await ctx.newPage(); const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  p.on('console', m => { if (m.type() === 'error' && !/pmtiles|Byte Serving/.test(m.text())) errs.push(m.text()); });
  const req = []; p.on('response', r => { const u = r.url(); if (/rainviewer|eumetsat/.test(u)) req.push(r.status() + ' ' + u.slice(0, 110)); });
  await p.addInitScript(() => localStorage.setItem('dalil_map_layers', JSON.stringify({ base: 'osm', radar: true, lightning: true, clouds: false, rain: false })));
  await p.goto('http://localhost:8765/map.html');
  await p.waitForTimeout(5000);
  for (let i = 0; i < 6; i++) { await p.click('#minus').catch(() => {}); await p.waitForTimeout(400); }
  await p.waitForTimeout(9000);
  await p.screenshot({ path: 'shots/map-radar.png' });
  console.log('::notice::requests ' + req.length + ': ' + [...new Set(req.map(r => r.split(' ')[0]))].join(',') + ' | ' + req.slice(0, 3).join(' | '));
  console.log('::notice::errors ' + errs.length + ': ' + errs.slice(0, 4).join(' | ').slice(0, 900));
  console.log('::notice::bar ' + (await p.textContent('#rainTime').catch(() => '')));
  await b.close();
})();
