const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const c = await b.newContext({ viewport: { width: 390, height: 844 }, geolocation: { latitude: 27.4903, longitude: 41.6599 }, permissions: ['geolocation'], extraHTTPHeaders: { Referer: 'https://f10f100a-debug.github.io/' } });
  const p = await c.newPage(); const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  await p.addInitScript(() => { window.__said = []; const o = window.speechSynthesis; if (o) o.speak = u => window.__said.push(u.text); });
  await p.goto('http://localhost:8765/map2.html?mode=3d&lat=27.49&lng=41.66&z=13&tLat=27.80&tLng=42.10&tName=' + encodeURIComponent('بقعاء'));
  await p.waitForTimeout(10000);
  await p.evaluate(() => document.getElementById('tdVoice').click());
  await p.evaluate(() => document.querySelector('[data-mode="road"]').click());
  await p.waitForTimeout(8000);
  const steps = null;
  await c.setGeolocation({ latitude: 27.4915, longitude: 41.6608 }); await p.waitForTimeout(4000);
  console.log('msg:', await p.textContent('#tdRouteMsg'), '\nsteps:', JSON.stringify(steps), '\nsaid:', JSON.stringify(await p.evaluate(() => window.__said)), '\nerrors:', errs.slice(0, 3).join(' | '));
  await p.screenshot({ path: 'shots/m3-voice.png', timeout: 60000 });
  await b.close();
})().catch(e => { console.log('FAIL', e.message.split('\n')[0]); process.exit(1); });
