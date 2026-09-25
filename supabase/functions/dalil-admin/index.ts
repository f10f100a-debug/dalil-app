// Admin endpoint for Dalil: moderate event photos and send push notifications.
// Every call carries the admin password; failed attempts are throttled per IP.
import webpush from "npm:web-push@3.6.7";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { b64uDecode, b64uEncode, cleanText, cleanup, config, cors, db, ipHash, json, KIND_AR, REGIONS } from "../_shared/common.ts";

const MAX_FAILS = 5;
const FAIL_WINDOW_MS = 15 * 60e3;
const LIVE_DAYS = 3;

async function checkPassword(pass: string, cfg: Record<string,string>): Promise<boolean> {
  if (!pass || pass.length > 200) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(pass), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: b64uDecode(cfg.admin_salt), iterations: Number(cfg.admin_iter) },
    key, 256,
  );
  const a = new Uint8Array(bits), b = b64uDecode(cfg.admin_hash);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

type Sub = { endpoint: string; p256dh: string; auth: string };

async function sendPush(sb: SupabaseClient, cfg: Record<string,string>, region: string, payload: Record<string,unknown>) {
  webpush.setVapidDetails(cfg.vapid_subject, cfg.vapid_public, cfg.vapid_private);
  let q = sb.from("push_subs").select("endpoint,p256dh,auth");
  if (region) q = q.filter("region", "in", `("${region}","")`);
  const { data, error } = await q.limit(5000);
  if (error) throw error;
  const subs = (data || []) as Sub[];
  const body = JSON.stringify(payload);
  let sent = 0, failed = 0;
  const gone: string[] = [];
  for (let i = 0; i < subs.length; i += 50) {
    const batch = subs.slice(i, i + 50);
    const res = await Promise.allSettled(batch.map((s) =>
      webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, body, { TTL: 6 * 3600, urgency: "high" })
    ));
    res.forEach((r, j) => {
      if (r.status === "fulfilled") sent++;
      else {
        failed++;
        const code = (r.reason as { statusCode?: number })?.statusCode;
        if (code === 404 || code === 410) gone.push(batch[j].endpoint);
        else console.error("push failed", code, String((r.reason as Error)?.message || r.reason).slice(0, 200));
      }
    });
  }
  if (gone.length) await sb.from("push_subs").delete().in("endpoint", gone);
  return { sent, failed, removed: gone.length, total: subs.length };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(req) });
  if (req.method !== "POST") return json(req, { error: "method" }, 405);
  const sb = db();
  try {
    const cfg = await config(sb);
    const ip = await ipHash(req, cfg.ip_salt);
    const since = new Date(Date.now() - FAIL_WINDOW_MS).toISOString();
    const { count: fails } = await sb.from("admin_attempts").select("ip_hash", { count: "exact", head: true })
      .eq("ip_hash", ip).eq("ok", false).gte("at", since);
    if ((fails ?? 0) >= MAX_FAILS) return json(req, { error: "locked" }, 429);

    const body = await req.json().catch(() => ({}));
    const ok = await checkPassword(String(body.pass || ""), cfg);
    if (!ok) {
      await sb.from("admin_attempts").insert({ ip_hash: ip, ok: false });
      return json(req, { error: "unauthorized" }, 401);
    }
    const action = String(body.action || "");
    const id = String(body.id || "");
    const validId = /^[0-9a-f-]{36}$/.test(id);

    if (action === "list") {
      const job = cleanup(sb).catch((e) => console.error("cleanup", e));
      (globalThis as any).EdgeRuntime?.waitUntil?.(job);
      const cols = "id,created_at,expires_at,status,kind,caption,nickname,region,lat,lng,photo_path,thumb_path,reports";
      const { data: pending } = await sb.from("events").select(cols).eq("status", "pending").order("created_at", { ascending: true }).limit(100);
      const { data: live } = await sb.from("events").select(cols).in("status", ["approved", "hidden"]).gt("expires_at", new Date().toISOString()).order("created_at", { ascending: false }).limit(100);
      const pend = pending || [];
      let signed: Record<string,string> = {};
      if (pend.length) {
        const { data: urls } = await sb.storage.from("pending").createSignedUrls(pend.flatMap((e) => [e.photo_path, e.thumb_path]), 3600);
        signed = Object.fromEntries((urls || []).filter((u) => u.signedUrl).map((u) => [u.path, u.signedUrl]));
      }
      const pub = (p: string) => sb.storage.from("events").getPublicUrl(p).data.publicUrl;
      const { data: subRows } = await sb.from("push_subs").select("region").limit(10000);
      const byRegion: Record<string, number> = {};
      (subRows || []).forEach((r) => { const k = r.region || "الكل"; byRegion[k] = (byRegion[k] || 0) + 1; });
      return json(req, {
        pending: pend.map((e) => ({ ...e, photo_url: signed[e.photo_path], thumb_url: signed[e.thumb_path] })),
        live: (live || []).map((e) => ({ ...e, photo_url: pub(e.photo_path), thumb_url: pub(e.thumb_path) })),
        subscribers: { total: subRows?.length || 0, byRegion },
        regions: REGIONS,
      });
    }

    if (action === "approve" && validId) {
      const { data: ev } = await sb.from("events").select("*").eq("id", id).maybeSingle();
      if (!ev || ev.status !== "pending") return json(req, { error: "not_pending" }, 409);
      for (const p of [ev.photo_path, ev.thumb_path]) {
        const dl = await sb.storage.from("pending").download(p);
        if (dl.error) throw dl.error;
        const up = await sb.storage.from("events").upload(p, dl.data, { contentType: "image/jpeg", cacheControl: "3600", upsert: true });
        if (up.error) throw up.error;
      }
      await sb.storage.from("pending").remove([ev.photo_path, ev.thumb_path]);
      const now = new Date();
      const { error } = await sb.from("events").update({
        status: "approved", approved_at: now.toISOString(),
        expires_at: new Date(now.getTime() + LIVE_DAYS * 86400e3).toISOString(),
      }).eq("id", id);
      if (error) throw error;
      let push = null;
      if (body.notify) {
        const where = ev.region ? " في " + ev.region : "";
        push = await sendPush(sb, cfg, ev.region, {
          title: `${KIND_AR[ev.kind] || "حدث"} الآن${where}`,
          body: ev.caption || "صورة جديدة في «الأحداث» — اضغط للمشاهدة",
          url: `./?screen=weather&tab=events&event=${id}`,
          tag: "event-" + id,
        });
      }
      return json(req, { ok: true, push });
    }

    if (action === "reject" && validId) {
      const { data: ev } = await sb.from("events").select("id,status,photo_path,thumb_path").eq("id", id).maybeSingle();
      if (!ev) return json(req, { ok: true });
      const bucket = ev.status === "pending" || ev.status === "rejected" ? "pending" : "events";
      await sb.storage.from(bucket).remove([ev.photo_path, ev.thumb_path]);
      await sb.from("events").delete().eq("id", id);
      return json(req, { ok: true });
    }

    if (action === "restore" && validId) {
      const { error } = await sb.from("events").update({ status: "approved", reports: 0 }).eq("id", id).eq("status", "hidden");
      if (error) throw error;
      await sb.from("reports").delete().eq("event_id", id);
      return json(req, { ok: true });
    }

    if (action === "push") {
      const title = cleanText(body.title, 60), text = cleanText(body.body, 180);
      const regionIn = cleanText(body.region, 40);
      const region = REGIONS.includes(regionIn) ? regionIn : "";
      if (!title) return json(req, { error: "title_required" }, 400);
      const push = await sendPush(sb, cfg, region, { title, body: text, url: "./", tag: "msg-" + Date.now() });
      return json(req, { ok: true, push });
    }

    if (action === "ping") return json(req, { ok: true });
    return json(req, { error: "unknown_action" }, 400);
  } catch (e) {
    console.error("dalil-admin", e);
    return json(req, { error: "server" }, 500);
  }
});
