// «نبّهني حسب موقعي» — التجربة الصامتة (pg_cron كل 10 دقايق).
// 1) يحذف المواقع اللي مر عليها 24 ساعة (near_watch) والسجل الأقدم من 30 يوم، وأجوبة «نزل عندك مطر؟» بعد 9 شهور.
// 2) للإطار الجديد من الرادار: مين من المشتركين في الخيار كانت بتجيه عاصفة أو برد «متجه نحوه» (near_hits)
//    ويسجّله في near_dry_log ببصمة مختصرة — بدون أي إرسال، لين نراجع النتائج ونعتمد الإرسال.
// 3) استثناء للتجربة: البصمات المكتوبة في private_config.near_live (مفصولة بفواصل) يوصلها إشعار حقيقي (آيفون فقط).
import { createClient } from "npm:@supabase/supabase-js@2";

// تشغيل داخلي فقط (pg_cron) — ما يحتاج مساعدات المتصفح المشتركة
const cors = (_req: Request): Record<string, string> => ({ "Access-Control-Allow-Origin": "https://f10f100a-debug.github.io" });
const json = (req: Request, body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors(req), "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });
const db = () => createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false, autoRefreshToken: false } });

const b64u = (u: Uint8Array) => { let x = ""; for (const c of u) x += String.fromCharCode(c); return btoa(x).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); };
async function apnsJwt(sb: ReturnType<typeof db>) {
  const { data } = await sb.from("private_config").select("key,value").in("key", ["apns_key_p8", "apns_key_id"]);
  const c = Object.fromEntries((data || []).map((r) => [r.key, r.value]));
  const pem = Deno.env.get("APNS_KEY_P8") || c.apns_key_p8, kid = Deno.env.get("APNS_KEY_ID") || c.apns_key_id, team = Deno.env.get("APNS_TEAM_ID") || "M3FNP2GR5Z";
  if (!pem || !kid) return null;
  const der = Uint8Array.from(atob(pem.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "")), (x) => x.charCodeAt(0));
  const key = await crypto.subtle.importKey("pkcs8", der, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const enc = (o: unknown) => b64u(new TextEncoder().encode(JSON.stringify(o)));
  const head = enc({ alg: "ES256", kid }) + "." + enc({ iss: team, iat: Math.floor(Date.now() / 1000) });
  return head + "." + b64u(new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, new TextEncoder().encode(head))));
}
// نص التنبيه: dir = وين العاصفة من المستخدم، eta 0 = فوقه أو أقل من 8 كم
function nearText(h: { kind: string; km: number; dir: string; eta_min: number }) {
  const hail = h.kind === "hail";
  const title = (hail ? "🧊 احتمال برد" : "⛈️ عاصفة رعدية") + (h.eta_min > 0 ? " يتجه نحوك" : " فوقك أو قريب جدًا");
  const where = h.eta_min > 0 ? Math.round(h.km) + " كم " + h.dir + " موقعك · يوصلك بعد " + h.eta_min + " د تقريبًا." : "أقل من 8 كم منك.";
  return { title, body: where + (hail ? " ادخل سيارتك تحت مظلة وابتعد عن الأماكن المكشوفة." : " انتبه من السيول والبرق.") };
}

const hash = async (s: string) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s))))
  .map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 12);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(req) });
  if (req.method !== "POST") return json(req, { error: "method" }, 405);
  const sb = db();
  const { data: keyRow } = await sb.from("private_config").select("value").eq("key", "cron_key").maybeSingle();
  if (!keyRow?.value || req.headers.get("x-cron-key") !== keyRow.value) return json(req, { error: "forbidden" }, 403);
  try {
    const now = Date.now();
    await sb.from("near_watch").delete().lt("updated_at", new Date(now - 24 * 3600e3).toISOString());
    if (Math.random() < 0.05) await sb.from("near_dry_log").delete().lt("at", new Date(now - 30 * 86400e3).toISOString());
    // أجوبة «نزل عندك مطر؟» تنحذف بعد الموسم (9 شهور)
    if (Math.random() < 0.02) await sb.from("rain_answers").delete().lt("at", new Date(now - 270 * 86400e3).toISOString());
    const { data: lastRow } = await sb.from("near_dry_log").select("frame").order("frame", { ascending: false }).limit(1).maybeSingle();
    const { data: newRow } = await sb.from("wx_trial_cells").select("frame").order("frame", { ascending: false }).limit(1).maybeSingle();
    const fLast = lastRow?.frame || new Date(now - 20 * 60e3).toISOString(), fNew = newRow?.frame;
    if (!fNew || Date.parse(fNew) <= Date.parse(fLast)) return json(req, { ok: true, skipped: "no_new_frame" });
    const { data: ws } = await sb.from("near_watch").select("kind,sub,lat,lng").limit(50000);
    const subOf = new Map<string, { kind: string; sub: string }>();
    const w = await Promise.all((ws || []).map(async (r) => { const id = await hash(r.kind + r.sub); subOf.set(id, { kind: r.kind, sub: r.sub }); return { id, lat: r.lat, lng: r.lng }; }));
    let sent = 0;
    let logged = 0;
    if (w.length) {
      const { data: hits, error } = await sb.rpc("near_hits", { p_from: fLast, p_to: fNew, p_w: w });
      if (error) throw error;
      // أقرب/أخطر خلية لكل مستخدم، وما نكرر خلال 3 ساعات (إلا برد بعد عاصفة)
      type H = { id: string; frame: string; kind: string; km: number; dir: string; eta_min: number; dbz: number; cell_lat: number; cell_lng: number };
      const best = new Map<string, H>();
      for (const h of (hits || []) as H[]) {
        const b = best.get(h.id);
        if (!b || (h.kind === "hail" && b.kind !== "hail") || (h.kind === b.kind && h.eta_min < b.eta_min)) best.set(h.id, h);
      }
      if (best.size) {
        const { data: recent } = await sb.from("near_dry_log").select("who,kind").in("who", [...best.keys()]).gte("frame", new Date(Date.parse(fNew) - 3 * 3600e3).toISOString());
        const rows = [...best.values()].filter((h) => !(recent || []).some((l) => l.who === h.id && (l.kind === "hail" || h.kind === "storm")))
          .map((h) => ({ frame: h.frame, who: h.id, kind: h.kind, km: h.km, dir: h.dir, eta_min: h.eta_min, dbz: h.dbz, cell_lat: h.cell_lat, cell_lng: h.cell_lng }));
        if (rows.length) { const { error: e2 } = await sb.from("near_dry_log").insert(rows); if (e2) throw e2; logged = rows.length; }
        // تجربة الإرسال الحقيقي لأجهزة محددة فقط
        const { data: liveRow } = await sb.from("private_config").select("value").eq("key", "near_live").maybeSingle();
        const live = new Set(String(liveRow?.value || "").split(",").map((x) => x.trim()).filter(Boolean));
        const toSend = rows.filter((r) => live.has(r.who) && subOf.get(r.who)?.kind === "ios");
        if (toSend.length) {
          const jwt = await apnsJwt(sb);
          for (const r of toSend) {
            if (!jwt) break;
            const age = Math.max(0, Math.round((Date.now() - Date.parse(r.frame)) / 60e3));   // صورة الرادار عمرها كذا دقيقة
            const t = nearText({ ...r, eta_min: r.eta_min > 0 ? Math.max(1, r.eta_min - age) : 0 }), token = subOf.get(r.who)!.sub;
            const res = await fetch("https://api.push.apple.com/3/device/" + token, { method: "POST",
              body: JSON.stringify({ aps: { alert: t, sound: "dalil-rain.caf", "thread-id": "near" }, url: "./?screen=weather" }),
              headers: { authorization: "bearer " + jwt, "apns-topic": "com.alluhaybi.dalil", "apns-push-type": "alert", "apns-priority": "10",
                "apns-expiration": String(Math.floor(Date.now() / 1000) + 1800), "content-type": "application/json" } });
            if (res.ok) sent++;
            await res.body?.cancel().catch(() => {});
          }
        }
      }
    }
    await sb.from("near_dry_log").insert({ frame: fNew, who: "-", kind: "none" });   // علامة آخر إطار انفحص
    return json(req, { ok: true, frame: fNew, watchers: w.length, logged, sent });
  } catch (e) {
    return json(req, { error: String((e as Error)?.message || e).slice(0, 200) }, 500);
  }
});
