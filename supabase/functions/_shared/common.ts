import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2";

const ALLOWED_ORIGINS = new Set([
  "https://f10f100a-debug.github.io",
  "http://localhost:8765",
]);

export const REGIONS = ["جازان","حائل","الحدود الشمالية","الجوف","عسير","مكة","الشرقية","نجران","الباحة","تبوك","المدينة","القصيم","الرياض"];
export const KINDS = ["rain","flood","spring","dust","road","other"];
export const KIND_AR: Record<string,string> = { rain:"مطر", flood:"سيل", spring:"ربيع", dust:"غبار", road:"حالة طريق", other:"حدث" };

export function cors(req: Request): Record<string,string> {
  const origin = req.headers.get("origin") || "";
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGINS.has(origin) ? origin : "https://f10f100a-debug.github.io",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "content-type, apikey, authorization, x-client-info",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}

export function json(req: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors(req), "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

export function db(): SupabaseClient {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

let configCache: Record<string,string> | null = null;
export async function config(sb: SupabaseClient): Promise<Record<string,string>> {
  if (configCache) return configCache;
  const { data, error } = await sb.from("app_config").select("key,value");
  if (error) throw error;
  configCache = Object.fromEntries((data || []).map((r) => [r.key, r.value]));
  return configCache;
}

export function b64uDecode(s: string): Uint8Array {
  const b = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4));
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
}
export function b64uEncode(buf: ArrayBuffer | Uint8Array): string {
  const u = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = ""; for (const x of u) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function clientIp(req: Request): string {
  return req.headers.get("cf-connecting-ip")
    || (req.headers.get("x-forwarded-for") || "").split(",")[0].trim()
    || req.headers.get("x-real-ip") || "unknown";
}

export async function ipHash(req: Request, salt: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(salt + "|" + clientIp(req)));
  return b64uEncode(d).slice(0, 32);
}

export function cleanText(v: unknown, max: number): string {
  return String(v ?? "")
    .replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, " ")
    .replace(/\s+/g, " ").trim().slice(0, max);
}

// Push endpoints we are willing to POST to (prevents using our sender against arbitrary URLs).
const PUSH_HOSTS = [/^fcm\.googleapis\.com$/, /^web\.push\.apple\.com$/, /^updates\.push\.services\.mozilla\.com$/, /^push\.services\.mozilla\.com$/, /\.notify\.windows\.com$/, /^android\.googleapis\.com$/];
export function validPushEndpoint(ep: string): boolean {
  try {
    const u = new URL(ep);
    return u.protocol === "https:" && PUSH_HOSTS.some((r) => r.test(u.hostname)) && ep.length <= 1000;
  } catch { return false; }
}

// Deletes expired / stale content. Cheap; called opportunistically.
export async function cleanup(sb: SupabaseClient) {
  const now = new Date().toISOString();
  const dayAgo = new Date(Date.now() - 86400e3).toISOString();
  const threeDaysAgo = new Date(Date.now() - 3 * 86400e3).toISOString();
  const { data: live } = await sb.from("events").select("id,photo_path,thumb_path").eq("status", "approved").lt("expires_at", now).limit(200);
  if (live?.length) {
    await sb.storage.from("events").remove(live.flatMap((e) => [e.photo_path, e.thumb_path]));
    await sb.from("events").delete().in("id", live.map((e) => e.id));
  }
  const { data: stale } = await sb.from("events").select("id,photo_path,thumb_path,status")
    .or(`and(status.eq.pending,created_at.lt.${threeDaysAgo}),and(status.in.(rejected,hidden),created_at.lt.${dayAgo})`).limit(200);
  if (stale?.length) {
    const pend = stale.filter((e) => e.status === "pending" || e.status === "rejected");
    const pub = stale.filter((e) => e.status === "hidden");
    if (pend.length) await sb.storage.from("pending").remove(pend.flatMap((e) => [e.photo_path, e.thumb_path]));
    if (pub.length) await sb.storage.from("events").remove(pub.flatMap((e) => [e.photo_path, e.thumb_path]));
    await sb.from("events").delete().in("id", stale.map((e) => e.id));
  }
  await sb.from("events").update({ ip_hash: "" }).lt("created_at", new Date(Date.now() - 2 * 86400e3).toISOString()).neq("ip_hash", "");
  await sb.from("admin_attempts").delete().lt("at", new Date(Date.now() - 7 * 86400e3).toISOString());
}
