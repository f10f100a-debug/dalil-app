// فحص ضغط الفيديو في Chrome الحقيقي (فيه H.264): يضغط مقطع تجريبي بالطريقتين ويحفظ الناتج للفحص بـ ffprobe
const { chromium } = require('playwright');
const fs = require('fs');
(async () => {
  const b = await chromium.launch({ channel: 'chrome', args: ['--autoplay-policy=no-user-gesture-required'] });
  const p = await b.newPage();
  p.on('console', m => { if (/video|error/i.test(m.text())) console.log('console:', m.text()); });
  p.on('pageerror', e => console.log('pageerror', e.message));
  await p.addInitScript(() => localStorage.setItem('dalil_permissions_ready', '1'));
  await p.goto('http://localhost:8765/index.html'); await p.waitForTimeout(2500);
  await p.addScriptTag({ url: 'http://localhost:8765/events.js?test=1' }); await p.waitForTimeout(800);
  for (const mode of ['wc', 'old']) {
    const r = await p.evaluate(async (mode) => {
      const blob = await (await fetch('/test-in.mp4')).blob();
      const f = new File([blob], 'in.mp4', { type: 'video/mp4' });
      const t0 = performance.now();
      const out = await window.__dalilVideoTest(f, mode === 'old');
      if (!out) return { mode, out: null, ms: Math.round(performance.now() - t0) };
      const buf = new Uint8Array(await out.arrayBuffer()); let s = ''; for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
      return { mode, b64: btoa(s), size: buf.length, ms: Math.round(performance.now() - t0) };
    }, mode).catch(e => ({ mode, error: e.message }));
    if (r.b64) { fs.writeFileSync(`out-${mode}.mp4`, Buffer.from(r.b64, 'base64')); delete r.b64; }
    console.log(JSON.stringify(r));
  }
  await b.close();
})();
