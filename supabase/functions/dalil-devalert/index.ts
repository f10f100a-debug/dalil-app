// تنبيه المطوّر (جوال أبو مالك فقط، private_config.dev_token): كل ساعة (pg_cron) نشيك هل فيه تحديث بيانات محجوز للمراجعة
// (data/fayd-qa.md منشور على الموقع) — إذا فيه وما نبّهنا عنه قبل، يوصله إشعار واحد. داخلي فقط بمفتاح cron.
import { createClient } from "npm:@supabase/supabase-js@2";
const b64u = (u: Uint8Array) => { let s = ""; for (const x of u) s += String.fromCharCode(x); return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); };
const SITE = "https://f10f100a-debug.github.io/dalil-app/";
const CHECKS = [{ file: "data/fayd-qa.md", title: "⚠️ تحديث الفياض محجوز" }, { file: "data/fayd-new-qa.md", title: "⚠️ مسح الفياض الجديدة محجوز" }];
Deno.serve(async (req) => {
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const { data: cfg } = await sb.from("private_config").select("key,value").in("key", ["cron_key", "apns_key_p8", "apns_key_id", "dev_token", "dev_alert_seen"]);
  const c = Object.fromEntries((cfg || []).map((r) => [r.key, r.value]));
  if (!c.cron_key || req.headers.get("x-cron-key") !== c.cron_key) return new Response("forbidden", { status: 403 });
  if (!c.dev_token) return new Response(JSON.stringify({ ok: false, why: "no dev_token" }));
  const seen = new Set(String(c.dev_alert_seen || "").split("\n").filter(Boolean));
  const out: unknown[] = [];
  for (const ck of CHECKS) {
    const r = await fetch(SITE + ck.file + "?t=" + Date.now()).catch(() => null);
    if (!r || !r.ok) { out.push({ file: ck.file, held: false }); await r?.body?.cancel().catch(() => {}); continue; }
    const text = (await r.text()).trim(); const first = text.split("\n")[0].slice(0, 170);
    if (!text || seen.has(first)) { out.push({ file: ck.file, held: true, sent: false }); continue; }
    const pem = Deno.env.get("APNS_KEY_P8") || c.apns_key_p8, kid = Deno.env.get("APNS_KEY_ID") || c.apns_key_id, team = Deno.env.get("APNS_TEAM_ID") || "M3FNP2GR5Z";
    const der = Uint8Array.from(atob(pem.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "")), (x) => x.charCodeAt(0));
    const key = await crypto.subtle.importKey("pkcs8", der, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
    const enc = (o: unknown) => b64u(new TextEncoder().encode(JSON.stringify(o)));
    const head = enc({ alg: "ES256", kid }) + "." + enc({ iss: team, iat: Math.floor(Date.now() / 1000) });
    const jwt = head + "." + b64u(new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, new TextEncoder().encode(head))));
    const res = await fetch("https://api.push.apple.com/3/device/" + c.dev_token, { method: "POST",
      body: JSON.stringify({ aps: { alert: { title: ck.title, body: first + " — راجعه مع Claude" }, sound: "default", "thread-id": "dev" }, url: "./" }),
      headers: { authorization: "bearer " + jwt, "apns-topic": "com.alluhaybi.dalil", "apns-push-type": "alert", "apns-priority": "10", "content-type": "application/json" } });
    out.push({ file: ck.file, held: true, sent: res.status }); await res.body?.cancel().catch(() => {});
    if (res.ok) { seen.add(first); await sb.from("private_config").upsert({ key: "dev_alert_seen", value: [...seen].slice(-30).join("\n") }); }
  }
  return new Response(JSON.stringify({ ok: true, out }), { headers: { "content-type": "application/json" } });
});
