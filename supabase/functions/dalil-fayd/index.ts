// تنبيه اخضرار الفياض.
// a=watch (من التطبيق): يحفظ نطاق التنبيه (50–500 كم) وموقع المستخدم مقرّبًا لـ0.25° (~25 كم) والفياض اللي يتابعها.
//   ما يُقبل إلا لاشتراك تنبيهات موجود فعلًا (ويب أو آيفون).
// a=run (pg_cron مرتين باليوم): إذا تحدّثت بيانات الفياض (data/fayd.json) يرسل لكل مشترك الفياض اللي اخضرّت
//   («مثل المعتاد» أو أخضر) داخل نطاقه أو اللي يتابعها: إشعار واحد مجمّع، أقصى شي كل 60 ساعة (≈ إشعارين بالأسبوع)،
//   وما يتكرر نفس الفيضة في الموسم. dry=1 يحسب بدون إرسال، ويقبل بيانات تجريبية في الطلب.
import webpush from "npm:web-push@3.6.7";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { config, cors, db, json } from "../_shared/common.ts";
import { apnsToken } from "../_shared/apns.ts";

const PAGES = "https://f10f100a-debug.github.io/dalil-app/";
const KMS = [0, 50, 100, 250, 500];
const GREEN = 2;                 // 2 = «مثل المعتاد»، 3–4 = أخضر من المعتاد
const GAP_H = 60;                // أقل مدة بين إشعارين لنفس المشترك
const round = (v: number) => Math.round(v * 4) / 4;
const km = (a: number, b: number, c: number, d: number) => {
  const r = Math.PI / 180, x = Math.sin((c - a) * r / 2) ** 2 + Math.cos(a * r) * Math.cos(c * r) * Math.sin((d - b) * r / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(x));
};
const season = (d = new Date()) => d.getUTCMonth() >= 7 ? d.getUTCFullYear() : d.getUTCFullYear() - 1;   // الموسم من أغسطس
const fmtKm = (k: number) => k < 10 ? k.toFixed(1) : String(Math.round(k));
const count = (n: number) => n === 1 ? "فيضة" : n === 2 ? "فيضتين" : n <= 10 ? n + " فياض" : n + " فيضة";

type Row = { kind: string; sub: string; km: number; lat: number | null; lng: number | null; follow: number[]; sent: number[]; season: number | null; last_sent: string | null };

async function pushWeb(sb: SupabaseClient, cfg: Record<string, string>, endpoint: string, p: Record<string, string>) {
  const { data: s } = await sb.from("push_subs").select("endpoint,p256dh,auth").eq("endpoint", endpoint).maybeSingle();
  if (!s) return "gone";
  webpush.setVapidDetails(cfg.vapid_subject, cfg.vapid_public, cfg.vapid_private);
  try { await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(p), { TTL: 24 * 3600, urgency: "normal" }); return "ok"; }
  catch (e) { const c = (e as { statusCode?: number }).statusCode; if (c === 400 || c === 403 || c === 404 || c === 410) { await sb.from("push_subs").delete().eq("endpoint", endpoint); return "gone"; } return "fail"; }
}
async function pushIos(sb: SupabaseClient, jwt: string | null, token: string, p: Record<string, string>) {
  const { data: s } = await sb.from("push_native").select("token").eq("token", token).maybeSingle();
  if (!s) return "gone";
  if (!jwt) return "fail";
  const res = await fetch("https://api.push.apple.com/3/device/" + token, { method: "POST",
    body: JSON.stringify({ aps: { alert: { title: p.title, body: p.body }, sound: "default", "thread-id": "fayd" }, url: p.url }),
    headers: { authorization: "bearer " + jwt, "apns-topic": "com.alluhaybi.dalil", "apns-push-type": "alert", "apns-priority": "5",
      "apns-expiration": String(Math.floor(Date.now() / 1000) + 24 * 3600), "content-type": "application/json" } });
  if (res.ok) return "ok";
  const t = await res.text().catch(() => "");
  if (res.status === 410 || /BadDeviceToken|Unregistered|DeviceTokenNotForTopic/.test(t)) { await sb.from("push_native").delete().eq("token", token); return "gone"; }
  return "fail";
}

// الرسالة لمشترك واحد: الفياض الجديدة المخضرّة داخل نطاقه أو اللي يتابعها (الأقرب أولًا)
function pick(w: Row, green: { i: number; name: string; lat: number; lng: number }[], now = new Date()) {
  const sent = new Set(w.season === season(now) ? w.sent : []);
  const follow = new Set(w.follow || []);
  const hits = green.filter((g) => !sent.has(g.i)).map((g) => ({ ...g, d: w.lat != null && w.lng != null ? km(w.lat, w.lng, g.lat, g.lng) : null }))
    .filter((g) => follow.has(g.i) || (w.km > 0 && g.d != null && g.d <= w.km))
    .sort((a, b) => (follow.has(b.i) ? 1 : 0) - (follow.has(a.i) ? 1 : 0) || (a.d ?? 1e9) - (b.d ?? 1e9));
  if (!hits.length) return null;
  const top = hits.slice(0, 3).map((g) => g.name + (g.d != null ? " (" + fmtKm(g.d) + " كم)" : ""));
  const onlyFollow = hits.every((g) => follow.has(g.i)) && hits.length === 1;
  const title = onlyFollow ? "🌱 اخضرّت " + hits[0].name : hits.length === 1 ? "🌱 اخضرّت فيضة قريبة منك" : "🌱 اخضرّت " + count(hits.length) + " في نطاقك";
  const body = (hits.length > 1 ? "أقربها " : "") + top.join(" · ") + " — افتح دليل وشوفها";
  return { title, body, url: "./?screen=weather&tab=fayd", tag: "fayd", ids: hits.map((g) => g.i) };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(req) });
  if (req.method !== "POST") return json(req, { error: "method" }, 405);
  const url = new URL(req.url), action = url.searchParams.get("a") || "";
  const sb = db();
  try {
    const body = await req.json().catch(() => ({})) as Record<string, any>;

    if (action === "watch") {
      const kind = body.kind === "ios" ? "ios" : body.kind === "web" ? "web" : "";
      const sub = String(body.sub || "");
      if (!kind || !sub || sub.length > 1000) return json(req, { error: "bad_request" }, 400);
      // لازم يكون اشتراك تنبيهات حقيقي (ما نخزن شي لغير المشتركين)
      const { data: s } = kind === "ios" ? await sb.from("push_native").select("token").eq("token", sub.toLowerCase()).maybeSingle()
        : await sb.from("push_subs").select("endpoint").eq("endpoint", sub).maybeSingle();
      if (!s) return json(req, { error: "not_subscribed" }, 404);
      const k = KMS.includes(Number(body.km)) ? Number(body.km) : 0;
      const follow = (Array.isArray(body.follow) ? body.follow : []).map(Number).filter((n: number) => Number.isInteger(n) && n >= 0 && n < 5000).slice(0, 50);
      const key = { kind, sub: kind === "ios" ? sub.toLowerCase() : sub };
      if (!k && !follow.length) { await sb.from("fayd_watch").delete().match(key); return json(req, { ok: true, off: true }); }
      const lat = Number(body.lat), lng = Number(body.lng);
      const loc = Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && (lat || lng) ? { lat: round(lat), lng: round(lng) } : {};
      const { error } = await sb.from("fayd_watch").upsert({ ...key, km: k, follow, ...loc, updated_at: new Date().toISOString() }, { onConflict: "kind,sub" });
      if (error) throw error;
      return json(req, { ok: true });
    }

    if (action === "run") {
      const { data: keyRow } = await sb.from("private_config").select("value").eq("key", "cron_key").maybeSingle();
      if (!keyRow?.value || req.headers.get("x-cron-key") !== keyRow.value) return json(req, { error: "forbidden" }, 403);
      const dry = url.searchParams.get("dry") === "1";
      // البيانات: من الصفحة المنشورة (أو تجريبية في الطلب مع dry)
      const t = Date.now();
      const fy = dry && body.fayd ? body.fayd : await fetch(PAGES + "data/fayd.json?t=" + t).then((r) => r.json());
      const sites = dry && body.sites ? body.sites : await fetch(PAGES + "data/fayd-sites.json?t=" + t).then((r) => r.json());
      const { data: last } = await sb.from("private_config").select("value").eq("key", "fayd_alert_asof").maybeSingle();
      if (!dry && last?.value && fy.asof <= last.value) return json(req, { ok: true, skipped: "no_new_data", asof: fy.asof });
      const green = (fy.rows || []).filter((r: number[]) => r[2] >= GREEN && sites[r[0]]).map((r: number[]) => ({ i: r[0], name: sites[r[0]][0], lat: sites[r[0]][1], lng: sites[r[0]][2] }));
      const now = dry && body.now ? new Date(body.now) : new Date();
      const { data: rows } = await sb.from("fayd_watch").select("*").limit(50000);
      const watchers = (dry && Array.isArray(body.watch) ? body.watch : rows || []) as Row[];
      const cfg = dry ? {} : await config(sb);
      const jwt = dry ? null : await apnsToken(sb);
      const out = { asof: fy.asof, green: green.length, watchers: watchers.length, sent: 0, gone: 0, fail: 0, gap: 0, none: 0, preview: [] as unknown[] };
      for (const w of watchers) {
        if (w.last_sent && now.getTime() - new Date(w.last_sent).getTime() < GAP_H * 3600e3) { out.gap++; continue; }
        const m = pick(w, green, now);
        if (!m) { out.none++; continue; }
        if (dry) { out.preview.push({ sub: String(w.sub).slice(0, 12), title: m.title, body: m.body, ids: m.ids }); continue; }
        const p = { title: m.title, body: m.body, url: m.url, tag: m.tag };
        const r = w.kind === "ios" ? await pushIos(sb, jwt, w.sub, p) : await pushWeb(sb, cfg, w.sub, p);
        if (r === "gone") { await sb.from("fayd_watch").delete().match({ kind: w.kind, sub: w.sub }); out.gone++; continue; }
        if (r === "fail") { out.fail++; continue; }
        const ss = season(now), prev = w.season === ss ? w.sent : [];
        await sb.from("fayd_watch").update({ sent: [...new Set([...prev, ...m.ids])].slice(-2000), season: ss, last_sent: now.toISOString() }).match({ kind: w.kind, sub: w.sub });
        out.sent++;
      }
      if (!dry) await sb.from("private_config").upsert({ key: "fayd_alert_asof", value: fy.asof });
      if (!dry) await sb.from("private_config").upsert({ key: "fayd_alert_last", value: JSON.stringify({ at: now.toISOString(), ...out, preview: undefined }) });
      return json(req, { ok: true, ...out });
    }
    return json(req, { error: "unknown_action" }, 400);
  } catch (e) {
    console.error("dalil-fayd", action, e);
    return json(req, { error: "server" }, 500);
  }
});
