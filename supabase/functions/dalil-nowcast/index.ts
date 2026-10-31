// تجربة صامتة «تنبؤ الرادار +30 دقيقة» (ما يُعرض للمستخدمين): كل 10 دقائق (pg_cron) نحرّك المطر الحالي حسب سرعته واتجاهه
// (نفس حساب «العاصفة جايتك؟»: أفضل إزاحة بين صورة قبل 30 د والآن، لكل منطقة 2°×2° لحالها) ونحفظ التوقع.
// وبعد 30 دقيقة نقارنه بصورة الرادار الحقيقية، ونقارن بعد بـ«ما يتحرك» (افتراض إن المطر يبقى مكانه) — لو التنبؤ ما يتفوّق عليه ما له فايدة.
// المقياس: CSI = أصاب ÷ (أصاب + فات + إنذار كاذب)، على خلايا ≥30 dBZ (مطر متوسط فأكثر)، مع سماح خلية وحدة (~5 كم).
import UPNG from "npm:upng-js@2.1.0";
import { createClient } from "npm:@supabase/supabase-js@2";
const db = () => createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false, autoRefreshToken: false } });

const LAT0 = 16, LAT1 = 32.5, LNG0 = 34, LNG1 = 56, STEP = 0.05, Z = 6, WET = 30, LEAD = 30;
const ROWS = Math.round((LAT1 - LAT0) / STEP), COLS = Math.round((LNG1 - LNG0) / STEP), N = ROWS * COLS;
const PAL: number[][] = [[0,0x82,0x7b,0x69],[5,0x92,0x88,0x71],[10,0xce,0xc0,0x87],[15,0x88,0xdd,0xee],[20,0x00,0xa3,0xe0],[25,0x00,0x77,0xaa],[30,0x00,0x55,0x88],[35,0xff,0xee,0x00],[40,0xff,0xaa,0x00],[45,0xff,0x44,0x00],[50,0xc1,0x00,0x00],[55,0xff,0xaa,0xff],[60,0xff,0x77,0xff],[65,0xff,0xff,0xff]];
function dbz(r: number, g: number, b: number, a: number) {
  if (a < 40) return -1;
  let best = 1e9, v = -1;
  for (const [d, R, G, B] of PAL) { const e = (r - R) ** 2 + (g - G) ** 2 + (b - B) ** 2; if (e < best) { best = e; v = d; } }
  return v;
}
async function radarGrid(host: string, path: string) {
  const tx = (lng: number) => (lng + 180) / 360 * 2 ** Z, ty = (lat: number) => (1 - Math.asinh(Math.tan(lat * Math.PI / 180)) / Math.PI) / 2 * 2 ** Z;
  const x0 = Math.floor(tx(LNG0)), x1 = Math.floor(tx(LNG1)), y0 = Math.floor(ty(LAT1)), y1 = Math.floor(ty(LAT0));
  const tiles = new Map<string, Uint8Array>();
  await Promise.all([...Array(x1 - x0 + 1)].flatMap((_, i) => [...Array(y1 - y0 + 1)].map(async (_, j) => {
    const x = x0 + i, y = y0 + j;
    const r = await fetch(`${host}${path}/256/${Z}/${x}/${y}/2/0_0.png`).catch(() => null);
    if (r && r.ok) { const img = UPNG.decode(await r.arrayBuffer()); tiles.set(x + "/" + y, new Uint8Array(UPNG.toRGBA8(img)[0])); }
  })));
  const g = new Int8Array(N).fill(-1);
  for (let i = 0; i < ROWS; i++) for (let j = 0; j < COLS; j++) {
    const fx = tx(LNG0 + (j + .5) * STEP), fy = ty(LAT0 + (i + .5) * STEP);
    const t = tiles.get(Math.floor(fx) + "/" + Math.floor(fy)); if (!t) continue;
    const X = Math.min(255, Math.floor((fx % 1) * 256)), Y = Math.min(255, Math.floor((fy % 1) * 256)), k = (Y * 256 + X) * 4;
    g[i * COLS + j] = dbz(t[k], t[k + 1], t[k + 2], t[k + 3]);
  }
  return { g, tiles: tiles.size };
}
const pack = (m: Uint8Array) => { const b = new Uint8Array(Math.ceil(N / 8)); for (let k = 0; k < N; k++) if (m[k]) b[k >> 3] |= 1 << (k & 7); let s = ""; for (const x of b) s += String.fromCharCode(x); return btoa(s); };
const unpack = (s: string) => { const bin = atob(s), m = new Uint8Array(N); for (let k = 0; k < N; k++) if (bin.charCodeAt(k >> 3) & (1 << (k & 7))) m[k] = 1; return m; };
const near = (m: Uint8Array, k: number) => { const i = k / COLS | 0, j = k % COLS; for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) { const y = i + a, x = j + b; if (y >= 0 && x >= 0 && y < ROWS && x < COLS && m[y * COLS + x]) return true; } return false; };
function score(f: Uint8Array, obs: Uint8Array) {
  let hit = 0, miss = 0, fa = 0;
  for (let k = 0; k < N; k++) {
    if (obs[k]) { if (near(f, k)) hit++; else miss++; }
    else if (f[k] && !near(obs, k)) fa++;
  }
  return { hit, miss, fa };
}

Deno.serve(async (req) => {
  const sb = db(), dry = new URL(req.url).searchParams.get("dry") === "1";
  try {
    const { data: keyRow } = await sb.from("private_config").select("value").eq("key", "cron_key").maybeSingle();
    if (!keyRow?.value || req.headers.get("x-cron-key") !== keyRow.value) return Response.json({ error: "forbidden" }, { status: 403 });
    const j = await (await fetch("https://api.rainviewer.com/public/weather-maps.json")).json();
    const past = (j.radar?.past || []) as { time: number; path: string }[];
    if (past.length < 4) return Response.json({ ok: false, error: "no_frames" });
    const now = past[past.length - 1], prev = past[past.length - 4], old = past[0];
    const [Nw, P, O] = await Promise.all([radarGrid(j.host, now.path), radarGrid(j.host, prev.path), radarGrid(j.host, old.path)]);
    if (Nw.tiles < 10 || P.tiles < 10) return Response.json({ ok: false, error: "tiles", tiles: Nw.tiles });
    // التشويش الثابت: صدى في نفس المكان قبل ساعتين وقبل 30 د والآن = مو مطر
    const clutter = new Uint8Array(N);
    for (let k = 0; k < N; k++) if (Nw.g[k] >= WET && P.g[k] >= WET && O.g[k] >= WET) clutter[k] = 1;
    const wet = (g: Int8Array) => { const m = new Uint8Array(N); let c = 0; for (let k = 0; k < N; k++) if (g[k] >= WET && !clutter[k]) { m[k] = 1; c++; } return { m, c }; };
    const obs = wet(Nw.g);
    const out: Record<string, unknown> = { ok: true, frame: new Date(now.time * 1000).toISOString(), wetCells: obs.c };

    // (1) التحقق: توقعات صُنعت قبل 30 د وموعدها صورة الآن
    const { data: due } = await sb.from("wx_nowcast").select("id,made,mask,base").is("verified_at", null).eq("valid", new Date(now.time * 1000).toISOString());
    const done: unknown[] = [];
    for (const r of due || []) {
      if (!r.mask || !r.base) continue;
      const f = unpack(r.mask), b = unpack(r.base);
      const a = score(f, obs.m), p = score(b, obs.m);
      const row = { hit: a.hit, miss: a.miss, fa: a.fa, p_hit: p.hit, p_miss: p.miss, p_fa: p.fa, obs_cells: obs.c, verified_at: new Date().toISOString(), mask: null, base: null };
      if (!dry) await sb.from("wx_nowcast").update(row).eq("id", r.id);
      done.push({ made: r.made, ...row, mask: undefined, base: undefined });
    }
    out.verified = done;

    // (2) التوقع الجديد: إزاحة كل منطقة 2°×2° فيها مطر حسب حركتها بين قبل 30 د والآن، ممدودة لـ +30 د
    const mins = (now.time - prev.time) / 60;
    const fc = new Uint8Array(N); let blocks = 0, moved = 0;
    const B = Math.round(2 / STEP);
    for (let bi = 0; bi < ROWS; bi += B) for (let bj = 0; bj < COLS; bj += B) {
      const cells: number[] = [];
      for (let i = bi; i < Math.min(ROWS, bi + B); i++) for (let jj = bj; jj < Math.min(COLS, bj + B); jj++) if (obs.m[i * COLS + jj]) cells.push(i * COLS + jj);
      if (!cells.length) continue;
      blocks++;
      // الحركة: أفضل إزاحة لخلايا ≥30 في صورة قبل 30 د ضمن ~200 كم حول المنطقة
      const ci = bi + B / 2 | 0, cj = bj + B / 2 | 0, R = 40, A: number[] = [];
      for (let y = Math.max(0, ci - R); y <= Math.min(ROWS - 1, ci + R); y++) for (let x = Math.max(0, cj - R); x <= Math.min(COLS - 1, cj + R); x++) { const k = y * COLS + x; if (P.g[k] >= WET && !clutter[k]) A.push(k); }
      let dy = 0, dx = 0;
      if (A.length >= 20) {
        let best = -1;
        for (let sy = -8; sy <= 8; sy++) for (let sx = -8; sx <= 8; sx++) {
          let c = 0; for (const k of A) { const y = (k / COLS | 0) + sy, x = k % COLS + sx; if (y >= 0 && x >= 0 && y < ROWS && x < COLS && obs.m[y * COLS + x]) c++; }
          if (c > best || (c === best && sx * sx + sy * sy < dx * dx + dy * dy)) { best = c; dx = sx; dy = sy; }
        }
        if (best < A.length * 0.25) { dx = 0; dy = 0; }
      }
      const fy = Math.round(dy * LEAD / mins), fx = Math.round(dx * LEAD / mins);
      if (fx || fy) moved++;
      for (const k of cells) { const y = (k / COLS | 0) + fy, x = k % COLS + fx; if (y >= 0 && x >= 0 && y < ROWS && x < COLS) fc[y * COLS + x] = 1; }
    }
    out.blocks = blocks; out.moved = moved;
    if (!dry && obs.c >= 20) {
      await sb.from("wx_nowcast").upsert({ made: new Date(now.time * 1000).toISOString(), valid: new Date((now.time + LEAD * 60) * 1000).toISOString(), cells: obs.c, blocks, moved, mask: pack(fc), base: pack(obs.m) }, { onConflict: "made", ignoreDuplicates: true });
    }
    if (!dry && Math.random() < 0.05) {
      await sb.from("wx_nowcast").delete().lt("made", new Date(Date.now() - 60 * 864e5).toISOString());
      await sb.from("wx_nowcast").update({ mask: null, base: null }).is("verified_at", null).lt("made", new Date(Date.now() - 3 * 3600e3).toISOString());
    }
    return Response.json(out);
  } catch (e) {
    console.error("dalil-nowcast", e);
    return Response.json({ ok: false, error: String((e as Error)?.message || e).slice(0, 200) }, { status: 500 });
  }
});
