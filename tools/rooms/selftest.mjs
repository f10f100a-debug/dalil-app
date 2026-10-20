// اختبار شامل لدالة dalil-rooms: إنشاء، دخول، حالة، نقطة تجمع، صوت، كتم/طرد، بلاغ، خروج.
// node tools/rooms/selftest.mjs  — يطبع النتائج كتنبيهات GitHub.
const U = "https://penhpgvjtxytgyrhmetg.supabase.co/functions/v1/dalil-rooms";
const K = "sb_publishable_WUbfRD9na71sHZ1rxFwImQ_JGzDOyXw";
const H = { apikey: K, "content-type": "application/json", origin: "https://f10f100a-debug.github.io" };
let fails = 0;
const ok = (c, msg) => { if (c) console.log(`::notice::✓ ${msg}`); else { fails++; console.log(`::error::✗ ${msg}`); } };
async function call(a, body) {
  const r = await fetch(`${U}?a=${a}`, { method: "POST", headers: H, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  return { status: r.status, ...j };
}
const auth = (m) => ({ room_id: m.room_id, member_id: m.me.member_id, token: m.token });

const A = await call("create", { name: "اختبار", pin: "4321", member_name: "أحمد" });
ok(A.ok && /^\d{6}$/.test(A.code) && A.secret && A.token, `create ${A.status} code=${A.code} ${A.error || ""}`);
const bad = await call("join", { code: A.code, pin: "0000", member_name: "س" });
ok(bad.status === 403, `wrong pin rejected ${bad.status}`);
const B = await call("join", { code: A.code, pin: "4321", member_name: "بدر" });
const C = await call("join", { code: A.code, pin: "4321", member_name: "خالد" });
const D = await call("join", { code: A.code, pin: "4321", member_name: "مزعج" });
ok(B.ok && C.ok && D.ok && D.members.length === 4 && B.me.color !== A.me.color, `join x3 members=${D.members?.length}`);
const st = await call("state", auth(A));
ok(st.ok && st.members.length === 4 && st.secret === A.secret, `state members=${st.members?.length}`);
const ral = await call("rally", { ...auth(B), lat: 24.71234567, lng: 46.6753, label: "عند الطلح" });
ok(ral.ok && ral.rally.lat === 24.71235 && ral.rally.by === "بدر", `rally ${JSON.stringify(ral.rally)}`);

// صوت: ملف m4a وهمي صغير (الخادم لا يفك الترميز)
const fd = new FormData();
fd.append("room_id", A.room_id); fd.append("member_id", A.me.member_id); fd.append("token", A.token); fd.append("duration", "2.5");
fd.append("audio", new Blob([new Uint8Array(4000).fill(7)], { type: "audio/mp4" }), "v.m4a");
const vr = await fetch(`${U}?a=voice`, { method: "POST", headers: { apikey: K, origin: H.origin }, body: fd });
const v = await vr.json().catch(() => ({}));
ok(v.ok && v.voice?.url, `voice upload ${vr.status} ${v.error || ""}`);
if (v.voice?.url) { const g = await fetch(v.voice.url); ok(g.ok && (await g.arrayBuffer()).byteLength === 4000, `voice signed url fetch ${g.status}`); }
const st2 = await call("state", auth(C));
ok(st2.voice?.length === 1 && st2.rally?.label === "عند الطلح", `state sees voice=${st2.voice?.length} rally`);

const tokBad = await call("state", { ...auth(A), token: "x" + A.token });
ok(tokBad.status === 403, `bad token rejected ${tokBad.status}`);

const m1 = await call("mute", { ...auth(A), target: D.me.member_id });
const m2 = await call("mute", { ...auth(B), target: D.me.member_id });
ok(m1.ok && !m1.kicked && m2.ok && !m2.kicked && m2.votes === 2 && m2.need === 3, `mute votes ${m2.votes}/${m2.need}`);
const m3 = await call("mute", { ...auth(C), target: D.me.member_id });
ok(m3.kicked && m3.secret && m3.secret !== A.secret, `third mute kicks, secret rotated`);
const kd = await call("state", auth(D));
ok(kd.status === 403 && kd.error === "kicked", `kicked member blocked ${kd.status} ${kd.error}`);
const st3 = await call("state", auth(A));
ok(st3.members.length === 3 && st3.secret === m3.secret, `after kick members=${st3.members?.length}`);

// Realtime: B يرسل موقعًا وC يستقبله على القناة السرية
const WS = "wss://penhpgvjtxytgyrhmetg.supabase.co/realtime/v1/websocket?apikey=" + K + "&vsn=1.0.0";
function sock(topic) {
  return new Promise((res, rej) => {
    const ws = new WebSocket(WS), got = [];
    const t = setTimeout(() => rej(new Error("join timeout")), 10000);
    ws.onopen = () => ws.send(JSON.stringify({ topic, event: "phx_join", ref: "1", join_ref: "1", payload: { config: { broadcast: { self: false, ack: false }, presence: { key: "", enabled: false }, postgres_changes: [], private: false } } }));
    ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.event === "phx_reply" && m.ref === "1") { clearTimeout(t); m.payload.status === "ok" ? res({ ws, got }) : rej(new Error(JSON.stringify(m.payload))); } else if (m.event === "broadcast") got.push(m.payload); };
    ws.onerror = () => rej(new Error("ws error"));
  });
}
try {
  const topic = "realtime:room:" + st3.secret;
  const [b, c] = await Promise.all([sock(topic), sock(topic)]);
  b.ws.send(JSON.stringify({ topic, event: "broadcast", ref: "2", join_ref: "1", payload: { type: "broadcast", event: "pos", payload: { m: B.me.member_id, lat: 27.5, lng: 41.7 } } }));
  await new Promise((r) => setTimeout(r, 2500));
  ok(c.got.some((p) => p.event === "pos" && p.payload.lat === 27.5), `realtime broadcast received=${c.got.length}`);
  b.ws.close(); c.ws.close();
} catch (e) { ok(false, "realtime " + e.message); }

for (const m of [A, B, C]) await call("leave", auth(m));
const after = await call("state", auth(A));
ok(after.status === 403, `left member blocked ${after.status}`);
console.log(`::notice::ROOM_ID=${A.room_id} fails=${fails}`);
process.exit(fails ? 1 : 0);
