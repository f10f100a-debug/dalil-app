// تنبيهات تطبيق الأندرويد عبر Firebase Cloud Messaging (FCM v1).
// المفتاح: سر الدالة FCM_SERVICE_ACCOUNT (ملف حساب الخدمة JSON كامل). ما ينطبع ولا ينحفظ في أي مكان ثاني.
// رموز جدول push_native نوعين: أبل = hex (64+) صغير، أندرويد = رمز FCM (فيه «:» وحروف كبيرة وصغيرة).

export const isApns = (t: string) => /^[0-9a-f]{64,200}$/.test(t);
export const isFcm = (t: string) => !isApns(t) && /^[A-Za-z0-9_\-:]{100,500}$/.test(t);
// الرمز كما يُحفظ: أبل بالحروف الصغيرة، أندرويد كما هو (حساس لحالة الحروف)
export const normTok = (t: string) => /^[0-9a-fA-F]{64,200}$/.test(t) ? t.toLowerCase() : t;

type SA = { project_id: string; client_email: string; private_key: string };
let sa: SA | null | undefined;
let cached: { tok: string; exp: number } | null = null;

function account(): SA | null {
  if (sa !== undefined) return sa;
  try {
    const j = JSON.parse(Deno.env.get("FCM_SERVICE_ACCOUNT") || "");
    sa = j && j.project_id && j.client_email && j.private_key ? j : null;
  } catch { sa = null; }
  return sa ?? null;
}
export const fcmReady = () => !!account();

const b64u = (u: Uint8Array) => { let x = ""; for (const c of u) x += String.fromCharCode(c); return btoa(x).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); };

async function accessToken(): Promise<string | null> {
  const a = account(); if (!a) return null;
  if (cached && Date.now() < cached.exp) return cached.tok;
  const der = Uint8Array.from(atob(a.private_key.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "")), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const now = Math.floor(Date.now() / 1000);
  const enc = (o: unknown) => b64u(new TextEncoder().encode(JSON.stringify(o)));
  const head = enc({ alg: "RS256", typ: "JWT" }) + "." + enc({ iss: a.client_email, scope: "https://www.googleapis.com/auth/firebase.messaging",
    aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 });
  const sig = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(head)));
  const r = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: "grant_type=" + encodeURIComponent("urn:ietf:params:oauth:grant-type:jwt-bearer") + "&assertion=" + head + "." + b64u(sig) });
  if (!r.ok) { console.error("fcm oauth", r.status, (await r.text().catch(() => "")).slice(0, 200)); return null; }
  const j = await r.json();
  cached = { tok: j.access_token, exp: Date.now() + (Math.max(300, (j.expires_in || 3600)) - 120) * 1000 };
  return cached.tok;
}

export type FcmMsg = { title: string; body: string; url?: string; tag?: string; ttl?: number; silent?: boolean };
// يرجع: ok = وصل، gone = الرمز ميت (احذفه)، fail = تعثّر مؤقت أو ما فيه مفتاح
export async function sendFcm(token: string, m: FcmMsg): Promise<"ok" | "gone" | "fail"> {
  if (!isFcm(token)) return "gone";
  const a = account(), at = await accessToken().catch((e) => { console.error("fcm token", e); return null; });
  if (!a || !at) return "fail";
  const message = {
    token,
    notification: { title: m.title, body: m.body },
    data: { url: m.url || "./", tag: m.tag || "dalil" },
    android: {
      priority: m.silent ? "NORMAL" : "HIGH",
      ttl: Math.max(60, Math.round(m.ttl || 7200)) + "s",
      notification: { channel_id: "dalil", tag: m.tag || "dalil", ...(m.silent ? { notification_priority: "PRIORITY_LOW" } : { sound: "default", default_vibrate_timings: true }) },
    },
  };
  const r = await fetch("https://fcm.googleapis.com/v1/projects/" + a.project_id + "/messages:send", { method: "POST",
    headers: { authorization: "Bearer " + at, "content-type": "application/json" }, body: JSON.stringify({ message }) });
  if (r.ok) { await r.body?.cancel().catch(() => {}); return "ok"; }
  const t = await r.text().catch(() => "");
  if (r.status === 404 || /UNREGISTERED|registration-token-not-registered|not a valid FCM registration token/i.test(t)) return "gone";
  console.error("fcm send", r.status, t.slice(0, 200));
  return "fail";
}

// إرسال لمجموعة رموز أندرويد (دفعات صغيرة) — يرجع العدد والرموز الميتة
export async function sendFcmMany(tokens: string[], m: FcmMsg) {
  const toks = [...new Set(tokens.filter(isFcm))];
  let sent = 0; const gone: string[] = [];
  if (!toks.length || !fcmReady()) return { sent, gone, total: toks.length };
  for (let i = 0; i < toks.length; i += 50) {
    const batch = toks.slice(i, i + 50);
    const res = await Promise.all(batch.map((t) => sendFcm(t, m).catch(() => "fail" as const)));
    res.forEach((r, j) => { if (r === "ok") sent++; else if (r === "gone") gone.push(batch[j]); });
  }
  return { sent, gone, total: toks.length };
}
