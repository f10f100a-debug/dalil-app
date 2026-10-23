// Public endpoint for the Dalil app: submit an event photo, report one, (un)subscribe to push.
// Reading approved events goes straight through the REST API (RLS allows only approved, live rows).
import { cleanText, cleanup, config, cors, db, ipHash, json, KINDS, REGIONS, validPushEndpoint } from "../_shared/common.ts";

const MAX_PHOTO = 900 * 1024;
const MAX_THUMB = 120 * 1024;
const MAX_VIDEO = 3 * 1024 * 1024;   // فيديو قصير حتى 10 ثوانٍ، مضغوط في الجوال (~1–2 ميقا)
const isMp4 = (b: Uint8Array) => b.length > 12 && b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70;  // ftyp
const MAX_POSTS_PER_DAY = 10;
const MAX_PENDING = 300;
const REPORTS_TO_HIDE = 3;
// اشتراكات تنبيهات «جديدة» من نفس الشبكة: 50 باليوم بالكثير (يمنع إغراق النظام باشتراكات وهمية).
// تجديد اشتراك موجود ما يُحسب (التطبيق يجدّده عند كل فتح)
async function newSubLimited(sb: ReturnType<typeof db>, ip: string) {
  const since = new Date(Date.now() - 86400e3).toISOString();
  const { count } = await sb.from("room_attempts").select("ip_hash", { count: "exact", head: true }).eq("ip_hash", ip).eq("kind", "newsub").gte("created_at", since);
  if ((count ?? 0) >= 50) return true;
  await sb.from("room_attempts").insert({ ip_hash: ip, kind: "newsub" });
  return false;
}

// تقارير المطارات (METAR): ذاكرة 10 دقائق لكل منطقة، وأسماء عربية لمحطات المملكة
const OBS_CACHE = new Map<string, { at: number; list: unknown[] }>();
const STATION_AR: Record<string, string> = {
  OEHL: "مطار حائل", OERK: "مطار الرياض", OEJN: "مطار جدة", OEDF: "مطار الدمام", OEMA: "مطار المدينة", OETB: "مطار تبوك",
  OEGS: "مطار القصيم", OEAB: "مطار أبها", OEGN: "مطار جازان", OENG: "مطار نجران", OESK: "مطار الجوف", OEAR: "مطار عرعر",
  OERF: "مطار رفحاء", OETF: "مطار الطائف", OEBA: "مطار الباحة", OEWD: "مطار وادي الدواسر", OEBH: "مطار بيشة", OEPA: "مطار القيصومة",
  OEAH: "مطار الأحساء", OEYN: "مطار ينبع", OEWJ: "مطار الوجه", OEUL: "مطار العلا", OETR: "مطار طريف", OEDW: "مطار الدوادمي",
  OESH: "مطار شرورة", OEKK: "مدينة الملك خالد العسكرية", OEDR: "الظهران", OERY: "الرياض", OEKM: "خميس مشيط",
};

function isJpeg(b: Uint8Array) { return b.length > 4 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff; }
function num(v: FormDataEntryValue | null, min: number, max: number): number | null {
  if (v === null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= min && n <= max ? n : null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(req) });
  if (req.method !== "POST") return json(req, { error: "method" }, 405);
  const action = new URL(req.url).searchParams.get("a") || "";
  const sb = db();
  try {
    const cfg = await config(sb);
    const ip = await ipHash(req, cfg.ip_salt);

    if (action === "submit") {
      const len = Number(req.headers.get("content-length") || 0);
      if (len > MAX_PHOTO + MAX_THUMB + MAX_VIDEO + 20000) return json(req, { error: "too_large" }, 413);
      const since = new Date(Date.now() - 86400e3).toISOString();
      const { count: mine } = await sb.from("events").select("id", { count: "exact", head: true }).eq("ip_hash", ip).gte("created_at", since);
      if ((mine ?? 0) >= MAX_POSTS_PER_DAY) return json(req, { error: "rate_limited" }, 429);
      const { count: pending } = await sb.from("events").select("id", { count: "exact", head: true }).eq("status", "pending");
      if ((pending ?? 0) >= MAX_PENDING) return json(req, { error: "busy" }, 503);

      const form = await req.formData();
      const photo = form.get("photo"), thumb = form.get("thumb");
      if (!(photo instanceof File) || !(thumb instanceof File)) return json(req, { error: "photo_required" }, 400);
      if (photo.size > MAX_PHOTO || thumb.size > MAX_THUMB) return json(req, { error: "too_large" }, 413);
      const photoBytes = new Uint8Array(await photo.arrayBuffer());
      const thumbBytes = new Uint8Array(await thumb.arrayBuffer());
      if (!isJpeg(photoBytes) || !isJpeg(thumbBytes)) return json(req, { error: "bad_image" }, 415);
      const video = form.get("video");
      let videoBytes: Uint8Array | null = null, videoDur: number | null = null;
      if (video instanceof File && video.size > 0) {
        if (video.size > MAX_VIDEO) return json(req, { error: "too_large" }, 413);
        videoBytes = new Uint8Array(await video.arrayBuffer());
        if (!isMp4(videoBytes)) return json(req, { error: "bad_video" }, 415);
        videoDur = num(form.get("vdur"), 0.5, 11);
        if (videoDur === null) return json(req, { error: "bad_video" }, 400);
      }

      const kind = String(form.get("kind") || "");
      if (!KINDS.includes(kind)) return json(req, { error: "bad_kind" }, 400);
      const regionIn = cleanText(form.get("region"), 40);
      const region = REGIONS.includes(regionIn) ? regionIn : "";
      let lat = num(form.get("lat"), -90, 90), lng = num(form.get("lng"), -180, 180);
      if (lat === null || lng === null) { lat = null; lng = null; }
      else { lat = Math.round(lat * 1e4) / 1e4; lng = Math.round(lng * 1e4) / 1e4; }

      const id = crypto.randomUUID();
      const photoPath = `${id}.jpg`, thumbPath = `${id}_t.jpg`;
      const up1 = await sb.storage.from("pending").upload(photoPath, photoBytes, { contentType: "image/jpeg" });
      if (up1.error) throw up1.error;
      const up2 = await sb.storage.from("pending").upload(thumbPath, thumbBytes, { contentType: "image/jpeg" });
      if (up2.error) { await sb.storage.from("pending").remove([photoPath]); throw up2.error; }
      const videoPath = videoBytes ? `${id}.mp4` : null;
      if (videoBytes && videoPath) {
        const up3 = await sb.storage.from("pending").upload(videoPath, videoBytes, { contentType: "video/mp4" });
        if (up3.error) { await sb.storage.from("pending").remove([photoPath, thumbPath]); throw up3.error; }
      }

      const { error } = await sb.from("events").insert({
        id, kind, region, lat, lng,
        caption: cleanText(form.get("caption"), 140),
        nickname: cleanText(form.get("nickname"), 24),
        device: cleanText(form.get("device"), 64),
        width: num(form.get("w"), 1, 10000), height: num(form.get("h"), 1, 10000),
        photo_path: photoPath, thumb_path: thumbPath, ip_hash: ip, video_path: videoPath, video_dur: videoDur,
      });
      if (error) { await sb.storage.from("pending").remove([photoPath, thumbPath, ...(videoPath ? [videoPath] : [])]); throw error; }
      if (Math.random() < 0.2) {
        const job = cleanup(sb).catch((e) => console.error("cleanup", e));
        (globalThis as any).EdgeRuntime?.waitUntil?.(job);
      }
      return json(req, { ok: true, id });
    }

    const body = await req.json().catch(() => ({}));

    if (action === "report") {
      const id = String(body.id || "");
      if (!/^[0-9a-f-]{36}$/.test(id)) return json(req, { error: "bad_id" }, 400);
      const since = new Date(Date.now() - 86400e3).toISOString();
      const { count: mine } = await sb.from("reports").select("event_id", { count: "exact", head: true }).eq("ip_hash", ip).gte("created_at", since);
      if ((mine ?? 0) >= 30) return json(req, { error: "rate_limited" }, 429);
      const { data: ev } = await sb.from("events").select("id,status").eq("id", id).maybeSingle();
      if (!ev || ev.status !== "approved") return json(req, { ok: true });
      await sb.from("reports").upsert({ event_id: id, ip_hash: ip }, { onConflict: "event_id,ip_hash", ignoreDuplicates: true });
      const { count } = await sb.from("reports").select("event_id", { count: "exact", head: true }).eq("event_id", id);
      await sb.from("events").update({ reports: count ?? 0, ...((count ?? 0) >= REPORTS_TO_HIDE ? { status: "hidden" } : {}) }).eq("id", id);
      return json(req, { ok: true });
    }

    if (action === "subscribe") {
      const endpoint = String(body.endpoint || "");
      const p256dh = String(body.keys?.p256dh || ""), auth = String(body.keys?.auth || "");
      if (!validPushEndpoint(endpoint) || !/^[A-Za-z0-9_-]{40,200}$/.test(p256dh) || !/^[A-Za-z0-9_-]{8,100}$/.test(auth)) {
        return json(req, { error: "bad_subscription" }, 400);
      }
      const regionIn = cleanText(body.region, 40);
      const region = REGIONS.includes(regionIn) ? regionIn : "";
      const { data: had } = await sb.from("push_subs").select("endpoint").eq("endpoint", endpoint).maybeSingle();
      if (!had && await newSubLimited(sb, ip)) return json(req, { error: "rate_limited" }, 429);
      const { error } = await sb.from("push_subs").upsert({ endpoint, p256dh, auth, region }, { onConflict: "endpoint" });
      if (error) throw error;
      return json(req, { ok: true });
    }

    // عدّاد استخدام مجهول: مرة يوميًا لكل جهاز/IP، مع المنطقة فقط (بدون موقع).
    if (action === "ping") {
      const regionIn = cleanText(body.region, 40);
      const region = REGIONS.includes(regionIn) ? regionIn : "";
      const { data: fresh } = await sb.rpc("dalil_count", { p_ip: ip, p_key: "open", p_region: region, p_ad: null, p_kind: "open" });
      // أجهزة مختلفة بدون معرّف: «كم يوم من آخر فتح» (31 = أول مرة)
      const gap = Math.round(Number(body.gap));
      if (fresh === true && gap >= 1 && gap <= 31) await sb.rpc("dalil_gap", { p_gap: gap }).then(() => {}, () => {});
      return json(req, { ok: true });
    }

    // ظهور إعلان أو الضغط عليه (يُحسب مرة يوميًا لكل IP).
    if (action === "ad") {
      const id = String(body.id || ""), kind = String(body.kind || "");
      if (!/^[0-9a-f-]{36}$/.test(id) || !["imp", "click"].includes(kind)) return json(req, { error: "bad_request" }, 400);
      const regionIn = cleanText(body.region, 40);
      const region = REGIONS.includes(regionIn) ? regionIn : "";
      const { error } = await sb.rpc("dalil_count", { p_ip: ip, p_key: kind + ":" + id, p_region: region, p_ad: id, p_kind: kind });
      if (error && !String(error.message || "").includes("foreign key")) console.error("ad count", error.message);
      return json(req, { ok: true });
    }

    // تقرير خطأ من التطبيق: نص الخطأ ومكانه وإصدار التطبيق فقط (حد 40 في اليوم لكل IP)، تُحذف بعد 14 يومًا
    if (action === "err") {
      const msg = cleanText(body.msg, 300);
      if (!msg) return json(req, { ok: true });
      const { count } = await sb.from("client_errors").select("id", { count: "exact", head: true }).eq("ip_hash", ip).gte("at", new Date(Date.now() - 86400e3).toISOString());
      if ((count ?? 0) >= 40) return json(req, { ok: true });
      await sb.from("client_errors").insert({ ip_hash: ip, msg, src: cleanText(body.src, 160), ver: cleanText(body.ver, 40), page: cleanText(body.page, 40) });
      if (Math.random() < 0.05) await sb.from("client_errors").delete().lt("at", new Date(Date.now() - 14 * 86400e3).toISOString());
      return json(req, { ok: true });
    }

    // تشخيص البوصلة أثناء القيادة (مؤقت، يُفعَّل يدويًا في جوال صاحب التطبيق): زوايا وسرعات وأوقات فقط — بدون أي موقع
    if (action === "hdiag") {
      const msg = String(body.msg || "").slice(0, 4000);
      if (!msg || !/^[a-z0-9,;.\-]+$/i.test(msg)) return json(req, { ok: true });
      const { count } = await sb.from("client_errors").select("id", { count: "exact", head: true }).eq("ip_hash", ip).eq("page", "heading").gte("at", new Date(Date.now() - 86400e3).toISOString());
      if ((count ?? 0) >= 60) return json(req, { ok: true });
      await sb.from("client_errors").insert({ ip_hash: ip, msg, src: "heading:" + (Number(body.n) || 0), ver: cleanText(body.ver, 40), page: "heading" });
      return json(req, { ok: true });
    }

    // الرياح الفعلية الآن من أقرب محطة رصد (تقارير المطارات METAR) — المتصفح ما يقدر يقرأها مباشرة (CORS)
    if (action === "obs") {
      const lat = Number(body.lat), lng = Number(body.lng);
      if (!(lat > 12 && lat < 35 && lng > 32 && lng < 60)) return json(req, { error: "bad_request" }, 400);
      const key = (Math.round(lat * 2) / 2) + "," + (Math.round(lng * 2) / 2);
      let hit = OBS_CACHE.get(key);
      if (!hit || Date.now() - hit.at > 10 * 60e3) {
        const r = await fetch(`https://aviationweather.gov/api/data/metar?bbox=${(lat - 1.5).toFixed(2)},${(lng - 1.5).toFixed(2)},${(lat + 1.5).toFixed(2)},${(lng + 1.5).toFixed(2)}&format=json&hours=2`).catch(() => null);
        const list = r && r.ok ? await r.json().catch(() => []) : [];
        hit = { at: Date.now(), list: Array.isArray(list) ? list : [] };
        OBS_CACHE.set(key, hit);
        if (OBS_CACHE.size > 200) OBS_CACHE.delete(OBS_CACHE.keys().next().value!);
      }
      const km = (a: number, b: number) => { const p = Math.PI / 180, x = Math.sin((a - lat) * p / 2) ** 2 + Math.cos(lat * p) * Math.cos(a * p) * Math.sin((b - lng) * p / 2) ** 2; return 12742 * Math.asin(Math.sqrt(x)); };
      const latest = new Map<string, Record<string, unknown>>();
      for (const m of hit.list as Record<string, unknown>[]) { const id = String(m.icaoId || ""); const prev = latest.get(id); if (!prev || Number(m.obsTime) > Number(prev.obsTime)) latest.set(id, m); }
      const best = [...latest.values()].map((m) => ({ m, d: km(Number(m.lat), Number(m.lon)) })).filter((x) => Number.isFinite(x.d) && x.d <= 120).sort((a, b) => a.d - b.d)[0];
      if (!best) return json(req, { ok: true, obs: null });
      const m = best.m, icao = String(m.icaoId || "");
      return json(req, { ok: true, obs: {
        icao, name: STATION_AR[icao] || ("محطة " + icao), km: Math.round(best.d),
        dir: typeof m.wdir === "number" ? m.wdir : null, vrb: m.wdir === "VRB",
        kmh: Number.isFinite(Number(m.wspd)) ? Math.round(Number(m.wspd) * 1.852) : null,
        gust: Number.isFinite(Number(m.wgst)) ? Math.round(Number(m.wgst) * 1.852) : null,
        temp: Number.isFinite(Number(m.temp)) ? Number(m.temp) : null, at: Number(m.obsTime) * 1000,
      } });
    }

    // «مطر عندي الآن»: موقع تقريبي (منزلتان عشريتان ≈ 1 كم) + الشدة. بلاغ كل 10 دقائق و12 في اليوم لكل IP
    if (action === "rain") {
      const lat = Number(body.lat), lng = Number(body.lng), level = Number(body.level);
      if (!(lat > 15 && lat < 33 && lng > 33 && lng < 57) || ![1, 2, 3].includes(level)) return json(req, { error: "bad_request" }, 400);
      const { data: mine } = await sb.from("rain_reports").select("at").eq("ip_hash", ip).gte("at", new Date(Date.now() - 86400e3).toISOString()).order("at", { ascending: false }).limit(12);
      if ((mine || []).length >= 12 || (mine?.[0] && Date.now() - new Date(mine[0].at).getTime() < 10 * 60e3)) return json(req, { ok: false, error: "wait" });
      const { error } = await sb.from("rain_reports").insert({ lat: Math.round(lat * 100) / 100, lng: Math.round(lng * 100) / 100, level, ip_hash: ip });
      if (error) throw error;
      if (Math.random() < 0.1) await sb.from("rain_reports").delete().lt("at", new Date(Date.now() - 86400e3).toISOString());
      return json(req, { ok: true });
    }

    if (action === "unsubscribe") {
      const endpoint = String(body.endpoint || "");
      if (endpoint) await sb.from("push_subs").delete().eq("endpoint", endpoint);
      return json(req, { ok: true });
    }

    // تنبيهات تطبيق الآيفون (APNs): رمز الجهاز (hex) والمنطقة فقط
    if (action === "subscribe_native") {
      const token = String(body.token || "").toLowerCase();
      if (!/^[0-9a-f]{64,200}$/.test(token)) return json(req, { error: "bad_token" }, 400);
      const regionIn = cleanText(body.region, 40);
      const region = REGIONS.includes(regionIn) ? regionIn : "";
      const { data: had } = await sb.from("push_native").select("token").eq("token", token).maybeSingle();
      if (!had && await newSubLimited(sb, ip)) return json(req, { error: "rate_limited" }, 429);
      const { error } = await sb.from("push_native").upsert({ token, region, updated_at: new Date().toISOString() }, { onConflict: "token" });
      if (error) throw error;
      return json(req, { ok: true });
    }
    if (action === "unsubscribe_native") {
      const token = String(body.token || "").toLowerCase();
      if (/^[0-9a-f]{64,200}$/.test(token)) await sb.from("push_native").delete().eq("token", token);
      return json(req, { ok: true });
    }

    return json(req, { error: "unknown_action" }, 400);
  } catch (e) {
    console.error("dalil-public", action, e);
    return json(req, { error: "server" }, 500);
  }
});
