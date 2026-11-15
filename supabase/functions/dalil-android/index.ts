// تنبيهات تطبيق الأندرويد (فايربيس) — منفصلة تمامًا عن الآيفون.
// - رموز الأندرويد في جدول push_android لحالها (دوال الآيفون ما تشوفها).
// - a=rain (pg_cron كل 10 دقايق بعد دالة المطر بدقيقتين): يقرأ سجل auto_alerts (قراءة فقط) من آخر رقم أرسله،
//   ويرسل نفس تنبيه المطر لأجهزة الأندرويد في نفس المنطقة. أي خلل هنا ما يمس إرسال الآيفون.
// - a=room (pg_cron كل 20 ثانية): رسالة صوتية جديدة بغرفة الرحلة وعضو أندرويد تطبيقه مسكّر (ما شافه السيرفر من 100 ثانية)
//   → تنبيه «🎙️ فلان أرسل رسالة صوتية». يقرأ جداول الغرف فقط (room_voice/room_members/room_mutes) وما يكتب فيها.
// - a=test: تنبيه تجريبي لآخر جهاز أندرويد مسجّل (أو token محدد).
import { createClient } from "npm:@supabase/supabase-js@2";
import { fcmReady, sendFcm, sendFcmMany } from "../_shared/fcm.ts";

const db = () => createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false, autoRefreshToken: false } });
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json; charset=utf-8" } });
// ساعات الهدوء مثل دالة المطر: 12 الليل–6 الصبح بالرياض بدون صوت، إلا العواصف القوية (≥55)
const quiet = (at: string) => { const h = (new Date(at).getUTCHours() + 3) % 24; return h < 6; };

Deno.serve(async (req) => {
  const sb = db(), a = new URL(req.url).searchParams.get("a") || "";
  const { data: k } = await sb.from("private_config").select("value").eq("key", "cron_key").maybeSingle();
  if (!k?.value || req.headers.get("x-cron-key") !== k.value) return json({ error: "forbidden" }, 403);
  try {
    if (a === "test") {
      const b = await req.json().catch(() => ({}));
      const t = b.token || (await sb.from("push_android").select("token").order("updated_at", { ascending: false }).limit(1).maybeSingle()).data?.token;
      if (!t) return json({ error: "no_android" });
      return json({ ready: fcmReady(), result: await sendFcm(t, { title: "🔔 تجربة: تنبيه دليل", body: "هذا إشعار تجريبي لتطبيق الأندرويد — وصلك أنت بس.", url: "./?screen=weather", tag: "test" }) });
    }
    if (a === "rain") {
      const { data: lastRow } = await sb.from("private_config").select("value").eq("key", "android_alert_last_id").maybeSingle();
      const last = Number(lastRow?.value || 0);
      const { data: rows } = await sb.from("auto_alerts").select("id,at,region,title,body,max_dbz,kind").gt("id", last).order("id").limit(50);
      const out: unknown[] = []; let maxId = last;
      for (const r of rows || []) {
        maxId = Math.max(maxId, r.id);
        if (Date.now() - new Date(r.at).getTime() > 2 * 3600e3) { out.push({ id: r.id, skipped: "old" }); continue; }   // ما نرسل تنبيه قديم
        const { data: toks } = await sb.from("push_android").select("token").eq("region", r.region).limit(20000);
        const tl = (toks || []).map((x) => x.token as string);
        if (!tl.length) { out.push({ id: r.id, region: r.region, android: 0 }); continue; }
        const res = await sendFcmMany(tl, { title: r.title, body: r.body, url: "./?screen=track", tag: (r.kind === "city" ? "auto-city-" : "auto-rain-") + r.region, ttl: 2 * 3600, silent: quiet(r.at) && (r.max_dbz || 0) < 55 });
        if (res.gone.length) await sb.from("push_android").delete().in("token", res.gone);
        out.push({ id: r.id, region: r.region, android: res.total, sent: res.sent, gone: res.gone.length });
      }
      if (maxId > last) await sb.from("private_config").upsert({ key: "android_alert_last_id", value: String(maxId) });
      await sb.from("private_config").upsert({ key: "android_alert_last", value: JSON.stringify({ at: new Date().toISOString(), rows: out }) });
      return json({ ok: true, rows: out });
    }
    if (a === "room") {
      const { data: lastRow } = await sb.from("private_config").select("value").eq("key", "android_room_last").maybeSingle();
      const since = new Date(Math.max(Date.parse(lastRow?.value || "") || 0, Date.now() - 5 * 60e3)).toISOString();
      const { data: voices } = await sb.from("room_voice").select("room_id,member_id,created_at").gt("created_at", since).order("created_at").limit(500);
      const out: unknown[] = []; let newest = since;
      const byRoom = new Map<string, { member_id: string; created_at: string }[]>();
      for (const v of voices || []) { newest = v.created_at > newest ? v.created_at : newest; byRoom.set(v.room_id, [...(byRoom.get(v.room_id) || []), v]); }
      for (const [room, vs] of byRoom) {
        const { data: andr } = await sb.from("room_android").select("member_id,token,last_push_at,closed_at").eq("room_id", room);
        if (!andr?.length) continue;
        const { data: mem } = await sb.from("room_members").select("member_id,name,last_seen,kicked,left_room,paused_until").eq("room_id", room);
        const { data: mutes } = await sb.from("room_mutes").select("muter_id,target_id").eq("room_id", room);
        const { data: rm } = await sb.from("rooms").select("name").eq("id", room).maybeSingle();
        const M = new Map((mem || []).map((m) => [m.member_id, m]));
        for (const d of andr) {
          const me = M.get(d.member_id);
          if (!me || me.kicked || me.left_room) { await sb.from("room_android").delete().match({ room_id: room, member_id: d.member_id }); continue; }   // طلع من الغرفة
          if (me.paused_until && Date.parse(me.paused_until) > Date.now()) continue;                       // موقّف الغرفة مؤقتًا
          if (!d.closed_at && me.last_seen && Date.now() - Date.parse(me.last_seen) < 100e3) continue;   // تطبيقه شغال — يسمعها مباشرة (إلا إذا بلّغ إنه انسكّر)
          if (d.last_push_at && Date.now() - Date.parse(d.last_push_at) < 120e3) continue;                 // تنبيه وحد كل دقيقتين بالكثير
          const from = vs.filter((v) => v.member_id !== d.member_id && !(mutes || []).some((x) => x.muter_id === d.member_id && x.target_id === v.member_id));
          if (!from.length) continue;
          const names = [...new Set(from.map((v) => M.get(v.member_id)?.name || "عضو"))];
          const r = await sendFcm(d.token, { title: "🎙️ " + names.slice(0, 2).join(" و") + (names.length > 2 ? " وغيرهم" : ""),
            body: (from.length > 1 ? from.length + " رسائل صوتية في " : "أرسل رسالة صوتية في ") + (rm?.name || "غرفة الرحلة") + " — افتح دليل وتسمعها", url: "./", tag: "room-" + room, ttl: 1800 });
          if (r === "gone") await sb.from("room_android").delete().match({ room_id: room, member_id: d.member_id });
          else if (r === "ok") await sb.from("room_android").update({ last_push_at: new Date().toISOString() }).match({ room_id: room, member_id: d.member_id });
          out.push({ room: room.slice(0, 8), r });
        }
      }
      if (newest > since) await sb.from("private_config").upsert({ key: "android_room_last", value: newest });
      return json({ ok: true, voices: (voices || []).length, sent: out });
    }
    // فحص صيغة ملفات الصوت (قراءة فقط): أنواع الصناديق والترميز — نفرق تسجيل الأندرويد عن الآيفون
    if (a === "probe") {
      const b = await req.json().catch(() => ({}));
      const out: unknown[] = [];
      for (const path of (Array.isArray(b.paths) ? b.paths : []).slice(0, 6)) {
        const { data } = await sb.storage.from("room-voice").download(String(path));
        if (!data) { out.push({ path, err: "missing" }); continue; }
        const u = new Uint8Array(await data.arrayBuffer());
        const txt = Array.from(u).map((c) => c >= 32 && c < 127 ? String.fromCharCode(c) : ".").join("");
        const tags = ["ftyp", "moov", "moof", "mdat", "mp4a", "Opus", "dOps", "esds", "mvex", "trak"].filter((t) => txt.includes(t));
        out.push({ path: String(path).slice(-12), size: u.length, brand: txt.slice(8, 12), tags, moovFirst: txt.indexOf("moov") >= 0 && (txt.indexOf("mdat") < 0 || txt.indexOf("moov") < txt.indexOf("mdat")) });
      }
      return json({ ok: true, out });
    }
    return json({ error: "unknown_action" }, 400);
  } catch (e) {
    console.error("dalil-android", a, e);
    return json({ error: String((e as Error)?.message || e).slice(0, 200) }, 500);
  }
});
