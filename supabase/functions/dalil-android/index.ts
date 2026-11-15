// تنبيهات تطبيق الأندرويد (فايربيس) — منفصلة تمامًا عن الآيفون.
// - رموز الأندرويد في جدول push_android لحالها (دوال الآيفون ما تشوفها).
// - a=rain (pg_cron كل 10 دقايق بعد دالة المطر بدقيقتين): يقرأ سجل auto_alerts (قراءة فقط) من آخر رقم أرسله،
//   ويرسل نفس تنبيه المطر لأجهزة الأندرويد في نفس المنطقة. أي خلل هنا ما يمس إرسال الآيفون.
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
    return json({ error: "unknown_action" }, 400);
  } catch (e) {
    console.error("dalil-android", a, e);
    return json({ error: String((e as Error)?.message || e).slice(0, 200) }, 500);
  }
});
