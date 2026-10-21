// غرفة الرحلة: إنشاء غرفة برقم سري، الدخول، حالة الغرفة، الرسائل الصوتية، نقطة التجمع، الكتم والطرد الجماعي، البلاغات.
// المواقع لا تمر من هنا ولا تُخزَّن: تنتقل بين الأعضاء مباشرة عبر Realtime Broadcast على قناة سرية (secret).
import { b64uEncode, cleanText, config, cors, db, ipHash, json } from "../_shared/common.ts";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { sendApnsTo } from "../_shared/apns.ts";

const MAX_MEMBERS = 15;
const ROOM_HOURS = 24;
const VOICE_KEEP_MS = 60 * 60e3;          // تُعاد الرسائل الصوتية لآخر ساعة
const MAX_VOICE = 590_000;          // أقل من حد الحاوية (600000)
const VOICE_MIMES = ["audio/mp4", "audio/aac", "audio/webm", "audio/ogg", "audio/mpeg", "audio/x-m4a"];
const COLORS = ["#E0531B", "#1F7AE0", "#2E9E5B", "#B23AB8", "#D4A017", "#0E9AA7", "#C2185B", "#6D4C41", "#5C6BC0", "#7CB342", "#F57C00", "#455A64", "#AD1457", "#00897B", "#8E24AA"];

const rnd = (n: number) => b64uEncode(crypto.getRandomValues(new Uint8Array(n)));
async function sha(s: string) { return b64uEncode(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s))); }
const validPin = (p: string) => /^[0-9]{4,8}$/.test(p);

async function tooMany(sb: SupabaseClient, ip: string, kind: string, max: number, minutes: number) {
  const since = new Date(Date.now() - minutes * 60e3).toISOString();
  const { count } = await sb.from("room_attempts").select("ip_hash", { count: "exact", head: true }).eq("ip_hash", ip).eq("kind", kind).gte("created_at", since);
  if ((count ?? 0) >= max) return true;
  await sb.from("room_attempts").insert({ ip_hash: ip, kind });
  return false;
}

async function activeMembers(sb: SupabaseClient, roomId: string) {
  const { data } = await sb.from("room_members").select("member_id,name,color,joined_at,last_seen").eq("room_id", roomId).eq("kicked", false).eq("left_room", false).order("joined_at");
  return data || [];
}

// تنبيه بقية أعضاء الغرفة (تطبيق الآيفون) — يصل حتى لو كان التطبيق مغلقًا
async function notifyRoom(sb: SupabaseClient, roomId: string, exceptId: string, p: { title: string; body: string; tag: string }) {
  const { data } = await sb.from("room_members").select("push_token").eq("room_id", roomId).eq("kicked", false).eq("left_room", false).neq("member_id", exceptId).not("push_token", "is", null);
  const toks = (data || []).map((r) => r.push_token as string);
  if (!toks.length) return;
  const job = sendApnsTo(sb, toks, { ...p, url: "./?screen=compass" }).catch((e) => console.error("room push", e));
  (globalThis as any).EdgeRuntime?.waitUntil?.(job);
}

async function banned(sb: SupabaseClient, ip: string) {
  const { data } = await sb.from("room_bans").select("until").eq("ip_hash", ip).maybeSingle();
  return !!data && (!data.until || new Date(data.until).getTime() > Date.now());
}

async function newMember(sb: SupabaseClient, roomId: string, name: string, ip: string) {
  const members = await activeMembers(sb, roomId);
  if (members.length >= MAX_MEMBERS) return null;
  const used = new Set(members.map((m) => m.color));
  const color = COLORS.find((c) => !used.has(c)) || COLORS[members.length % COLORS.length];
  const memberId = rnd(9), token = rnd(24);
  const { error } = await sb.from("room_members").insert({ room_id: roomId, member_id: memberId, token_hash: await sha(token), name, color, ip_hash: ip });
  if (error) throw error;
  return { member_id: memberId, token, color };
}

// يتحقق من عضوية الطلب ويعيد الغرفة والعضو، أو null.
async function auth(sb: SupabaseClient, body: Record<string, unknown>) {
  const roomId = String(body.room_id || ""), memberId = String(body.member_id || ""), token = String(body.token || "");
  if (!/^[0-9a-f-]{36}$/.test(roomId) || !memberId || !token) return null;
  const { data: m } = await sb.from("room_members").select("*").eq("room_id", roomId).eq("member_id", memberId).maybeSingle();
  if (!m || m.token_hash !== await sha(token)) return null;
  const { data: room } = await sb.from("rooms").select("*").eq("id", roomId).maybeSingle();
  if (!room) return null;
  return { room, member: m };
}

async function cleanupRooms(sb: SupabaseClient) {
  const oldVoice = new Date(Date.now() - VOICE_KEEP_MS).toISOString();
  const { data: clips } = await sb.from("room_voice").select("id,path").lt("created_at", oldVoice).limit(500);
  if (clips?.length) {
    await sb.storage.from("room-voice").remove(clips.map((c) => c.path));
    await sb.from("room_voice").delete().in("id", clips.map((c) => c.id));
  }
  const { data: expired } = await sb.from("rooms").select("id").lt("expires_at", new Date().toISOString()).limit(200);
  for (const r of expired || []) {
    const { data: rest } = await sb.from("room_voice").select("path").eq("room_id", r.id);
    if (rest?.length) await sb.storage.from("room-voice").remove(rest.map((c) => c.path));
    await sb.from("rooms").delete().eq("id", r.id);
  }
  const { data: oldRep } = await sb.from("room_reports").select("id,voice_path").not("voice_path", "is", null).lt("created_at", new Date(Date.now() - 30 * 86400e3).toISOString()).limit(200);
  if (oldRep?.length) {
    await sb.storage.from("room-voice").remove(oldRep.map((r) => r.voice_path));
    await sb.from("room_reports").update({ voice_path: null }).in("id", oldRep.map((r) => r.id));
  }
  await sb.from("room_attempts").delete().lt("created_at", new Date(Date.now() - 86400e3).toISOString());
}

function roomView(room: Record<string, any>, member: Record<string, any>, members: any[], voice: any[]) {
  return {
    room_id: room.id, code: room.code, name: room.name, secret: room.secret, rally: room.rally,
    expires_at: room.expires_at, me: { member_id: member.member_id, name: member.name, color: member.color },
    members: members.map((m) => ({ member_id: m.member_id, name: m.name, color: m.color })),
    voice, max_members: MAX_MEMBERS,
  };
}

async function recentVoice(sb: SupabaseClient, roomId: string) {
  const since = new Date(Date.now() - VOICE_KEEP_MS).toISOString();
  const { data } = await sb.from("room_voice").select("id,member_id,path,mime,duration,created_at").eq("room_id", roomId).gte("created_at", since).order("created_at", { ascending: false }).limit(40);
  if (!data?.length) return [];
  const { data: signed } = await sb.storage.from("room-voice").createSignedUrls(data.map((v) => v.path), 3600);
  return data.map((v, i) => ({ id: v.id, member_id: v.member_id, mime: v.mime, duration: v.duration, created_at: v.created_at, url: signed?.[i]?.signedUrl || null })).reverse();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(req) });
  if (req.method !== "POST") return json(req, { error: "method" }, 405);
  const action = new URL(req.url).searchParams.get("a") || "";
  const sb = db();
  try {
    const cfg = await config(sb);
    const ip = await ipHash(req, cfg.ip_salt);
    if (Math.random() < 0.15) {
      const job = cleanupRooms(sb).catch((e) => console.error("rooms cleanup", e));
      (globalThis as any).EdgeRuntime?.waitUntil?.(job);
    }

    // رسالة صوتية (multipart): room_id, member_id, token, audio, duration
    if (action === "voice") {
      const len = Number(req.headers.get("content-length") || 0);
      if (len > MAX_VOICE + 4000) return json(req, { error: "too_large" }, 413);
      const form = await req.formData();
      const a = await auth(sb, { room_id: form.get("room_id"), member_id: form.get("member_id"), token: form.get("token") });
      if (!a || a.member.kicked || a.member.left_room) return json(req, { error: "not_member" }, 403);
      if (new Date(a.room.expires_at).getTime() < Date.now()) return json(req, { error: "expired" }, 410);
      const audio = form.get("audio");
      if (!(audio instanceof File) || audio.size < 200 || audio.size > MAX_VOICE) return json(req, { error: "bad_audio" }, 400);
      const mime = (audio.type || "").split(";")[0];
      if (!VOICE_MIMES.includes(mime)) return json(req, { error: "bad_audio" }, 415);
      if (await tooMany(sb, ip, "voice", 120, 10)) return json(req, { error: "rate_limited" }, 429);
      const id = crypto.randomUUID(), ext = mime.includes("webm") ? "webm" : mime.includes("ogg") ? "ogg" : mime.includes("mpeg") ? "mp3" : "m4a";
      const path = `${a.room.id}/${id}.${ext}`;
      const up = await sb.storage.from("room-voice").upload(path, new Uint8Array(await audio.arrayBuffer()), { contentType: mime });
      if (up.error) throw up.error;
      const dur = Number(form.get("duration")); const duration = Number.isFinite(dur) && dur > 0 && dur < 120 ? dur : null;
      const { error } = await sb.from("room_voice").insert({ id, room_id: a.room.id, member_id: a.member.member_id, path, mime, duration });
      if (error) throw error;
      if (!a.member.last_push_at || Date.now() - new Date(a.member.last_push_at).getTime() > 60e3) {
        await sb.from("room_members").update({ last_push_at: new Date().toISOString() }).eq("room_id", a.room.id).eq("member_id", a.member.member_id);
        await notifyRoom(sb, a.room.id, a.member.member_id, { title: "🎙️ " + a.member.name, body: "أرسل رسالة صوتية في " + (a.room.name || "غرفة الرحلة"), tag: "room-voice" });
      }
      const { data: s } = await sb.storage.from("room-voice").createSignedUrl(path, 3600);
      await sb.from("room_members").update({ last_seen: new Date().toISOString() }).eq("room_id", a.room.id).eq("member_id", a.member.member_id);
      return json(req, { ok: true, voice: { id, member_id: a.member.member_id, mime, duration, created_at: new Date().toISOString(), url: s?.signedUrl || null } });
    }

    const body = await req.json().catch(() => ({})) as Record<string, unknown>;

    if (action === "create") {
      const pin = String(body.pin || ""), name = cleanText(body.member_name, 24), roomName = cleanText(body.name, 40);
      if (!validPin(pin)) return json(req, { error: "bad_pin" }, 400);
      if (!name) return json(req, { error: "name_required" }, 400);
      if (await banned(sb, ip)) return json(req, { error: "banned" }, 403);
      if (await tooMany(sb, ip, "create", 10, 60)) return json(req, { error: "rate_limited" }, 429);
      let room = null;
      for (let i = 0; i < 6 && !room; i++) {
        const code = String(100000 + (crypto.getRandomValues(new Uint32Array(1))[0] % 900000));
        const { data, error } = await sb.from("rooms").insert({
          code, pin_hash: await sha(cfg.ip_salt + "|room|" + code + "|" + pin), name: roomName, secret: rnd(18), ip_hash: ip,
          expires_at: new Date(Date.now() + ROOM_HOURS * 3600e3).toISOString(),
        }).select("*").maybeSingle();
        if (!error) room = data; else if (!String(error.message).includes("duplicate")) throw error;
      }
      if (!room) return json(req, { error: "server" }, 500);
      const m = await newMember(sb, room.id, name, ip);
      if (!m) return json(req, { error: "full" }, 409);
      return json(req, { ok: true, token: m.token, ...roomView(room, { ...m, name }, await activeMembers(sb, room.id), []) });
    }

    if (action === "join") {
      const code = String(body.code || "").replace(/\D/g, ""), pin = String(body.pin || ""), name = cleanText(body.member_name, 24);
      if (!/^[0-9]{6}$/.test(code) || !validPin(pin)) return json(req, { error: "bad_code" }, 400);
      if (!name) return json(req, { error: "name_required" }, 400);
      if (await banned(sb, ip)) return json(req, { error: "banned" }, 403);
      if (await tooMany(sb, ip, "join", 20, 15)) return json(req, { error: "rate_limited" }, 429);
      const { data: room } = await sb.from("rooms").select("*").eq("code", code).maybeSingle();
      if (!room || room.pin_hash !== await sha(cfg.ip_salt + "|room|" + code + "|" + pin)) return json(req, { error: "wrong_code" }, 403);
      if (new Date(room.expires_at).getTime() < Date.now()) return json(req, { error: "expired" }, 410);
      const m = await newMember(sb, room.id, name, ip);
      if (!m) return json(req, { error: "full" }, 409);
      return json(req, { ok: true, token: m.token, ...roomView(room, { ...m, name }, await activeMembers(sb, room.id), await recentVoice(sb, room.id)) });
    }

    const a = await auth(sb, body);
    if (!a) return json(req, { error: "not_member" }, 403);
    const { room, member } = a;
    if (member.kicked) return json(req, { error: "kicked" }, 403);
    if (member.left_room) return json(req, { error: "not_member" }, 403);
    if (new Date(room.expires_at).getTime() < Date.now()) return json(req, { error: "expired" }, 410);

    if (action === "state") {
      await sb.from("room_members").update({ last_seen: new Date().toISOString() }).eq("room_id", room.id).eq("member_id", member.member_id);
      return json(req, { ok: true, ...roomView(room, member, await activeMembers(sb, room.id), await recentVoice(sb, room.id)) });
    }

    if (action === "rally") {
      let rally = null;
      if (body.clear !== true) {
        const lat = Number(body.lat), lng = Number(body.lng);
        if (!(Math.abs(lat) <= 90 && Math.abs(lng) <= 180)) return json(req, { error: "bad_point" }, 400);
        rally = { lat: Math.round(lat * 1e5) / 1e5, lng: Math.round(lng * 1e5) / 1e5, label: cleanText(body.label, 40) || "نقطة التجمع", by: member.name, at: new Date().toISOString() };
      }
      await sb.from("rooms").update({ rally }).eq("id", room.id);
      if (rally) await notifyRoom(sb, room.id, member.member_id, { title: "🚩 نقطة التجمع", body: member.name + " حدّد نقطة التجمع: " + rally.label, tag: "room-rally" });
      return json(req, { ok: true, rally });
    }

    // كتم عضو؛ إذا كتمه 3 أعضاء (أو كل الباقين في الغرف الصغيرة) يخرج من الغرفة وتتغير القناة السرية.
    if (action === "mute") {
      const target = String(body.target || "");
      if (!target || target === member.member_id) return json(req, { error: "bad_target" }, 400);
      const { data: t } = await sb.from("room_members").select("member_id,kicked,left_room").eq("room_id", room.id).eq("member_id", target).maybeSingle();
      if (!t || t.kicked || t.left_room) return json(req, { ok: true, kicked: false });
      if (body.unmute === true) {
        await sb.from("room_mutes").delete().eq("room_id", room.id).eq("muter_id", member.member_id).eq("target_id", target);
        return json(req, { ok: true, kicked: false });
      }
      await sb.from("room_mutes").upsert({ room_id: room.id, muter_id: member.member_id, target_id: target }, { onConflict: "room_id,muter_id,target_id", ignoreDuplicates: true });
      const members = await activeMembers(sb, room.id);
      const others = members.filter((m) => m.member_id !== target).map((m) => m.member_id);
      const { data: votes } = await sb.from("room_mutes").select("muter_id").eq("room_id", room.id).eq("target_id", target);
      const n = (votes || []).filter((v) => others.includes(v.muter_id)).length;
      const need = Math.max(1, Math.min(3, others.length));
      if (others.length >= 2 && n >= need) {
        const secret = rnd(18);
        await sb.from("room_members").update({ kicked: true }).eq("room_id", room.id).eq("member_id", target);
        await sb.from("rooms").update({ secret }).eq("id", room.id);
        return json(req, { ok: true, kicked: true, votes: n, need, secret });
      }
      return json(req, { ok: true, kicked: false, votes: n, need });
    }

    if (action === "report") {
      const target = String(body.target || "");
      const { data: t } = await sb.from("room_members").select("member_id,name,ip_hash").eq("room_id", room.id).eq("member_id", target).maybeSingle();
      if (await tooMany(sb, ip, "report", 20, 60)) return json(req, { error: "rate_limited" }, 429);
      const voiceId = /^[0-9a-f-]{36}$/.test(String(body.voice_id || "")) ? String(body.voice_id) : null;
      const id = crypto.randomUUID();
      // نحتفظ بنسخة من آخر تسجيل للمبلَّغ عنه للمراجعة (التسجيلات العادية تُحذف بعد ساعة)
      let voicePath: string | null = null;
      if (voiceId && t) {
        const { data: v } = await sb.from("room_voice").select("path,member_id").eq("id", voiceId).eq("room_id", room.id).maybeSingle();
        if (v && v.member_id === t.member_id) {
          const dest = `reports/${id}.${v.path.split(".").pop()}`;
          const cp = await sb.storage.from("room-voice").copy(v.path, dest);
          if (!cp.error) voicePath = dest; else console.error("report copy", cp.error);
        }
      }
      await sb.from("room_reports").insert({ id, room_id: room.id, room_code: room.code, reporter_id: member.member_id, target_id: t?.member_id || null, target_name: t?.name || null,
        target_ip: t?.ip_hash || null, reason: cleanText(body.reason, 200), voice_id: voiceId, voice_path: voicePath });
      return json(req, { ok: true });
    }

    // حفظ رمز تنبيهات الجهاز لهذا العضو (يُحذف بخروجه أو انتهاء الغرفة)
    if (action === "push") {
      const t = String(body.push_token || "").toLowerCase();
      if (t && !/^[0-9a-f]{64,200}$/.test(t)) return json(req, { error: "bad_token" }, 400);
      await sb.from("room_members").update({ push_token: t || null }).eq("room_id", room.id).eq("member_id", member.member_id);
      return json(req, { ok: true });
    }

    // استغاثة: تنبيه فوري لكل الأعضاء (مرة كل دقيقتين كحد أقصى)
    if (action === "sos") {
      if (body.off === true) return json(req, { ok: true });
      if (member.last_push_at && Date.now() - new Date(member.last_push_at).getTime() < 120e3) return json(req, { ok: true, throttled: true });
      await sb.from("room_members").update({ last_push_at: new Date().toISOString() }).eq("room_id", room.id).eq("member_id", member.member_id);
      await notifyRoom(sb, room.id, member.member_id, { title: "🆘 " + member.name + " يطلب المساعدة", body: "افتح دليل لترى موقعه وتتوجّه له بالبوصلة", tag: "room-sos" });
      return json(req, { ok: true });
    }

    if (action === "leave") {
      await sb.from("room_members").update({ left_room: true, push_token: null }).eq("room_id", room.id).eq("member_id", member.member_id);
      return json(req, { ok: true });
    }

    return json(req, { error: "unknown_action" }, 400);
  } catch (e) {
    console.error("dalil-rooms", action, e);
    return json(req, { error: "server" }, 500);
  }
});
