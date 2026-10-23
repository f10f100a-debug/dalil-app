// روابط دليل القصيرة على dalilbarr.com (Cloudflare Worker)
//   dalilbarr.com/r/789014/0000  → صفحة دعوة غرفة الرحلة (بطاقة واتساب + زر يفتح التطبيق)
//   dalilbarr.com                → صفحة التطبيق في App Store
//   /.well-known/apple-app-site-association → لفتح التطبيق مباشرة من 1.5 فما فوق
const APP = "https://f10f100a-debug.github.io/dalil-app/";
const STORE = "https://apps.apple.com/app/id6822651903";
const GUIDE = "https://f10f100a-debug.github.io/dalil-app/guide.html";   // كان ملف Drive القديم
const OG_IMG = APP + "assets/og-room.jpg", ICON = APP + "assets/icon-192.png";
const AASA = {
  applinks: { details: [{ appIDs: ["M3FNP2GR5Z.com.alluhaybi.dalil"], components: [{ "/": "/r/*" }] }] },
};

export default {
  async fetch(req) {
    const url = new URL(req.url);
    if (url.hostname.startsWith("www.")) { url.hostname = url.hostname.slice(4); return Response.redirect(url.toString(), 301); }
    const p = url.pathname;
    if (p === "/.well-known/apple-app-site-association" || p === "/apple-app-site-association")
      return new Response(JSON.stringify(AASA), { headers: { "content-type": "application/json", "cache-control": "max-age=3600" } });
    const m = p.match(/^\/r\/(\d{4,8})(?:\/([0-9A-Za-z]{1,12}))?\/?$/);
    // الرمز من المسار أو ?p= — أرقام وحروف إنجليزية فقط، وإلا يُتجاهل (حماية من حقن الصفحة)
    if (m) { const pin = m[2] || url.searchParams.get("p") || ""; return room(m[1], /^[0-9A-Za-z]{1,12}$/.test(pin) ? pin : ""); }
    if (p === "/" || p === "") return Response.redirect(STORE, 302);
    // دليل المستخدم (PDF على Google Drive) — نغيّر الرابط هنا فقط إذا تحدّث الدليل
    if (/^\/(guide|dalil|manual|دليل)\/?$/i.test(decodeURIComponent(p))) return Response.redirect(GUIDE, 302);
    return new Response("الرابط غير صحيح", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });
  },
};

function room(code, pin) {
  const q = "room=" + code + (pin ? "&pin=" + encodeURIComponent(pin) : "");
  const web = APP + "?" + q, scheme = "dalil://room?code=" + code + (pin ? "&pin=" + encodeURIComponent(pin) : "");
  const html = `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>دليل — دعوة لغرفة الرحلة</title>
<meta property="og:type" content="website"><meta property="og:site_name" content="دليل — بوصلة البر">
<meta property="og:title" content="🏕️ تعال انضم لنا في غرفة الرحلة"><meta property="og:description" content="اضغط هنا وتدخل الغرفة على طول — نتكلم بالصوت مثل اللاسلكي ونشوف مواقع بعض في البر">
<meta property="og:image" content="${OG_IMG}"><meta property="og:image:width" content="800"><meta property="og:image:height" content="800">
<meta property="og:url" content="https://dalilbarr.com/r/${code}${pin ? "/" + pin : ""}"><meta name="twitter:card" content="summary_large_image">
<meta name="apple-itunes-app" content="app-id=6822651903, app-argument=${web}">
<meta name="theme-color" content="#F2EFE9">
<style>
:root{--bg:#F2EFE9;--card:#fff;--ink:#2B2620;--dim:#7A6F62;--gold:#B8872E;--line:#E4DCCF}
@media (prefers-color-scheme:dark){:root{--bg:#1C1915;--card:#26221C;--ink:#F2EDE4;--dim:#B3A794;--line:#3A342B}}
*{box-sizing:border-box}body{margin:0;min-height:100vh;background:var(--bg);color:var(--ink);font:17px/1.6 -apple-system,"SF Arabic","Segoe UI",Tahoma,sans-serif;display:flex;align-items:center;justify-content:center;padding:24px 16px}
.c{width:100%;max-width:420px;background:var(--card);border:1px solid var(--line);border-radius:24px;padding:28px 22px;text-align:center}
img{width:96px;height:96px;border-radius:22px}h1{font-size:23px;margin:14px 0 4px}p{color:var(--dim);margin:0 0 20px}
.code{display:inline-block;background:var(--bg);border-radius:12px;padding:6px 14px;margin-bottom:20px;font-weight:700;letter-spacing:1px}
a.b{display:block;text-decoration:none;border-radius:16px;padding:15px;font-weight:700;margin-top:10px}
.g{background:var(--gold);color:#fff}.w{border:1px solid var(--line);color:var(--ink)}small{display:block;color:var(--dim);margin-top:16px;font-size:13px}
</style></head><body><main class="c">
<img src="${ICON}" alt="دليل">
<h1>🏕️ دعوة لغرفة الرحلة</h1>
<p>نتكلم بالصوت مثل اللاسلكي ونشوف مواقع بعض في البر</p>
<div class="code">رقم الغرفة ${code}${pin ? " · الرمز " + pin : ""}</div>
<a class="b g" href="${web}">ادخل الغرفة في تطبيق دليل</a>
<a class="b w" href="${scheme}">عندي التطبيق وما انفتح؟ اضغط هنا</a>
<a class="b w" href="${STORE}">ما عندي التطبيق — حمّله مجانًا</a>
<small>دليل — بوصلة البر</small>
</main></body></html>`;
  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "max-age=300" } });
}
