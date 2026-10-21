// إرسال تنبيهات تطبيق الآيفون عبر APNs. المفتاح من أسرار الدالة أو جدول private_config (مقفل بـ RLS).
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { b64uEncode } from "./common.ts";

let cached: { tok: string; at: number } | null = null;
export async function apnsToken(sb: SupabaseClient): Promise<string | null> {
  let pem = Deno.env.get("APNS_KEY_P8"), kid = Deno.env.get("APNS_KEY_ID");
  const team = Deno.env.get("APNS_TEAM_ID") || "M3FNP2GR5Z";
  if (!pem || !kid) {
    const { data } = await sb.from("private_config").select("key,value").in("key", ["apns_key_p8", "apns_key_id"]);
    for (const r of data || []) { if (r.key === "apns_key_p8") pem = pem || r.value; if (r.key === "apns_key_id") kid = kid || r.value; }
  }
  if (!pem || !kid) return null;
  if (cached && Date.now() - cached.at < 40 * 60e3) return cached.tok;
  const der = Uint8Array.from(atob(pem.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "")), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("pkcs8", der, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const enc = (o: unknown) => b64uEncode(new TextEncoder().encode(JSON.stringify(o)));
  const head = enc({ alg: "ES256", kid }) + "." + enc({ iss: team, iat: Math.floor(Date.now() / 1000) });
  const sig = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, new TextEncoder().encode(head)));
  cached = { tok: head + "." + b64uEncode(sig), at: Date.now() };
  return cached.tok;
}

export async function sendApnsTo(sb: SupabaseClient, tokens: string[], p: { title: string; body: string; url?: string; tag?: string }) {
  const toks = [...new Set(tokens.filter((t) => /^[0-9a-f]{64,200}$/.test(t)))];
  if (!toks.length) return { sent: 0 };
  const jwt = await apnsToken(sb);
  if (!jwt) return { sent: 0, skipped: true };
  const body = JSON.stringify({ aps: { alert: { title: p.title, body: p.body }, sound: "default", "thread-id": p.tag || "room" }, url: p.url || "./" });
  let sent = 0;
  await Promise.allSettled(toks.map(async (t) => {
    const r = await fetch("https://api.push.apple.com/3/device/" + t, { method: "POST", body,
      headers: { authorization: "bearer " + jwt, "apns-topic": "com.alluhaybi.dalil", "apns-push-type": "alert", "apns-priority": "10",
        "apns-expiration": String(Math.floor(Date.now() / 1000) + 3600), "content-type": "application/json" } });
    if (r.ok) sent++;
    else if (r.status === 410 || /BadDeviceToken|Unregistered/.test(await r.text().catch(() => ""))) await sb.from("room_members").update({ push_token: null }).eq("push_token", t);
  }));
  return { sent };
}
