// مراجعة صور «الأحداث» بالذكاء الاصطناعي: يُستدعى من قاعدة البيانات أول ما ينرفع حدث (مشغّل events_ai_mod).
// ينشر الواضح والسليم تلقائيًا، يرفض المخالف وغير المتعلق، ويترك المشكوك فيه للمراجعة البشرية.
// يشتغل فقط إذا ANTHROPIC_API_KEY موجود و app_config ai_mod ≠ off. حد 400 مراجعة باليوم.
import { db, KINDS } from "../_shared/common.ts";

const LIVE_DAYS = 3, DAY_MAX = 400;
const SYSTEM = `أنت مشرف محتوى لقسم «الأحداث» في تطبيق «دليل» للبر والرحلات في السعودية. الناس يرفعون صورًا (أو أول لقطة من فيديو) عن: rain مطر، flood سيل أو جريان أودية أو غدران، spring ربيع وعشب وزهور برية، dust غبار وعواصف رملية، road حالة طريق بري أو طريق مقطوع أو تحويلة، other حدث بري آخر مفيد (مثل برد، ضباب، قوس قزح، شلال).
قرّر واحد من ثلاثة:
- approve: صورة حقيقية خارجية واضحة لواحد من المواضيع أعلاه، والتعليق (إن وجد) سليم. الناس أو السيارات في الصورة عادي إذا كانوا جزءًا من المشهد مو الموضوع الرئيسي.
- reject: محتوى غير لائق أو عري أو عنف أو دم أو إساءة أو رموز كراهية؛ إعلان أو ترويج أو رقم جوال أو رابط أو حساب تواصل في الصورة أو التعليق؛ تعليق فيه ألفاظ مسيئة أو سياسة؛ صورة ما لها علاقة (سيلفي، داخل بيت أو سيارة بدون مشهد الطقس، لقطة شاشة، ميم، صورة منتج، أكل، مستند، صورة منقولة عليها شعار قناة أو علامة مائية).
- review: أي شك؛ وجه شخص قريب وواضح هو موضوع الصورة؛ حادث فيه مصابين؛ لوحة سيارة مقروءة بوضوح؛ صورة ليلية أو مظلمة ما تبان؛ لا تقدر تتأكد إنها حقيقية وحديثة.
أعد JSON فقط بدون أي نص آخر: {"verdict":"approve|reject|review","kind":"rain|flood|spring|dust|road|other","reason":"سبب قصير بالعربي (أقل من 12 كلمة)"}. kind = أنسب نوع للصورة نفسها حتى لو اختار المستخدم غيره.`;

Deno.serve(async (req) => {
  const sb = db();
  try {
    const { data: keyRow } = await sb.from("private_config").select("value").eq("key", "cron_key").maybeSingle();
    if (!keyRow?.value || req.headers.get("x-cron-key") !== keyRow.value) return Response.json({ error: "forbidden" }, { status: 403 });
    const key = Deno.env.get("ANTHROPIC_API_KEY") || "";
    const { data: sw } = await sb.from("app_config").select("value").eq("key", "ai_mod").maybeSingle();
    if (!key || sw?.value === "off") return Response.json({ ok: true, off: true });
    const { id } = await req.json().catch(() => ({ id: "" }));
    if (!/^[0-9a-f-]{36}$/.test(String(id))) return Response.json({ error: "bad_id" }, { status: 400 });
    const { data: ev } = await sb.from("events").select("*").eq("id", id).maybeSingle();
    if (!ev || ev.status !== "pending" || ev.ai_verdict) return Response.json({ ok: true, skip: true });
    const dayAgo = new Date(Date.now() - 86400e3).toISOString();
    const { count } = await sb.from("events").select("id", { count: "exact", head: true }).gte("ai_at", dayAgo);
    if ((count ?? 0) >= DAY_MAX) return Response.json({ ok: true, cap: true });

    const dl = await sb.storage.from("pending").download(ev.photo_path);
    if (dl.error) throw dl.error;
    const img = new Uint8Array(await dl.data.arrayBuffer());
    let b64 = ""; for (let i = 0; i < img.length; i += 0x8000) b64 += String.fromCharCode(...img.subarray(i, i + 0x8000));
    b64 = btoa(b64);
    const facts = `نوع الحدث اللي اختاره المستخدم: ${ev.kind}\nالمنطقة: ${ev.region || "—"}\nالتعليق: ${ev.caption || "—"}\nالاسم المعروض: ${ev.nickname || "—"}${ev.video_path ? "\n(هذي أول لقطة من فيديو)" : ""}`;
    const r = await fetch("https://api.anthropic.com/v1/messages", { method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: Deno.env.get("MOD_MODEL") || "claude-haiku-5-5", max_tokens: 300, thinking: { type: "disabled" }, system: SYSTEM,
        messages: [{ role: "user", content: [{ type: "image", source: { type: "base64", media_type: "image/jpeg", data: b64 } }, { type: "text", text: facts }] }] }) });
    if (!r.ok) { console.error("anthropic", r.status, (await r.text()).slice(0, 200)); return Response.json({ ok: false, error: "ai" }, { status: 502 }); }
    const j = await r.json();
    const txt = (j.content || []).filter((c: { type: string }) => c.type === "text").map((c: { text: string }) => c.text).join("");
    let out: { verdict?: string; kind?: string; reason?: string } = {};
    try { out = JSON.parse((txt.match(/\{[\s\S]*\}/) || ["{}"])[0]); } catch { /* يبقى للمراجعة */ }
    const verdict = ["approve", "reject", "review"].includes(String(out.verdict)) ? String(out.verdict) : "review";
    const kind = KINDS.includes(String(out.kind)) ? String(out.kind) : ev.kind;
    const reason = String(out.reason || "").replace(/\s+/g, " ").slice(0, 120);
    const ai = { ai_verdict: verdict, ai_reason: reason, ai_kind: kind, ai_at: new Date().toISOString() };

    if (verdict === "approve") {
      const files = [ev.photo_path, ev.thumb_path, ...(ev.video_path ? [ev.video_path] : [])];
      for (const p of files) {
        const type = p.endsWith(".mp4") ? "video/mp4" : "image/jpeg";
        let bytes: Uint8Array = img;
        if (p !== ev.photo_path) { const d = await sb.storage.from("pending").download(p); if (d.error || !d.data) throw d.error || new Error("download"); bytes = new Uint8Array(await d.data.arrayBuffer()); }
        const up = await sb.storage.from("events").upload(p, bytes, { contentType: type, cacheControl: "3600", upsert: true });
        if (up.error) throw up.error;
      }
      const now = new Date();
      // نتأكد إنها ما زالت معلّقة (ما راجعها مشرف بنفس اللحظة)
      const { data: upd, error } = await sb.from("events").update({ ...ai, kind, status: "approved", approved_at: now.toISOString(),
        expires_at: new Date(now.getTime() + LIVE_DAYS * 86400e3).toISOString() }).eq("id", id).eq("status", "pending").select("id");
      if (error) throw error;
      if (upd?.length) await sb.storage.from("pending").remove(files);
      else await sb.storage.from("events").remove(files);
    } else if (verdict === "reject") {
      // تبقى 24 ساعة كـ«رفضها الذكاء الاصطناعي» في لوحة الإدارة، وتنحذف تلقائيًا بعدها (cleanup)
      await sb.from("events").update({ ...ai, status: "rejected" }).eq("id", id).eq("status", "pending");
    } else {
      await sb.from("events").update(ai).eq("id", id).eq("status", "pending");
    }
    return Response.json({ ok: true, verdict, kind, reason });
  } catch (e) {
    console.error("dalil-mod", e);
    return Response.json({ ok: false, error: String((e as Error)?.message || e).slice(0, 200) }, { status: 500 });
  }
});
