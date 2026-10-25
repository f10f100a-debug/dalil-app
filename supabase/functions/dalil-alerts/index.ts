// تنبيهات الأمطار التلقائية حسب المنطقة: كل 10 دقائق (pg_cron) يقرأ الرادار والبرق للسعودية كاملة،
// وإذا لقى أمطارًا غزيرة مؤكدة بالبرق داخل منطقة يرسل إشعارًا لمشتركي تنبيهات المنطقة.
// ضد الإزعاج: حد أقصى تنبيهين للمنطقة باليوم، 6 ساعات بين التنبيهين، نفس العاصفة (أقل من 60 كم خلال 12 ساعة) ما تتكرر،
// والعاصفة البعيدة (أكثر من 200 كم عن أي مدينة أو محافظة في المنطقة) ما يُرسل لها.
// لا يستخدم موقع أي مستخدم — فقط المنطقة التي اختارها في الإعدادات. مشتركو «كل المناطق» لا تصلهم هذه التنبيهات (صور الأحداث فقط).
import UPNG from "npm:upng-js@2.1.0";
import webpush from "npm:web-push@3.6.7";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { config, db } from "../_shared/common.ts";
import { apnsToken } from "../_shared/apns.ts";
import { GRID } from "./region-grid.ts";

const LAT0 = 16, LAT1 = 32.5, LNG0 = 34, LNG1 = 56, STEP = 0.05;          // شبكة التحليل ~5 كم
const ROWS = Math.round((LAT1 - LAT0) / STEP), COLS = Math.round((LNG1 - LNG0) / STEP);
const Z = 6, HEAVY = 40, MIN_CELLS = 3, COOLDOWN_H = 6, DAY_MAX = 2, SAME_KM = 60, SAME_H = 12, FAR_KM = 200;
const CITY: Record<string, [string, number, number]> = {
  "جازان": ["جازان", 16.89, 42.55], "حائل": ["حائل", 27.52, 41.69], "الحدود الشمالية": ["عرعر", 30.98, 41.04], "الجوف": ["سكاكا", 29.97, 40.21],
  "عسير": ["أبها", 18.22, 42.5], "مكة": ["مكة", 21.42, 39.83], "الشرقية": ["الدمام", 26.43, 50.1], "نجران": ["نجران", 17.49, 44.13],
  "الباحة": ["الباحة", 20.01, 41.47], "تبوك": ["تبوك", 28.38, 36.57], "المدينة": ["المدينة", 24.47, 39.61], "القصيم": ["بريدة", 26.33, 43.97], "الرياض": ["الرياض", 24.71, 46.68],
};
// مدن ومحافظات كل منطقة (تقريبية) — للتأكد أن العاصفة قريبة من ناس
const TOWNS: Record<string, [number, number][]> = {
  "جازان": [[16.89, 42.55], [17.15, 42.62], [16.6, 42.95], [17.3, 43.05]],
  "حائل": [[27.52, 41.69], [27.89, 42.4], [27.0, 41.0], [28.02, 40.92], [26.85, 40.3], [27.6, 43.1]],
  "الحدود الشمالية": [[30.98, 41.04], [29.63, 43.49], [31.67, 38.66], [30.33, 42.25], [28.76, 43.83]],
  "الجوف": [[29.97, 40.21], [29.81, 39.87], [31.33, 37.34], [30.5, 38.2], [29.15, 40.6]],
  "عسير": [[18.22, 42.5], [18.3, 42.73], [19.1, 42.1], [19.12, 43.0], [17.9, 43.4], [20.0, 42.6], [18.0, 41.9]],
  "مكة": [[21.42, 39.83], [21.54, 39.17], [21.27, 40.42], [22.8, 39.05], [19.9, 41.0], [21.0, 41.5], [23.9, 38.9], [22.4, 42.7]],
  "الشرقية": [[26.43, 50.1], [25.38, 49.59], [28.43, 45.96], [27.0, 49.66], [28.4, 48.5], [27.47, 48.49], [24.5, 50.0], [23.0, 51.5], [26.0, 48.0]],
  "نجران": [[17.49, 44.13], [17.47, 47.11], [17.95, 44.15], [17.6, 44.42], [18.1, 45.6], [17.0, 48.5]],
  "الباحة": [[20.01, 41.47], [19.85, 41.55], [20.3, 41.33], [19.75, 41.1]],
  "تبوك": [[28.38, 36.57], [27.63, 38.55], [26.6, 37.5], [28.07, 35.17], [27.35, 35.7], [26.24, 36.47], [29.1, 36.1]],
  "المدينة": [[24.47, 39.61], [24.09, 38.06], [26.62, 37.93], [25.05, 40.0], [23.85, 39.4], [26.1, 38.9], [22.7, 39.5]],
  "القصيم": [[26.33, 43.97], [26.08, 43.99], [26.2, 43.7], [25.85, 43.5], [26.58, 44.25], [26.5, 45.35], [26.0, 42.8]],
  "الرياض": [[24.71, 46.68], [24.15, 47.3], [26.3, 44.8], [25.65, 45.6], [22.4, 46.6], [20.5, 45.6], [24.1, 45.3], [25.9, 45.3], [23.8, 44.9], [26.1, 47.8]],
};
const PAL: number[][] = [[0,0x82,0x7b,0x69],[5,0x92,0x88,0x71],[10,0xce,0xc0,0x87],[15,0x88,0xdd,0xee],[20,0x00,0xa3,0xe0],[25,0x00,0x77,0xaa],[30,0x00,0x55,0x88],[35,0xff,0xee,0x00],[40,0xff,0xaa,0x00],[45,0xff,0x44,0x00],[50,0xc1,0x00,0x00],[55,0xff,0xaa,0xff],[60,0xff,0x77,0xff],[65,0xff,0xff,0xff]];
function dbz(r: number, g: number, b: number, a: number) {
  if (a < 40) return -1;
  let best = 1e9, v = -1;
  for (const [d, R, G, B] of PAL) { const e = (r - R) ** 2 + (g - G) ** 2 + (b - B) ** 2; if (e < best) { best = e; v = d; } }
  return v;
}
// بصمة شبكة المناطق: للتأكد أنها نُشرت كاملة بدون تغيير (تظهر في الفحص التجريبي فقط)
const GRID_SUM = [...GRID.g].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) >>> 0, 7) + ":" + GRID.g.length;
const DIRS = ["شمال", "شمال شرق", "شرق", "جنوب شرق", "جنوب", "جنوب غرب", "غرب", "شمال غرب"];
const dirWord = (deg: number) => DIRS[Math.round(((deg % 360) + 360) % 360 / 45) % 8];
function bearing(la1: number, lo1: number, la2: number, lo2: number) {
  const r = Math.PI / 180, y = Math.sin((lo2 - lo1) * r) * Math.cos(la2 * r), x = Math.cos(la1 * r) * Math.sin(la2 * r) - Math.sin(la1 * r) * Math.cos(la2 * r) * Math.cos((lo2 - lo1) * r);
  return (Math.atan2(y, x) / r + 360) % 360;
}
function km(la1: number, lo1: number, la2: number, lo2: number) {
  const r = Math.PI / 180, a = Math.sin((la2 - la1) * r / 2) ** 2 + Math.cos(la1 * r) * Math.cos(la2 * r) * Math.sin((lo2 - lo1) * r / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(a));
}
function regionOf(lat: number, lng: number) {
  const i = Math.floor((lat - GRID.lat0) / GRID.r), j = Math.floor((lng - GRID.lng0) / GRID.r);
  if (i < 0 || j < 0 || i >= GRID.rows || j >= GRID.cols) return "";
  const c = GRID.g.charCodeAt(i * GRID.cols + j) - 97;
  return c >= 0 && c < GRID.regions.length ? GRID.regions[c] : "";
}
function rgba(buf: ArrayBuffer) {
  const img = UPNG.decode(buf);
  return { w: img.width, h: img.height, px: new Uint8Array(UPNG.toRGBA8(img)[0]) };
}

// شبكة dBZ للسعودية من بلاطات الرادار (z6)
async function radarGrid(host: string, path: string) {
  const tx = (lng: number) => (lng + 180) / 360 * 2 ** Z, ty = (lat: number) => (1 - Math.asinh(Math.tan(lat * Math.PI / 180)) / Math.PI) / 2 * 2 ** Z;
  const x0 = Math.floor(tx(LNG0)), x1 = Math.floor(tx(LNG1)), y0 = Math.floor(ty(LAT1)), y1 = Math.floor(ty(LAT0));
  const tiles = new Map<string, { w: number; h: number; px: Uint8Array }>();
  await Promise.all([...Array(x1 - x0 + 1)].flatMap((_, i) => [...Array(y1 - y0 + 1)].map(async (_, j) => {
    const x = x0 + i, y = y0 + j;
    const r = await fetch(`${host}${path}/256/${Z}/${x}/${y}/2/0_0.png`);
    if (r.ok) tiles.set(x + "/" + y, rgba(await r.arrayBuffer()));
  })));
  const g = new Int8Array(ROWS * COLS).fill(-1);
  for (let i = 0; i < ROWS; i++) for (let j = 0; j < COLS; j++) {
    const lat = LAT0 + (i + .5) * STEP, lng = LNG0 + (j + .5) * STEP, fx = tx(lng), fy = ty(lat);
    const t = tiles.get(Math.floor(fx) + "/" + Math.floor(fy)); if (!t) continue;
    const X = Math.min(255, Math.floor((fx % 1) * 256)), Y = Math.min(255, Math.floor((fy % 1) * 256)), k = (Y * 256 + X) * 4;
    g[i * COLS + j] = dbz(t.px[k], t.px[k + 1], t.px[k + 2], t.px[k + 3]);
  }
  return { g, tiles: tiles.size };
}
// البرق (EUMETSAT MTG): مساحة الومضات المتراكمة على نفس الشبكة
async function lightningGrid() {
  const u = `https://view.eumetsat.int/geoserver/ows?service=WMS&version=1.3.0&request=GetMap&styles=&format=image/png&transparent=true&crs=EPSG:4326&width=${COLS}&height=${ROWS}&layers=mtg_fd:li_afa&bbox=${LAT0},${LNG0},${LAT1},${LNG1}`;
  const r = await fetch(u); if (!r.ok) return null;
  const { w, h, px } = rgba(await r.arrayBuffer());
  const g = new Uint8Array(ROWS * COLS);
  for (let i = 0; i < ROWS; i++) for (let j = 0; j < COLS; j++) {
    const X = Math.floor(j * w / COLS), Y = Math.floor((ROWS - 1 - i) * h / ROWS);   // الصورة من الشمال للجنوب
    if (px[(Y * w + X) * 4 + 3] > 30) g[i * COLS + j] = 1;
  }
  return g;
}

// تجميع مطر الرادار اليومي على شبكة 0.2° (لمؤشر الفقع والفياض): كل صورة رادار تُحوَّل لمطر بمعادلة مارشال-بالمر
// Z = 200·R^1.6 وتُضاف لصف اليوم (توقيت الرياض). hits = عدد الصور اللي فيها صدى ≥20 dBZ لكشف التشويش الثابت لاحقًا.
const RS = 4, RR = Math.ceil(ROWS / RS), RC = Math.ceil(COLS / RS);
const u16From = (b64: string) => { const n = RR * RC, out = new Uint16Array(n); if (!b64) return out; const bin = atob(b64); for (let k = 0; k < n && 2 * k + 1 < bin.length; k++) out[k] = bin.charCodeAt(2 * k) | (bin.charCodeAt(2 * k + 1) << 8); return out; };
const u16To = (a: Uint16Array) => { let s = ""; for (let k = 0; k < a.length; k++) s += String.fromCharCode(a[k] & 255, a[k] >> 8); return btoa(s); };
async function accumulateRadar(sb: SupabaseClient, g: Int8Array, frameTime: number) {
  const day = new Date(frameTime * 1000 + 3 * 3600e3).toISOString().slice(0, 10);
  const { data: row } = await sb.from("radar_daily").select("acc,hits,frames,last_frame").eq("day", day).maybeSingle();
  if (row && row.last_frame >= frameTime) return { day, skipped: true };
  const mins = row?.last_frame ? Math.min(10, Math.max(1, (frameTime - row.last_frame) / 60)) : 10;
  const acc = u16From(row?.acc || ""), hits = u16From(row?.hits || "");
  const sum = new Float32Array(RR * RC), hit = new Uint8Array(RR * RC);
  for (let i = 0; i < ROWS; i++) for (let j = 0; j < COLS; j++) {
    const d = g[i * COLS + j]; if (d < 15) continue;
    const k = Math.floor(i / RS) * RC + Math.floor(j / RS);
    sum[k] += Math.pow(Math.pow(10, Math.min(d, 55) / 10) / 200, 0.625);
    if (d >= 20) hit[k] = 1;
  }
  for (let k = 0; k < sum.length; k++) {
    if (sum[k] > 0) acc[k] = Math.min(65535, acc[k] + Math.round(sum[k] / (RS * RS) * mins / 60 * 10));
    if (hit[k]) hits[k] = Math.min(65535, hits[k] + 1);
  }
  await sb.from("radar_daily").upsert({ day, acc: u16To(acc), hits: u16To(hits), frames: (row?.frames || 0) + 1, last_frame: frameTime, updated_at: new Date().toISOString() });
  return { day, frames: (row?.frames || 0) + 1 };
}

async function sendRegion(sb: SupabaseClient, cfg: Record<string, string>, region: string, p: { title: string; body: string; url: string; tag: string }) {
  let web = 0, ios = 0;
  try {
    webpush.setVapidDetails(cfg.vapid_subject, cfg.vapid_public, cfg.vapid_private);
    // لمشتركي المنطقة نفسها فقط — «كل المناطق» ما توصلهم تنبيهات المطر التلقائية (كانت توصلهم من كل المملكة ~16 باليوم)
    const { data } = await sb.from("push_subs").select("endpoint,p256dh,auth").eq("region", region).order("created_at", { ascending: true }).limit(5000);
    const gone: string[] = [];
    await Promise.allSettled((data || []).map(async (s) => {
      try { await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(p), { TTL: 2 * 3600, urgency: "high" }); web++; }
      catch (e) { const c = (e as { statusCode?: number }).statusCode; if (c === 400 || c === 403 || c === 404 || c === 410) gone.push(s.endpoint); }
    }));
    if (gone.length) await sb.from("push_subs").delete().in("endpoint", gone);
  } catch (e) { console.error("web push", e); }
  try {
    const jwt = await apnsToken(sb);
    if (jwt) {
      const { data } = await sb.from("push_native").select("token").eq("region", region).order("updated_at", { ascending: false }).limit(20000);
      const body = JSON.stringify({ aps: { alert: { title: p.title, body: p.body }, sound: "default", "thread-id": p.tag }, url: p.url });
      const gone: string[] = [];
      await Promise.allSettled((data || []).map(async (r) => {
        const res = await fetch("https://api.push.apple.com/3/device/" + r.token, { method: "POST", body,
          headers: { authorization: "bearer " + jwt, "apns-topic": "com.alluhaybi.dalil", "apns-push-type": "alert", "apns-priority": "10",
            "apns-expiration": String(Math.floor(Date.now() / 1000) + 2 * 3600), "content-type": "application/json" } });
        if (res.ok) ios++; else { const t = await res.text().catch(() => ""); if (res.status === 410 || /BadDeviceToken|Unregistered|DeviceTokenNotForTopic/.test(t)) gone.push(r.token); }
      }));
      if (gone.length) await sb.from("push_native").delete().in("token", gone);
    }
  } catch (e) { console.error("apns", e); }
  return { web, ios };
}

Deno.serve(async (req) => {
  const url = new URL(req.url), dry = url.searchParams.get("dry") === "1";
  const sb = db();
  // آخر فحص — يظهر في لوحة الإدارة
  const done = async (o: Record<string, unknown>, status = 200) => {
    if (!dry) await sb.from("private_config").upsert({ key: "auto_alerts_last", value: JSON.stringify({ at: new Date().toISOString(), ...o, regions: undefined, sent: ((o.regions as { skipped?: string }[] | undefined) || []).filter((r) => !r.skipped).length, skipped: ((o.regions as { region: string; skipped?: string }[] | undefined) || []).filter((r) => r.skipped).map((r) => r.region + ":" + r.skipped) }) }).then(() => {}, () => {});
    return Response.json(o, { status });
  };
  try {
    const { data: keyRow } = await sb.from("private_config").select("value").eq("key", "cron_key").maybeSingle();
    if (!keyRow?.value || req.headers.get("x-cron-key") !== keyRow.value) return new Response(JSON.stringify({ error: "forbidden" }), { status: 403 });
    const cfg = await config(sb);
    // يُقرأ مباشرة (بدون الذاكرة المؤقتة) حتى يسري زر الإيقاف في لوحة الإدارة فورًا
    const { data: sw } = await sb.from("app_config").select("value").eq("key", "auto_alerts").maybeSingle();
    const off = sw?.value === "off" && !dry;   // الإيقاف يوقف الإرسال بس؛ تجميع مطر الرادار يكمل

    const j = await (await fetch("https://api.rainviewer.com/public/weather-maps.json")).json();
    const past = j.radar?.past || []; if (past.length < 4) return done({ ok: false, error: "no_frames" });
    const now = past[past.length - 1], prev = past[past.length - 4], old = past[0];
    const ageMin = Math.round(Date.now() / 60e3 - now.time / 60);
    if (ageMin > 40) return done({ ok: false, error: "stale", ageMin });
    const [N, P, O, L] = await Promise.all([radarGrid(j.host, now.path), radarGrid(j.host, prev.path), radarGrid(j.host, old.path), lightningGrid()]);
    let radarAcc: unknown = null;
    if (!dry && N.tiles >= 10) radarAcc = await accumulateRadar(sb, N.g, now.time).catch((e) => ({ error: String(e?.message || e).slice(0, 80) }));
    if (off) return done({ ok: true, off: true, radarAcc });
    const near = (g: Uint8Array | Int8Array, i: number, jj: number, r: number, test: (v: number) => boolean) => {
      for (let a = -r; a <= r; a++) for (let b = -r; b <= r; b++) { const y = i + a, x = jj + b; if (y >= 0 && x >= 0 && y < ROWS && x < COLS && test(g[y * COLS + x])) return true; }
      return false;
    };
    // خلايا غزيرة: ≥40 dBZ الآن، ليست تشويشًا ثابتًا (موجودة في نفس المكان قبل ساعتين وقبل 30 د)، ومؤكدة ببرق خلال ~10 كم
    type Cell = { i: number; j: number; d: number };
    const byRegion = new Map<string, Cell[]>();
    let heavyRaw = 0, clutter = 0, noLightning = 0;
    for (let i = 0; i < ROWS; i++) for (let jj = 0; jj < COLS; jj++) {
      const d = N.g[i * COLS + jj]; if (d < HEAVY) continue; heavyRaw++;
      if (O.g[i * COLS + jj] >= 0 && P.g[i * COLS + jj] >= 0 && O.g[i * COLS + jj] >= d - 10) { clutter++; continue; }
      if (L && !near(L, i, jj, 2, (v) => v === 1)) { noLightning++; continue; }
      const reg = regionOf(LAT0 + (i + .5) * STEP, LNG0 + (jj + .5) * STEP); if (!reg) continue;
      if (!byRegion.has(reg)) byRegion.set(reg, []);
      byRegion.get(reg)!.push({ i, j: jj, d });
    }
    // حركة المطر: أفضل إزاحة بين قبل 30 د والآن لخلايا ≥30 dBZ — لكل منطقة حول مطرها (~200 كم)، مو رقم واحد للمملكة كلها
    // (لو فيه مطرين يتحركون باتجاهات مختلفة، الرقم الواحد يعطي اتجاهًا غلط لأحدهم). عند التعادل نأخذ أصغر إزاحة.
    const motionAt = (ci: number, cj: number, R = 40) => {
      const A: number[] = [];
      for (let y = Math.max(0, ci - R); y <= Math.min(ROWS - 1, ci + R); y++) for (let x = Math.max(0, cj - R); x <= Math.min(COLS - 1, cj + R); x++) if (P.g[y * COLS + x] >= 30) A.push(y * COLS + x);
      if (A.length < 20) return null;
      let best = -1, bx = 0, by = 0;
      for (let dy = -8; dy <= 8; dy++) for (let dx = -8; dx <= 8; dx++) {
        let c = 0; for (const k of A) { const y = (k / COLS | 0) + dy, x = k % COLS + dx; if (y >= 0 && x >= 0 && y < ROWS && x < COLS && N.g[y * COLS + x] >= 30) c++; }
        if (c > best || (c === best && dx * dx + dy * dy < bx * bx + by * by)) { best = c; bx = dx; by = dy; }
      }
      if (best < A.length * 0.25) return null;
      const mins = (now.time - prev.time) / 60, kmh = Math.hypot(bx * STEP * 111 * Math.cos(25 * Math.PI / 180), by * STEP * 111) / mins * 60;
      return kmh >= 8 && kmh <= 120 ? { kmh: Math.round(kmh), dir: dirWord(Math.atan2(bx * Math.cos(25 * Math.PI / 180), by) * 180 / Math.PI) } : null;
    };
    const motion = motionAt(ROWS >> 1, COLS >> 1, Math.max(ROWS, COLS));   // للسجل فقط

    // سجل آخر 24 ساعة للمنطقة: الحد اليومي، الفاصل بين التنبيهين، ونفس العاصفة
    const { data: recent } = await sb.from("auto_alerts").select("region,at,lat,lng").gte("at", new Date(Date.now() - 24 * 3600e3).toISOString());
    const dayStart = new Date(Math.floor((Date.now() + 3 * 3600e3) / 864e5) * 864e5 - 3 * 3600e3).getTime();   // منتصف ليل الرياض
    const why = (region: string, la: number, lo: number) => {
      const rows = (recent || []).filter((r) => r.region === region);
      if (rows.filter((r) => Date.parse(r.at) >= dayStart).length >= DAY_MAX) return "daily_cap";
      if (rows.some((r) => Date.now() - Date.parse(r.at) < COOLDOWN_H * 3600e3)) return "cooldown";
      if (rows.some((r) => Date.now() - Date.parse(r.at) < SAME_H * 3600e3 && r.lat != null && km(r.lat, r.lng, la, lo) < SAME_KM)) return "same_storm";
      const towns = TOWNS[region];
      if (towns && Math.min(...towns.map(([a, b]) => km(a, b, la, lo))) > FAR_KM) return "far";
      return "";
    };
    const out: unknown[] = [];
    const cands = [...byRegion.entries()].filter(([, c]) => c.length >= MIN_CELLS).sort((a, b) => b[1].length - a[1].length);
    for (const [region, cells] of cands.slice(0, 4)) {
      const max = Math.max(...cells.map((c) => c.d));
      const cLat = LAT0 + (cells.reduce((s, c) => s + c.i, 0) / cells.length + .5) * STEP, cLng = LNG0 + (cells.reduce((s, c) => s + c.j, 0) / cells.length + .5) * STEP;
      const [city, la, lo] = CITY[region] || [region, cLat, cLng];
      const mv = motionAt(Math.round((cLat - LAT0) / STEP - .5), Math.round((cLng - LNG0) / STEP - .5));
      const dist = km(la, lo, cLat, cLng), where = dist < 15 ? "على " + city : dir2(bearing(la, lo, cLat, cLng)) + " " + city + " بنحو " + Math.round(dist / 5) * 5 + " كم";
      const what = max >= 55 ? "عواصف رعدية قوية مع احتمال برد" : max >= 50 ? "عواصف رعدية وأمطار غزيرة جدًا" : "أمطار غزيرة وبرق";
      const p = {
        title: (max >= 50 ? "⛈️ " : "🌧️ ") + what + " — منطقة " + region,
        body: "الآن " + where + (mv ? "، تتجه " + mv.dir + " (" + mv.kmh + " كم/س)" : "") + ". ابتعد عن بطون الأودية والشعبان — افتح الرادار في دليل.",
        url: "./?screen=track", tag: "auto-rain-" + region,
      };
      const skip = why(region, cLat, cLng);
      if (skip) { out.push({ region, cells: cells.length, max, skipped: skip, ...p }); continue; }
      if (dry) { out.push({ region, cells: cells.length, max, dry: true, ...p }); continue; }
      const sent = await sendRegion(sb, cfg, region, p);
      await sb.from("auto_alerts").insert({ region, title: p.title, body: p.body, cells: cells.length, max_dbz: max, sent_web: sent.web, sent_ios: sent.ios, lat: Math.round(cLat * 100) / 100, lng: Math.round(cLng * 100) / 100 });
      out.push({ region, cells: cells.length, max, ...sent, ...p });
    }
    if (Math.random() < 0.05) await sb.from("auto_alerts").delete().lt("at", new Date(Date.now() - 7 * 86400e3).toISOString());
    return done({ ok: true, frame: new Date(now.time * 1000).toISOString(), ageMin, tiles: N.tiles, lightning: !!L, heavyRaw, clutter, noLightning, motion, radarAcc, regions: out, ...(dry ? { gridSum: GRID_SUM } : {}) });
  } catch (e) {
    console.error("dalil-alerts", e);
    return done({ ok: false, error: String((e as Error)?.message || e).slice(0, 200) }, 500);
  }
});
function dir2(deg: number) { return DIRS[Math.round(((deg % 360) + 360) % 360 / 45) % 8]; }
