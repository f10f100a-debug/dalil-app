// إشعار تجريبي لجهاز واحد (لتجربة نغمات نسخة الآيفون الجديدة) — داخلي فقط بمفتاح cron، ما يرسل لأي مشترك ثاني.
import { createClient } from "npm:@supabase/supabase-js@2";

const b64u = (u: Uint8Array) => { let s = ""; for (const x of u) s += String.fromCharCode(x); return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); };
Deno.serve(async (req) => {
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const { data: cfg } = await sb.from("private_config").select("key,value").in("key", ["cron_key", "apns_key_p8", "apns_key_id"]);
  const c = Object.fromEntries((cfg || []).map((r) => [r.key, r.value]));
  if (!c.cron_key || req.headers.get("x-cron-key") !== c.cron_key) return new Response("forbidden", { status: 403 });
  const b = await req.json().catch(() => ({}));
  const token = String(b.token || "");
  if (!/^[0-9a-f]{64,200}$/.test(token)) return new Response("bad token", { status: 400 });
  const pem = Deno.env.get("APNS_KEY_P8") || c.apns_key_p8, kid = Deno.env.get("APNS_KEY_ID") || c.apns_key_id, team = Deno.env.get("APNS_TEAM_ID") || "M3FNP2GR5Z";
  const der = Uint8Array.from(atob(pem.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "")), (x) => x.charCodeAt(0));
  const key = await crypto.subtle.importKey("pkcs8", der, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const enc = (o: unknown) => b64u(new TextEncoder().encode(JSON.stringify(o)));
  const head = enc({ alg: "ES256", kid }) + "." + enc({ iss: team, iat: Math.floor(Date.now() / 1000) });
  const jwt = head + "." + b64u(new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, new TextEncoder().encode(head))));
  const kind = b.kind === "event" ? "event" : "rain";
  const p = kind === "rain"
    ? { title: "🌧️ تجربة: تنبيه مطر", body: "هذا إشعار تجريبي لنغمة المطر في دليل 1.8 — وصلك أنت بس." }
    : { title: "📸 تجربة: حدث جديد", body: "هذا إشعار تجريبي لنغمة الأحداث في دليل 1.8 — وصلك أنت بس." };
  const r = await fetch("https://api.push.apple.com/3/device/" + token, { method: "POST",
    body: JSON.stringify({ aps: { alert: p, sound: "dalil-" + kind + ".caf", "thread-id": "test" }, url: "./?screen=weather" }),
    headers: { authorization: "bearer " + jwt, "apns-topic": "com.alluhaybi.dalil", "apns-push-type": "alert", "apns-priority": "10", "content-type": "application/json" } });
  return new Response(JSON.stringify({ kind, status: r.status, body: await r.text() }), { headers: { "content-type": "application/json" } });
});
