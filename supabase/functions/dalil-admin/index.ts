// Admin endpoint for Dalil: moderate event photos and send push notifications.
// Every call carries the admin password; failed attempts are throttled per IP.
import webpush from "npm:web-push@3.6.7";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { b64uDecode, b64uEncode, cleanText, cleanup, config, cors, db, ipHash, json, KIND_AR, KINDS, REGIONS } from "../_shared/common.ts";

const MAX_FAILS = 5;
const FAIL_WINDOW_MS = 15 * 60e3;
const LIVE_DAYS = 3;

const PERMS = ["moderate", "publish", "push", "ads", "usage"];
const PASS_ITER = 210000;
type Admin = { username: string; display_name: string; role: string; perms: string[]; pass_salt: string; pass_hash: string; pass_iter: number; active: boolean };

async function pbkdf2(pass: string, salt: Uint8Array, iter: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(pass), "PBKDF2", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: iter }, key, 256));
}
async function hashPassword(pass: string) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return { pass_salt: b64uEncode(salt), pass_hash: b64uEncode(await pbkdf2(pass, salt, PASS_ITER)), pass_iter: PASS_ITER };
}
const DUMMY_SALT = new Uint8Array(16);
// يتحقق من اسم المستخدم وكلمة السر. عند عدم وجود المستخدم نحسب تجزئة وهمية حتى لا يُعرف الفرق من الزمن.
async function authenticate(sb: SupabaseClient, username: string, pass: string): Promise<Admin | null> {
  if (!pass || pass.length > 200 || !/^[a-z0-9_]{3,24}$/.test(username)) { await pbkdf2("x", DUMMY_SALT, PASS_ITER); return null; }
  const { data } = await sb.from("admins").select("*").eq("username", username).maybeSingle();
  const row = data as Admin | null;
  const a = await pbkdf2(pass, row ? b64uDecode(row.pass_salt) : DUMMY_SALT, row ? row.pass_iter : PASS_ITER);
  if (!row || !row.active) return null;
  const b = b64uDecode(row.pass_hash);
  if (a.length !== b.length) return null;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0 ? row : null;
}
function validNewPassword(p: string, username: string): string | null {
  if (typeof p !== "string" || p.length < 10) return "كلمة السر يجب ألا تقل عن 10 أحرف";
  if (p.length > 200) return "كلمة السر طويلة جدًا";
  if (p.toLowerCase().includes(username)) return "لا تضع اسم المستخدم داخل كلمة السر";
  if (/^(.)\1+$/.test(p) || /^(0123456789|1234567890|password|qwerty)/i.test(p)) return "كلمة السر سهلة التخمين";
  return null;
}

type Sub = { endpoint: string; p256dh: string; auth: string };

function eventPayload(ev: { id: string; kind: string; region: string; caption: string }) {
  const where = ev.region ? " في " + ev.region : "";
  return {
    title: `${KIND_AR[ev.kind] || "حدث"} الآن${where}`,
    body: ev.caption || "صورة جديدة في «الأحداث» — اضغط للمشاهدة",
    url: `./?screen=weather&tab=events&event=${ev.id}`,
    tag: "event-" + ev.id,
  };
}

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
    const username = String(body.user || "admin").trim().toLowerCase();
    const me = await authenticate(sb, username, String(body.pass || ""));
    if (!me) {
      await sb.from("admin_attempts").insert({ ip_hash: ip, ok: false });
      return json(req, { error: "unauthorized" }, 401);
    }
    const action = String(body.action || "");
    const id = String(body.id || "");
    const validId = /^[0-9a-f-]{36}$/.test(id);
    const isOwner = me.role === "owner";
    const can = (p: string) => isOwner || me.perms.includes(p);
    const forbidden = () => json(req, { error: "forbidden" }, 403);
    const log = (act: string, detail = "") => sb.from("admin_log").insert({ username: me.username, action: act, detail: detail.slice(0, 200) }).then(() => {}, () => {});
    const NEED: Record<string, string[]> = {
      list: ["moderate", "publish", "push"], approve: ["moderate"], reject: ["moderate"], restore: ["moderate"],
      publish: ["publish"], push: ["push"], usage: ["usage"], ads_list: ["ads"], ad_save: ["ads"], ad_delete: ["ads"],
    };
    if (NEED[action] && !NEED[action].some(can)) return forbidden();
    if (["admins_list", "admin_save", "admin_delete", "log"].includes(action) && !isOwner) return forbidden();
    if (body.notify && !can("push")) body.notify = false;

    if (action === "me") {
      await sb.from("admins").update({ last_login: new Date().toISOString() }).eq("username", me.username);
      return json(req, { username: me.username, display_name: me.display_name, role: me.role, perms: isOwner ? PERMS : me.perms });
    }

    if (action === "change_password") {
      const np = String(body.new_pass || "");
      const bad = validNewPassword(np, me.username);
      if (bad) return json(req, { error: "weak_password", message: bad }, 400);
      const { error } = await sb.from("admins").update(await hashPassword(np)).eq("username", me.username);
      if (error) throw error;
      await log("change_password");
      return json(req, { ok: true });
    }

    if (action === "admins_list") {
      const { data, error } = await sb.from("admins").select("username,display_name,role,perms,active,created_at,last_login").order("created_at");
      if (error) throw error;
      return json(req, { admins: data || [], perms: PERMS });
    }

    if (action === "admin_save") {
      const a = body.admin || {};
      const uname = String(a.username || "").trim().toLowerCase();
      if (!/^[a-z0-9_]{3,24}$/.test(uname)) return json(req, { error: "bad_username", message: "اسم المستخدم: 3–24 حرفًا إنجليزيًا صغيرًا أو أرقام أو _" }, 400);
      const { data: existing } = await sb.from("admins").select("username,role").eq("username", uname).maybeSingle();
      if (existing?.role === "owner" && uname !== me.username) return forbidden();
      const row: Record<string, unknown> = {
        display_name: cleanText(a.display_name, 40),
        perms: (Array.isArray(a.perms) ? a.perms : []).filter((p: string) => PERMS.includes(p)),
        active: uname === me.username ? true : a.active !== false,
      };
      if (a.password) {
        const bad = validNewPassword(String(a.password), uname);
        if (bad) return json(req, { error: "weak_password", message: bad }, 400);
        Object.assign(row, await hashPassword(String(a.password)));
      } else if (!existing) return json(req, { error: "weak_password", message: "اكتب كلمة سر للمشرف الجديد" }, 400);
      if (existing?.role === "owner") delete row.perms;
      const res = existing
        ? await sb.from("admins").update(row).eq("username", uname)
        : await sb.from("admins").insert({ username: uname, role: "moderator", ...row });
      if (res.error) throw res.error;
      await log(existing ? "admin_update" : "admin_create", uname + (a.password ? " (كلمة سر جديدة)" : ""));
      return json(req, { ok: true });
    }

    if (action === "admin_delete") {
      const uname = String(body.username || "").trim().toLowerCase();
      if (uname === me.username) return json(req, { error: "cannot_delete_self" }, 400);
      const { data: t } = await sb.from("admins").select("role").eq("username", uname).maybeSingle();
      if (!t) return json(req, { ok: true });
      if (t.role === "owner") return forbidden();
      await sb.from("admins").delete().eq("username", uname);
      await log("admin_delete", uname);
      return json(req, { ok: true });
    }

    if (action === "log") {
      const { data } = await sb.from("admin_log").select("at,username,action,detail").order("at", { ascending: false }).limit(100);
      return json(req, { log: data || [] });
    }

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

    // نشر صورة مباشرة من الإدارة (بدون مراجعة) مع تنبيه اختياري.
    if (action === "publish") {
      const kind = String(body.kind || "");
      if (!KINDS.includes(kind)) return json(req, { error: "bad_kind" }, 400);
      const dec = (v: unknown) => typeof v === "string" && v ? b64uDecode(v.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")) : new Uint8Array();
      const photo = dec(body.photo_b64), thumb = dec(body.thumb_b64);
      const isJpeg = (b: Uint8Array) => b.length > 4 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
      if (!isJpeg(photo) || !isJpeg(thumb)) return json(req, { error: "bad_image" }, 415);
      if (photo.length > 900 * 1024 || thumb.length > 120 * 1024) return json(req, { error: "too_large" }, 413);
      const regionIn = cleanText(body.region, 40);
      const region = REGIONS.includes(regionIn) ? regionIn : "";
      let lat = Number(body.lat), lng = Number(body.lng);
      const hasLoc = body.lat !== null && body.lat !== undefined && body.lat !== "" && Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
      if (hasLoc) { lat = Math.round(lat * 1e5) / 1e5; lng = Math.round(lng * 1e5) / 1e5; }
      const days = Math.min(14, Math.max(1, Math.round(Number(body.days) || LIVE_DAYS)));
      const id = crypto.randomUUID(), photoPath = `${id}.jpg`, thumbPath = `${id}_t.jpg`;
      for (const [p, b] of [[photoPath, photo], [thumbPath, thumb]] as const) {
        const up = await sb.storage.from("events").upload(p, b, { contentType: "image/jpeg", cacheControl: "3600" });
        if (up.error) throw up.error;
      }
      const now = new Date();
      const ev = {
        id, kind, region, lat: hasLoc ? lat : null, lng: hasLoc ? lng : null,
        caption: cleanText(body.caption, 140), nickname: cleanText(body.nickname, 24), device: "admin",
        width: Math.round(Number(body.w)) || null, height: Math.round(Number(body.h)) || null,
        photo_path: photoPath, thumb_path: thumbPath, status: "approved",
        approved_at: now.toISOString(), expires_at: new Date(now.getTime() + days * 86400e3).toISOString(),
      };
      const { error } = await sb.from("events").insert(ev);
      if (error) { await sb.storage.from("events").remove([photoPath, thumbPath]); throw error; }
      const push = body.notify ? await sendPush(sb, cfg, region, eventPayload(ev)) : null;
      await log("publish", `${KIND_AR[kind]} ${region} ${ev.caption}`.trim());
      return json(req, { ok: true, id, push });
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
        push = await sendPush(sb, cfg, ev.region, eventPayload(ev));
      }
      await log("approve", `${KIND_AR[ev.kind]} ${ev.region} ${ev.caption}`.trim());
      return json(req, { ok: true, push });
    }

    if (action === "reject" && validId) {
      const { data: ev } = await sb.from("events").select("id,status,photo_path,thumb_path").eq("id", id).maybeSingle();
      if (!ev) return json(req, { ok: true });
      const bucket = ev.status === "pending" || ev.status === "rejected" ? "pending" : "events";
      await sb.storage.from(bucket).remove([ev.photo_path, ev.thumb_path]);
      await sb.from("events").delete().eq("id", id);
      await log(ev.status === "pending" ? "reject" : "delete_event", id.slice(0, 8));
      return json(req, { ok: true });
    }

    if (action === "restore" && validId) {
      const { error } = await sb.from("events").update({ status: "approved", reports: 0 }).eq("id", id).eq("status", "hidden");
      if (error) throw error;
      await sb.from("reports").delete().eq("event_id", id);
      await log("restore", id.slice(0, 8));
      return json(req, { ok: true });
    }

    if (action === "push") {
      const title = cleanText(body.title, 60), text = cleanText(body.body, 180);
      const regionIn = cleanText(body.region, 40);
      const region = REGIONS.includes(regionIn) ? regionIn : "";
      if (!title) return json(req, { error: "title_required" }, 400);
      const push = await sendPush(sb, cfg, region, { title, body: text, url: "./", tag: "msg-" + Date.now() });
      await log("push", `${region || "الكل"}: ${title}`);
      return json(req, { ok: true, push });
    }

    if (action === "usage") {
      const since = new Date(Date.now() - 30 * 86400e3).toISOString().slice(0, 10);
      const { data, error } = await sb.from("usage_daily").select("day,region,opens").gte("day", since).order("day");
      if (error) throw error;
      const today = new Date(Date.now() + 3 * 3600e3).toISOString().slice(0, 10); // توقيت الرياض
      const d7 = new Date(Date.now() + 3 * 3600e3 - 6 * 86400e3).toISOString().slice(0, 10);
      const byDay: Record<string, number> = {}, byRegion: Record<string, number> = {};
      let t = 0, w = 0, m = 0;
      for (const r of data || []) {
        byDay[r.day] = (byDay[r.day] || 0) + r.opens;
        const k = r.region || "غير محدد";
        byRegion[k] = (byRegion[k] || 0) + r.opens;
        m += r.opens; if (r.day >= d7) w += r.opens; if (r.day === today) t += r.opens;
      }
      return json(req, { today: t, week: w, month: m, byDay, byRegion });
    }

    if (action === "ads_list") {
      const { data: ads, error } = await sb.from("ads").select("*").order("created_at", { ascending: false }).limit(100);
      if (error) throw error;
      const { data: st } = await sb.from("ad_stats").select("ad_id,impressions,clicks").limit(20000);
      const agg: Record<string, { imp: number; clk: number }> = {};
      (st || []).forEach((r) => { const a = agg[r.ad_id] ||= { imp: 0, clk: 0 }; a.imp += r.impressions; a.clk += r.clicks; });
      const pub = (p: string | null) => p ? sb.storage.from("ads").getPublicUrl(p).data.publicUrl : null;
      return json(req, { ads: (ads || []).map((a) => ({ ...a, image_url: pub(a.image_path), stats: agg[a.id] || { imp: 0, clk: 0 } })), regions: REGIONS });
    }

    if (action === "ad_save") {
      const a = body.ad || {};
      const title = cleanText(a.title, 60), text = cleanText(a.body, 140), label = cleanText(a.cta_label, 24) || "زيارة";
      const url = String(a.cta_url || "").trim();
      if (!title) return json(req, { error: "title_required" }, 400);
      if (!/^(https:\/\/[^\s<>"]{3,490}|tel:\+?[0-9]{6,15})$/.test(url)) return json(req, { error: "bad_url" }, 400);
      const regionIn = cleanText(a.region, 40);
      const row: Record<string, unknown> = {
        title, body: text, cta_label: label, cta_url: url,
        region: REGIONS.includes(regionIn) ? regionIn : "",
        placement: ["events", "places", "both"].includes(a.placement) ? a.placement : "both",
        active: !!a.active, advertiser: cleanText(a.advertiser, 60),
        starts_at: new Date(a.starts_at || Date.now()).toISOString(),
        ends_at: new Date(a.ends_at || Date.now() + 30 * 86400e3).toISOString(),
      };
      const editId = /^[0-9a-f-]{36}$/.test(String(a.id || "")) ? String(a.id) : null;
      let old: { image_path: string | null } | null = null;
      if (editId) { const r = await sb.from("ads").select("image_path").eq("id", editId).maybeSingle(); old = r.data; if (!old) return json(req, { error: "not_found" }, 404); }
      const id = editId || crypto.randomUUID();
      if (typeof body.image_b64 === "string" && body.image_b64) {
        const bytes = b64uDecode(body.image_b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""));
        if (bytes.length > 500 * 1024 || !(bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)) return json(req, { error: "bad_image" }, 415);
        const path = `${id}-${Date.now()}.jpg`;
        const up = await sb.storage.from("ads").upload(path, bytes, { contentType: "image/jpeg", cacheControl: "86400" });
        if (up.error) throw up.error;
        row.image_path = path;
        if (old?.image_path) await sb.storage.from("ads").remove([old.image_path]);
      } else if (body.remove_image) {
        row.image_path = null;
        if (old?.image_path) await sb.storage.from("ads").remove([old.image_path]);
      }
      const res = editId ? await sb.from("ads").update(row).eq("id", id) : await sb.from("ads").insert({ id, ...row });
      if (res.error) throw res.error;
      await log(editId ? "ad_update" : "ad_create", title + (row.active ? " (مفعّل)" : ""));
      return json(req, { ok: true, id });
    }

    if (action === "ad_delete" && validId) {
      const { data: ad } = await sb.from("ads").select("image_path").eq("id", id).maybeSingle();
      if (ad?.image_path) await sb.storage.from("ads").remove([ad.image_path]);
      await sb.from("ads").delete().eq("id", id);
      await log("ad_delete", id.slice(0, 8));
      return json(req, { ok: true });
    }

    if (action === "ping") return json(req, { ok: true });
    return json(req, { error: "unknown_action" }, 400);
  } catch (e) {
    console.error("dalil-admin", e);
    return json(req, { error: "server" }, 500);
  }
});
