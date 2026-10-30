// قياس دقة الرادار: كل 10 دقائق (pg_cron) نقرأ تقارير مطارات المملكة (OE..) (METAR — عامة من aviationweather.gov)
// ونقارنها بالرادار فوق المطار نفسه، بنفس حساب «المطر فوقك» في التطبيق (RainViewer z7 بدون تنعيم، ±1 بكسل).
// النتائج في جدول wx_verify وتظهر في لوحة الإدارة (لا يُعرض شي للمستخدمين).
import UPNG from "npm:upng-js@2.1.0";
import { db } from "../_shared/common.ts";

const Z = 7;
const PAL: number[][] = [[0,0x82,0x7b,0x69],[5,0x92,0x88,0x71],[10,0xce,0xc0,0x87],[15,0x88,0xdd,0xee],[20,0x00,0xa3,0xe0],[25,0x00,0x77,0xaa],[30,0x00,0x55,0x88],[35,0xff,0xee,0x00],[40,0xff,0xaa,0x00],[45,0xff,0x44,0x00],[50,0xc1,0x00,0x00],[55,0xff,0xaa,0xff],[60,0xff,0x77,0xff],[65,0xff,0xff,0xff]];
const dbz = (r: number, g: number, b: number, a: number) => { if (a <= 40) return -1; let best = 1e9, v = -1; for (const [d, R, G, B] of PAL) { const e = (r - R) ** 2 + (g - G) ** 2 + (b - B) ** 2; if (e < best) { best = e; v = d; } } return v; };
const px = (lat: number, lng: number) => [(lng + 180) / 360 * 256 * 2 ** Z, (1 - Math.asinh(Math.tan(lat * Math.PI / 180)) / Math.PI) / 2 * 256 * 2 ** Z];

// METAR: RA مطر، DZ رذاذ، SH زخات، TS رعد، GR/GS برد. VC = بالجوار (8–16 كم). + = غزير
function cat(wx: string) {
  const t = (wx || "").split(/\s+/).filter(Boolean);
  let c = 0;
  for (const w of t) {
    if (/^VC(SH|TS)/.test(w)) { c = Math.max(c, 1); continue; }
    if (/TS|GR|GS/.test(w) || (/^\+/.test(w) && /RA|SH|DZ/.test(w))) c = 3;
    else if (/RA|DZ|SH|UP/.test(w)) c = Math.max(c, 2);
  }
  return c;
}

Deno.serve(async (req) => {
  const sb = db(), dry = new URL(req.url).searchParams.get("dry") === "1";
  try {
    const { data: keyRow } = await sb.from("private_config").select("value").eq("key", "cron_key").maybeSingle();
    if (!keyRow?.value || req.headers.get("x-cron-key") !== keyRow.value) return Response.json({ error: "forbidden" }, { status: 403 });
    const mr = await fetch("https://aviationweather.gov/api/data/metar?bbox=16,34,32.5,56&hours=2&format=json", { headers: { "user-agent": "dalil-app (radar verification)" } });
    if (!mr.ok) return Response.json({ ok: false, error: "metar " + mr.status });
    const metars = (await mr.json()) as Record<string, unknown>[];
    const rv = await (await fetch("https://api.rainviewer.com/public/weather-maps.json")).json();
    const frames = (rv.radar?.past || []) as { time: number; path: string }[];
    if (!frames.length) return Response.json({ ok: false, error: "no_frames" });
    // اللي سجّلناه قبل (نفس المطار ونفس وقت التقرير) ما نعيده
    const { data: done } = await sb.from("wx_verify").select("station,obs_at").gte("obs_at", new Date(Date.now() - 3 * 3600e3).toISOString());
    const seen = new Set((done || []).map((d) => d.station + "|" + new Date(d.obs_at).getTime()));
    const tiles = new Map<string, Promise<{ px: Uint8Array } | null>>();
    const tile = (path: string, x: number, y: number) => {
      const k = path + "/" + x + "/" + y;
      if (!tiles.has(k)) tiles.set(k, fetch(`${rv.host}${path}/256/${Z}/${x}/${y}/2/0_1.png`).then(async (r) => {
        if (!r.ok) return null; const img = UPNG.decode(await r.arrayBuffer()); return { px: new Uint8Array(UPNG.toRGBA8(img)[0]) };
      }).catch(() => null));
      return tiles.get(k)!;
    };
    const at = async (path: string, X: number, Y: number) => {
      const t = await tile(path, Math.floor(X / 256), Math.floor(Y / 256)); if (!t) return null;
      const k = ((Y % 256) * 256 + (X % 256)) * 4; return dbz(t.px[k], t.px[k + 1], t.px[k + 2], t.px[k + 3]);
    };
    const maxAround = async (path: string, X: number, Y: number, r: number) => {
      let m: number | null = null;
      for (let j = -r; j <= r; j++) for (let i = -r; i <= r; i++) { const v = await at(path, X + i, Y + j); if (v != null && (m == null || v > m)) m = v; }
      return m;
    };
    const rows: Record<string, unknown>[] = [];
    for (const m of metars) {
      const st = String(m.icaoId || ""), lat = Number(m.lat), lng = Number(m.lon);
      const t = typeof m.obsTime === "number" ? m.obsTime * 1000 : Date.parse(String(m.reportTime || m.obsTime || ""));
      if (!/^OE[A-Z0-9]{2}$/.test(st) || !Number.isFinite(lat) || !Number.isFinite(lng) || !Number.isFinite(t)) continue;
      if (seen.has(st + "|" + t)) continue;
      // أقرب صورة رادار لوقت التقرير (لازم خلال 6 دقائق — الصور كل 10 د)
      const f = frames.reduce((a, b) => Math.abs(b.time * 1000 - t) < Math.abs(a.time * 1000 - t) ? b : a);
      if (Math.abs(f.time * 1000 - t) > 6 * 60e3) continue;
      const [x, y] = px(lat, lng), X = Math.floor(x), Y = Math.floor(y);
      const here = await maxAround(f.path, X, Y, 1), near = await maxAround(f.path, X, Y, 4);
      // الطقس: من wxString، وإذا ما وُجد نقرأه من نص التقرير (قبل RMK)
      const wx = String(m.wxString || "") || String(m.rawOb || "").split(" RMK")[0].split(/\s+/).filter((w) => /^(\+|-|VC)?(TS|SH)?(RA|DZ|GR|GS|UP)+$|^(\+|-|VC)?TS$|^VCSH$/.test(w)).join(" ");
      rows.push({ station: st, name: String(m.name || "").slice(0, 60), lat, lng, obs_at: new Date(t).toISOString(), frame: new Date(f.time * 1000).toISOString(),
        wx: wx.slice(0, 40), raw: String(m.rawOb || "").slice(0, 200), obs_cat: cat(wx), dbz_here: here, dbz_near: near });
      seen.add(st + "|" + t);
    }
    if (!dry && rows.length) { const { error } = await sb.from("wx_verify").upsert(rows, { onConflict: "station,obs_at", ignoreDuplicates: true }); if (error) throw error; }
    if (!dry && Math.random() < 0.02) await sb.from("wx_verify").delete().lt("obs_at", new Date(Date.now() - 90 * 864e5).toISOString());
    return Response.json({ ok: true, metars: metars.length, added: rows.length, ...(dry ? { sample: rows.slice(0, 8), keys: Object.keys(metars[0] || {}) } : {}) });
  } catch (e) {
    console.error("dalil-verify", e);
    return Response.json({ ok: false, error: String((e as Error)?.message || e).slice(0, 200) }, { status: 500 });
  }
});
