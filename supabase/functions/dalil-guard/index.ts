// «حارس دليل»: فحص صحة خدمات دليل كل ساعة (pg_cron) — ينبّه جوال المالك فقط إذا تعطّل شي، و«رجعت تشتغل» إذا انحلّت.
// a=run (cron)        : يفحص ويحفظ في guard_log (7 أيام) ويرسل عند تغيّر الحالة
// a=status (مشرف)     : آخر فحص + سجل 7 أيام (لبطاقة «حالة دليل» في لوحة الإدارة)
// a=pair_code (المالك): رمز ربط صالح 10 دقائق → رابط dalil://guard?code=… يفتح التطبيق في جوال المالك
// a=pair (التطبيق)    : يربط اشتراك تنبيهات هذا الجوال بالحارس (بالرمز) ويرسل إشعار تجربة
// a=unpair (المالك)   : يلغي ربط كل الأجهزة
import webpush from "npm:web-push@3.6.7";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { b64uDecode, config, cors, db, ipHash, json } from "../_shared/common.ts";
import { apnsToken } from "../_shared/apns.ts";

const PAGES = "https://f10f100a-debug.github.io/dalil-app/";
const GH = "https://api.github.com/repos/f10f100a-debug/dalil-app/actions/workflows/";
type Level = "ok" | "warn" | "fail";
type Check = { id: string; name: string; level: Level; detail: string };
const H = 3600e3;
const ago = (t: string | number | null | undefined) => t ? (Date.now() - new Date(t).getTime()) / H : Infinity;
const hrs = (h: number) => h < 1 ? Math.round(h * 60) + " د" : h < 48 ? Math.round(h) + " س" : Math.round(h / 24) + " يوم";
const riyadhDay = (d = new Date()) => new Date(d.getTime() + 3 * H).toISOString().slice(0, 10);

// ---------- تحقق المشرف (نفس طريقة لوحة الإدارة) ----------
const DUMMY_SALT = new Uint8Array(16), PASS_ITER = 210000;
async function pbkdf2(pass: string, salt: Uint8Array, iter: number) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(pass), "PBKDF2", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: iter }, key, 256));
}
async function admin(sb: SupabaseClient, req: Request, body: Record<string, unknown>) {
  const cfg = await config(sb), ip = await ipHash(req, cfg.ip_salt);
  const { count } = await sb.from("admin_attempts").select("ip_hash", { count: "exact", head: true }).eq("ip_hash", ip).eq("ok", false).gte("at", new Date(Date.now() - 15 * 60e3).toISOString());
  if ((count ?? 0) >= 5) return null;
  const username = String(body.user || "").trim().toLowerCase(), pass = String(body.pass || "");
  if (!pass || pass.length > 200 || !/^[a-z0-9_]{3,24}$/.test(username)) { await pbkdf2("x", DUMMY_SALT, PASS_ITER); return null; }
  const { data: row } = await sb.from("admins").select("*").eq("username", username).maybeSingle();
  const a = await pbkdf2(pass, row ? b64uDecode(row.pass_salt) : DUMMY_SALT, row ? row.pass_iter : PASS_ITER);
  let ok = !!row && row.active;
  if (ok) { const b = b64uDecode(row.pass_hash); let d = a.length ^ b.length; for (let i = 0; i < a.length && i < b.length; i++) d |= a[i] ^ b[i]; ok = d === 0; }
  if (!ok) { await sb.from("admin_attempts").insert({ ip_hash: ip, ok: false }); return null; }
  return row as { username: string; role: string };
}

// ---------- الفحوص ----------
async function gh(file: string) {
  try {
    const r = await fetch(GH + file + "/runs?per_page=3&status=completed", { headers: { "user-agent": "dalil-guard", accept: "application/vnd.github+json" } });
    if (!r.ok) return null;
    const j = await r.json(); return (j.workflow_runs || [])[0] || null;
  } catch { return null; }
}
async function runChecks(sb: SupabaseClient): Promise<Check[]> {
  const out: Check[] = [];
  const cfgRow = async (k: string) => (await sb.from("private_config").select("value").eq("key", k).maybeSingle()).data?.value;
  const appCfg = async (k: string) => (await sb.from("app_config").select("value").eq("key", k).maybeSingle()).data?.value;

  // ١) الرادار وتنبيهات المطر (pg_cron كل 10 دقائق)
  try {
    const L = JSON.parse(await cfgRow("auto_alerts_last") || "null");
    const off = (await appCfg("auto_alerts")) === "off";
    const h = ago(L?.at);
    const level: Level = h > 2 ? "fail" : h > 0.6 || (L && L.ok === false) ? "warn" : "ok";
    out.push({ id: "rain", name: "الرادار وتنبيهات المطر", level, detail:
      h === Infinity ? "ما فيه أي فحص مسجّل" : h > 0.6 ? "آخر فحص قبل " + hrs(h) + " (المفروض كل 10 د)"
      : L.ok === false ? (L.error === "stale" ? "صور الرادار متأخرة " + (L.ageMin || "") + " د" : "تعذّر الفحص: " + (L.error || "خطأ")) : "يفحص كل 10 د" + (off ? " · التنبيهات موقوفة من اللوحة" : "") });
  } catch (e) { out.push({ id: "rain", name: "الرادار وتنبيهات المطر", level: "warn", detail: "تعذّر القراءة: " + String(e).slice(0, 60) }); }

  // ٢) التنبيهات توصل فعلًا: تنبيه آخر 24 ساعة لمنطقة فيها مشتركين ووصل لصفر أجهزة
  try {
    const { data: aa } = await sb.from("auto_alerts").select("region,sent_web,sent_ios,at").gte("at", new Date(Date.now() - 24 * H).toISOString());
    // نحكم على آخر تنبيه لكل منطقة بس: تعثّر عابر من أبل (تنبيه ما وصل وبعده وصلت عادي) ما يعتبر عطل — كان يعطي إنذار كاذب 30 ساعة
    const latest = new Map<string, { region: string; sent_web: number; sent_ios: number; at: string }>();
    for (const a of aa || []) { const p = latest.get(a.region); if (!p || a.at > p.at) latest.set(a.region, a); }
    const zero = [...latest.values()].filter((a) => (a.sent_web || 0) + (a.sent_ios || 0) === 0);
    let bad = 0;
    for (const z of zero) {
      const { count: n1 } = await sb.from("push_native").select("token", { count: "exact", head: true }).eq("region", z.region);
      const { count: n2 } = await sb.from("push_subs").select("endpoint", { count: "exact", head: true }).eq("region", z.region);
      if ((n1 ?? 0) + (n2 ?? 0) > 0) bad++;
    }
    const { count: ios } = await sb.from("push_native").select("token", { count: "exact", head: true });
    const jwt = await apnsToken(sb).catch(() => null);
    out.push({ id: "push", name: "وصول الإشعارات", level: !jwt ? "fail" : bad >= 2 ? "fail" : bad ? "warn" : "ok",   // منطقة وحدة = تحذير (يحتاج فحصين ورا بعض)، منطقتين فأكثر = عطل
      detail: !jwt ? "مفتاح تنبيهات أبل مفقود" : bad ? "آخر تنبيه لـ" + bad + " منطقة ما وصل لأي جهاز رغم وجود مشتركين" : (aa || []).length + " تنبيه آخر 24 س · " + (ios ?? 0) + " آيفون مشترك" });
  } catch (e) { out.push({ id: "push", name: "وصول الإشعارات", level: "warn", detail: "تعذّر القراءة" }); }

  // ٣) الفياض (الثلاثاء والجمعة)
  try {
    const fy = await fetch(PAGES + "data/fayd.json?t=" + Date.now()).then((r) => r.json());
    const run = await gh("fayd.yml");
    const days = ago(fy.asof + "T12:00:00Z") / 24;
    const failed = run && run.conclusion !== "success" && ago(run.updated_at) < 48;
    out.push({ id: "fayd", name: "الفياض", level: days > 10 ? "fail" : days > 6.5 || failed ? "warn" : "ok",
      detail: "آخر صورة قمر " + fy.asof + " (قبل " + Math.round(days) + " يوم)" + (failed ? " · آخر تحديث فشل في GitHub" : "") });
  } catch { out.push({ id: "fayd", name: "الفياض", level: "fail", detail: "تعذّر قراءة بيانات الفياض المنشورة" }); }

  // ٤) مؤشر الفقع (يومي)
  try {
    const fq = await fetch(PAGES + "data/fq.json?t=" + Date.now()).then((r) => r.json());
    const run = await gh("fq.yml");
    const late = (new Date(riyadhDay()).getTime() - new Date(fq.asof).getTime()) / 864e5;
    const failed = run && run.conclusion !== "success" && ago(run.updated_at) < 30;
    out.push({ id: "fq", name: "مؤشر الفقع", level: late >= 3 ? "fail" : late >= 2 || failed ? "warn" : "ok",
      detail: "آخر تحديث " + fq.asof + (late >= 1 ? " (متأخر " + Math.round(late) + " يوم)" : "") + (failed ? " · آخر تشغيل فشل" : "") });
  } catch { out.push({ id: "fq", name: "مؤشر الفقع", level: "fail", detail: "تعذّر قراءة بيانات الفقع المنشورة" }); }

  // ٥) فلترة الصور بالذكاء الاصطناعي
  try {
    const on = (await appCfg("ai_mod")) !== "off";
    const { count: stuck } = await sb.from("events").select("id", { count: "exact", head: true }).eq("status", "pending").is("ai_at", null).lt("created_at", new Date(Date.now() - 20 * 60e3).toISOString());
    const { count: pending } = await sb.from("events").select("id", { count: "exact", head: true }).eq("status", "pending");
    out.push({ id: "ai", name: "فلترة الصور", level: on && (stuck ?? 0) > 0 ? "fail" : "ok",
      detail: !on ? "موقوفة من اللوحة · " + (pending ?? 0) + " صورة تنتظرك" : (stuck ?? 0) > 0 ? (stuck) + " صورة ما فحصها الذكاء الاصطناعي من أكثر من 20 د" : (pending ?? 0) + " صورة تنتظر مراجعتك" });
  } catch { out.push({ id: "ai", name: "فلترة الصور", level: "warn", detail: "تعذّر القراءة" }); }

  // ٦) غرفة الرحلة: تنظيف الغرف المنتهية + نجاح تشغيل الرسائل الصوتية
  try {
    const { count: stale } = await sb.from("rooms").select("id", { count: "exact", head: true }).lt("expires_at", new Date(Date.now() - 30 * 60e3).toISOString());
    const since = new Date(Date.now() - 24 * H).toISOString();
    const { data: dg } = await sb.from("client_errors").select("msg").eq("ver", "voice-diag").gte("at", since).limit(5000);
    let okN = 0, failN = 0;
    for (const r of dg || []) { const s = String(r.msg); if (s.includes('"s":"play_ok"')) okN++; else if (s.includes('"s":"play_fail"')) failN++; }
    const rate = okN + failN >= 10 ? failN / (okN + failN) : 0;
    out.push({ id: "rooms", name: "غرفة الرحلة", level: (stale ?? 0) > 0 ? "warn" : rate > 0.3 ? "warn" : "ok",
      detail: ((stale ?? 0) > 0 ? stale + " غرفة منتهية ما انحذفت" : "التنظيف شغّال") + (okN + failN ? " · تشغيل الرسائل " + Math.round((1 - rate) * 100) + "٪ ناجح (" + (okN + failN) + ")" : "") });
  } catch { out.push({ id: "rooms", name: "غرفة الرحلة", level: "warn", detail: "تعذّر القراءة" }); }

  // ٧) تنبيه اخضرار الفياض
  try {
    const { count: w } = await sb.from("fayd_watch").select("sub", { count: "exact", head: true });
    const last = JSON.parse(await cfgRow("fayd_alert_last") || "null");
    const fail = last && last.fail > 0 && last.fail >= Math.max(1, last.sent);
    out.push({ id: "faydalert", name: "تنبيه الفياض", level: fail ? "warn" : "ok",
      detail: (w ?? 0) + " مشترك" + (last ? " · آخر إرسال " + String(last.at).slice(0, 10) + ": " + last.sent + " وصل" + (last.fail ? "، " + last.fail + " فشل" : "") : "") });
  } catch { out.push({ id: "faydalert", name: "تنبيه الفياض", level: "ok", detail: "—" }); }

  // ٨) الإيقاف المؤقت في غرفة الرحلة: عضو انتهى إيقافه من أكثر من 5 د وما رجع = جدول الغرف (كل دقيقة) واقف
  try {
    const { count: due } = await sb.from("room_members").select("member_id", { count: "exact", head: true }).lt("paused_until", new Date(Date.now() - 5 * 60e3).toISOString());
    const { count: now } = await sb.from("room_members").select("member_id", { count: "exact", head: true }).gt("paused_until", new Date().toISOString());
    out.push({ id: "pause", name: "الإيقاف المؤقت بالغرف", level: (due ?? 0) > 0 ? "fail" : "ok",
      detail: (due ?? 0) > 0 ? due + " عضو انتهى إيقافه وما رجع للغرفة (جدول الغرف واقف؟)" : "يرجّع الأعضاء في وقتهم" + ((now ?? 0) > 0 ? " · " + now + " موقوف الحين" : "") });
  } catch { out.push({ id: "pause", name: "الإيقاف المؤقت بالغرف", level: "warn", detail: "تعذّر القراءة" }); }

  // ٩) هجرة الطيور: الملف المنشور سليم وفيه البطاقات الثمان
  try {
    const br = await fetch(PAGES + "data/birds.json?t=" + Date.now()).then((r) => r.json());
    const n = Array.isArray(br.birds) ? br.birds.filter((b: { id?: string; all?: { n?: number } }) => b.id && b.all && (b.all.n ?? 0) > 0).length : 0;
    out.push({ id: "birds", name: "هجرة الطيور", level: n >= 8 ? "ok" : "fail", detail: n >= 8 ? n + " بطاقات سليمة" : "ملف الطيور ناقص (" + n + " من 8)" });
  } catch { out.push({ id: "birds", name: "هجرة الطيور", level: "fail", detail: "تعذّر قراءة ملف الطيور المنشور" }); }

  // ١٠) كل الجداول التلقائية (pg_cron): واقفة، أو فشلت مرتين بآخر 24 س — يشمل أي جدول نضيفه مستقبلًا
  try {
    const { data: jobs, error } = await sb.rpc("guard_cron_status");
    if (error) throw error;
    const AR: Record<string, string> = { "dalil-auto-alerts": "تنبيهات المطر", "dalil-room-tick": "الغرف", "dalil-fayd-alerts": "تنبيه الفياض", "dalil-guard": "الحارس", "dalil-wx-trial-fc": "تجربة التوقعات" };
    const every = (s: string) => {   // المدة المتوقعة بين تشغيلين (دقائق) من صيغة cron
      const [m, h] = s.trim().split(/\s+/);
      if (/^\*\/\d+$/.test(m)) return +m.slice(2);
      if (m === "*") return 1;
      if (h === "*") return 60;
      if (/^\*\/\d+$/.test(h)) return +h.slice(2) * 60;
      return 24 * 60 / Math.max(1, h.split(",").length);
    };
    const bad: string[] = []; let warn = false;
    for (const j of (jobs || []) as { jobname: string; schedule: string; active: boolean; runs24: number; fails24: number; last_run: string | null; last_err: string | null }[]) {
      const nm = AR[j.jobname] || j.jobname.replace(/^dalil-/, "");
      const gapMin = ago(j.last_run) * 60, exp = every(j.schedule);
      if (!j.active) { bad.push(nm + " موقوف"); warn = true; continue; }
      if (j.last_run && gapMin > Math.max(15, exp * 3)) { bad.push(nm + " ما اشتغل من " + hrs(gapMin / 60)); continue; }
      if (j.fails24 >= 2) bad.push(nm + " فشل " + j.fails24 + " مرات" + (j.last_err ? " (" + j.last_err.slice(0, 50) + ")" : ""));
    }
    const n = (jobs || []).length;
    out.push({ id: "cron", name: "الجداول التلقائية", level: !n ? "fail" : bad.length && !(warn && bad.length === 1) ? "fail" : bad.length ? "warn" : "ok",
      detail: !n ? "ما فيه أي جدول تلقائي!" : bad.length ? bad.join(" · ") : n + " جداول شغّالة بدون أخطاء" });
  } catch (e) { out.push({ id: "cron", name: "الجداول التلقائية", level: "warn", detail: "تعذّر القراءة: " + String((e as Error)?.message || e).slice(0, 60) }); }

  // ١١) النسخة الاحتياطية اليومية (GitHub، 3:07 الفجر): فشل مرة = نعيد بكرة بدون إزعاج، مرتين ورا بعض أو ما فيه نسخة ناجحة من يومين = عطل
  try {
    const r = await fetch(GH + "db-backup.yml/runs?per_page=5&status=completed", { headers: { "user-agent": "dalil-guard", accept: "application/vnd.github+json" } });
    if (!r.ok) throw new Error("github " + r.status);
    const runs = ((await r.json()).workflow_runs || []) as { conclusion: string; updated_at: string }[];
    let fails = 0; for (const x of runs) { if (x.conclusion === "success") break; fails++; }
    const okAt = runs.find((x) => x.conclusion === "success")?.updated_at, h = ago(okAt);
    out.push({ id: "backup", name: "النسخة الاحتياطية", level: fails >= 2 || h > 50 ? "fail" : "ok",
      detail: (h === Infinity ? "ما فيه نسخة ناجحة" : "آخر نسخة ناجحة قبل " + hrs(h)) + (fails ? " · فشلت " + fails + " مرة ورا بعض (كلمة سر القاعدة تغيّرت؟ حدّث SUPABASE_DB_URL في GitHub)" : "") });
  } catch { out.push({ id: "backup", name: "النسخة الاحتياطية", level: "ok", detail: "تعذّر سؤال GitHub — نعيد الفحص الساعة الجاية" }); }
  return out;
}

// ---------- الإرسال لجوال المالك ----------
async function notify(sb: SupabaseClient, title: string, body: string) {
  const devs = JSON.parse((await sb.from("private_config").select("value").eq("key", "guard_devices").maybeSingle()).data?.value || "[]") as { kind: string; sub: string }[];
  let sent = 0;
  const cfg = await config(sb), jwt = await apnsToken(sb).catch(() => null);
  for (const d of devs) {
    try {
      if (d.kind === "ios" && jwt) {
        const r = await fetch("https://api.push.apple.com/3/device/" + d.sub, { method: "POST",
          body: JSON.stringify({ aps: { alert: { title, body }, sound: "default", "thread-id": "guard" }, url: "./" }),
          headers: { authorization: "bearer " + jwt, "apns-topic": "com.alluhaybi.dalil", "apns-push-type": "alert", "apns-priority": "10", "content-type": "application/json" } });
        if (r.ok) sent++;
      } else if (d.kind === "web") {
        const { data: s } = await sb.from("push_subs").select("endpoint,p256dh,auth").eq("endpoint", d.sub).maybeSingle();
        if (s) { webpush.setVapidDetails(cfg.vapid_subject, cfg.vapid_public, cfg.vapid_private); await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify({ title, body, url: "./", tag: "guard" })); sent++; }
      }
    } catch (e) { console.error("guard push", e); }
  }
  return sent;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(req) });
  if (req.method !== "POST") return json(req, { error: "method" }, 405);
  const action = new URL(req.url).searchParams.get("a") || "";
  const sb = db();
  try {
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;

    if (action === "run") {
      const { data: keyRow } = await sb.from("private_config").select("value").eq("key", "cron_key").maybeSingle();
      if (!keyRow?.value || req.headers.get("x-cron-key") !== keyRow.value) return json(req, { error: "forbidden" }, 403);
      const checks = await runChecks(sb);
      await sb.from("guard_log").insert({ checks });
      if (Math.random() < 0.1) await sb.from("guard_log").delete().lt("at", new Date(Date.now() - 7 * 864e5).toISOString());
      // تغيّر الحالة: «تحذير» لازم يتكرر فحصين ورا بعض (ما نزعجك بتأخير عابر)، «معطّل» فورًا
      const prev = JSON.parse((await sb.from("private_config").select("value").eq("key", "guard_state").maybeSingle()).data?.value || "{}") as Record<string, { told: Level; seen: Level; n: number }>;
      const next: typeof prev = {}, bad: string[] = [], good: string[] = [];
      for (const c of checks) {
        const p = prev[c.id] || { told: "ok" as Level, seen: "ok" as Level, n: 0 };
        const n = c.level === p.seen ? p.n + 1 : 1;
        let told = p.told;
        if (c.level === "fail" && told !== "fail") { bad.push("❌ " + c.name + ": " + c.detail); told = "fail"; }
        else if (c.level === "warn" && told === "ok" && n >= 2) { bad.push("⚠️ " + c.name + ": " + c.detail); told = "warn"; }
        else if (c.level === "ok" && told !== "ok") { good.push(c.name); told = "ok"; }
        next[c.id] = { told, seen: c.level, n };
      }
      await sb.from("private_config").upsert({ key: "guard_state", value: JSON.stringify(next) });
      let sent = 0;
      if (bad.length) sent += await notify(sb, "🛡️ حارس دليل: " + (bad.length === 1 ? "فيه مشكلة" : bad.length + " مشاكل"), bad.join("\n").slice(0, 900));
      if (good.length) sent += await notify(sb, "✅ حارس دليل: رجعت تشتغل", good.join("، "));
      return json(req, { ok: true, checks, alerted: bad.length, recovered: good.length, sent });
    }

    if (action === "pair") {
      const code = String(body.code || ""), kind = body.kind === "ios" ? "ios" : body.kind === "web" ? "web" : "", sub = String(body.sub || "");
      const p = JSON.parse((await sb.from("private_config").select("value").eq("key", "guard_pair").maybeSingle()).data?.value || "null");
      if (!p || !/^[A-Z0-9]{8}$/.test(code) || p.code !== code || Date.now() > p.exp) return json(req, { error: "bad_code" }, 400);
      if (!kind || !sub || sub.length > 1000) return json(req, { error: "no_push" }, 400);
      const exists = kind === "ios" ? (await sb.from("push_native").select("token").eq("token", sub.toLowerCase()).maybeSingle()).data
        : (await sb.from("push_subs").select("endpoint").eq("endpoint", sub).maybeSingle()).data;
      if (!exists) return json(req, { error: "not_subscribed" }, 404);
      const devs = JSON.parse((await sb.from("private_config").select("value").eq("key", "guard_devices").maybeSingle()).data?.value || "[]") as { kind: string; sub: string; at: string }[];
      const s = kind === "ios" ? sub.toLowerCase() : sub;
      const list = [...devs.filter((d) => d.sub !== s), { kind, sub: s, at: new Date().toISOString() }].slice(-3);
      await sb.from("private_config").upsert({ key: "guard_devices", value: JSON.stringify(list) });
      await sb.from("private_config").delete().eq("key", "guard_pair");
      await notify(sb, "🛡️ حارس دليل", "تم ربط جوالك ✓ يوصلك إشعار بس إذا تعطّلت خدمة.");
      return json(req, { ok: true });
    }

    // باقي الإجراءات للمشرفين
    const me = await admin(sb, req, body);
    if (!me) return json(req, { error: "unauthorized" }, 401);

    if (action === "status") {
      const { data: log } = await sb.from("guard_log").select("at,checks").gte("at", new Date(Date.now() - 7 * 864e5).toISOString()).order("at", { ascending: false }).limit(200);
      const devs = JSON.parse((await sb.from("private_config").select("value").eq("key", "guard_devices").maybeSingle()).data?.value || "[]") as unknown[];
      return json(req, { ok: true, last: log?.[0] || null, log: (log || []).map((r) => ({ at: r.at, l: (r.checks as Check[]).map((c) => [c.id, c.level]) })), devices: me.role === "owner" ? devs.length : undefined, owner: me.role === "owner" });
    }
    if (action === "check_now") {
      const checks = await runChecks(sb);
      return json(req, { ok: true, last: { at: new Date().toISOString(), checks } });
    }
    // 🧪 تجربة «أقرب مطر غزير وبرد» (صامتة — للمشرفين بس)
    if (action === "trial") {
      const { data: lastRow } = await sb.from("wx_trial_cells").select("frame").order("frame", { ascending: false }).limit(1).maybeSingle();
      const dayStart = new Date(Math.floor((Date.now() + 3 * H) / 864e5) * 864e5 - 3 * H).toISOString();
      const [{ data: cells }, { data: today }, { data: fcLast }, { count: total }, { count: yes }, { count: no }] = await Promise.all([
        lastRow ? sb.from("wx_trial_cells").select("id,frame,lat,lng,region,max_dbz,n,n55,lightning,mv_kmh,mv_dir,verified").eq("frame", lastRow.frame).order("n", { ascending: false }).limit(40) : Promise.resolve({ data: [] }),
        sb.rpc("wx_trial_today", { since: dayStart }),
        sb.from("wx_trial_fc").select("made_at").order("made_at", { ascending: false }).limit(1).maybeSingle(),
        sb.from("wx_trial_cells").select("id", { count: "exact", head: true }),
        sb.from("wx_trial_cells").select("id", { count: "exact", head: true }).eq("verified", 1),
        sb.from("wx_trial_cells").select("id", { count: "exact", head: true }).eq("verified", -1),
      ]);
      const fc = fcLast ? (await sb.from("wx_trial_fc").select("lat,lng,region,kind,agree,win_from,win_to,mm,cape").gte("made_at", new Date(Date.parse(fcLast.made_at) - 60e3).toISOString()).order("win_from").limit(300)).data : [];
      const byReg: Record<string, { n: number; hail: number; lt: number }> = {};
      for (const r of (today || []) as { region: string; n: number; hail: number; lt: number }[]) byReg[r.region] = { n: Number(r.n), hail: Number(r.hail), lt: Number(r.lt) };
      return json(req, { ok: true, frame: lastRow?.frame || null, cells: cells || [], today: byReg, fcAt: fcLast?.made_at || null, fc: fc || [], total: total ?? 0,
        marks: { yes: yes ?? 0, no: no ?? 0 } });
    }
    if (action === "trial_mark") {
      const id = Number(body.id), v = Number(body.v);
      if (!Number.isInteger(id) || ![1, -1, 0].includes(v)) return json(req, { error: "bad_request" }, 400);
      await sb.from("wx_trial_cells").update(v ? { verified: v, verified_by: me.username, verified_at: new Date().toISOString() } : { verified: null, verified_by: null, verified_at: null }).eq("id", id);
      return json(req, { ok: true });
    }
    if (me.role !== "owner") return json(req, { error: "forbidden" }, 403);
    if (action === "pair_code") {
      const abc = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789", r = crypto.getRandomValues(new Uint8Array(8));
      const code = [...r].map((x) => abc[x % abc.length]).join("");
      await sb.from("private_config").upsert({ key: "guard_pair", value: JSON.stringify({ code, exp: Date.now() + 10 * 60e3 }) });
      return json(req, { ok: true, code, link: "dalil://guard?code=" + code, web: PAGES + "?guard=" + code });
    }
    if (action === "unpair") {
      await sb.from("private_config").upsert({ key: "guard_devices", value: "[]" });
      return json(req, { ok: true });
    }
    return json(req, { error: "unknown_action" }, 400);
  } catch (e) {
    console.error("dalil-guard", action, e);
    return json(req, { error: "server" }, 500);
  }
});
