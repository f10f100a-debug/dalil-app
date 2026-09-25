// Public endpoint for the Dalil app: submit an event photo, report one, (un)subscribe to push.
// Reading approved events goes straight through the REST API (RLS allows only approved, live rows).
import { cleanText, cleanup, config, cors, db, ipHash, json, KINDS, REGIONS, validPushEndpoint } from "../_shared/common.ts";

const MAX_PHOTO = 900 * 1024;
const MAX_THUMB = 120 * 1024;
const MAX_POSTS_PER_DAY = 10;
const MAX_PENDING = 300;
const REPORTS_TO_HIDE = 3;

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
      if (len > MAX_PHOTO + MAX_THUMB + 20000) return json(req, { error: "too_large" }, 413);
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

      const { error } = await sb.from("events").insert({
        id, kind, region, lat, lng,
        caption: cleanText(form.get("caption"), 140),
        nickname: cleanText(form.get("nickname"), 24),
        device: cleanText(form.get("device"), 64),
        width: num(form.get("w"), 1, 10000), height: num(form.get("h"), 1, 10000),
        photo_path: photoPath, thumb_path: thumbPath, ip_hash: ip,
      });
      if (error) { await sb.storage.from("pending").remove([photoPath, thumbPath]); throw error; }
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
      const { error } = await sb.from("push_subs").upsert({ endpoint, p256dh, auth, region }, { onConflict: "endpoint" });
      if (error) throw error;
      return json(req, { ok: true });
    }

    if (action === "unsubscribe") {
      const endpoint = String(body.endpoint || "");
      if (endpoint) await sb.from("push_subs").delete().eq("endpoint", endpoint);
      return json(req, { ok: true });
    }

    return json(req, { error: "unknown_action" }, 400);
  } catch (e) {
    console.error("dalil-public", action, e);
    return json(req, { error: "server" }, 500);
  }
});
