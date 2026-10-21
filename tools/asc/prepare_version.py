"""يجهّز إصدارًا جديدًا في App Store Connect دون إرساله للمراجعة:
ينشئ الإصدار، ويكتب «ما الجديد»، ويربط البناء، ويضيف ملاحظات المراجع. الإرسال يبقى بيد المطوّر."""
import os, sys, json, urllib.request, urllib.error
sys.path.insert(0, os.path.dirname(__file__))
os.environ.setdefault("NO_CHECK", "1")
import importlib.util
spec = importlib.util.spec_from_file_location("asc", os.path.join(os.path.dirname(__file__), "asc_common.py"))
asc = importlib.util.module_from_spec(spec); spec.loader.exec_module(asc)

VERSION = os.environ.get("VERSION", "").strip()
BUILD = os.environ.get("BUILD", "").strip()
WHATS_NEW_12 = """جديد في هذا التحديث:
• التنبيهات: تصلك تنبيهات الأمطار والسيول والأحداث في منطقتك مباشرة على جوالك (اختياري).
• البوصلة تعمل فور فتح التطبيق بدون أي خطوات، وأدق وأثبت من قبل، وتتجه للشمال الحقيقي.
• صور فضائية عالية الدقة، وعرض ثلاثي الأبعاد مع التوجيه للهدف بخط مستقيم أو عبر الطرق.
• أوقات الصلاة حسب موقعك (أم القرى) تعمل بدون إنترنت، والصلاة القادمة على البوصلة.
• زوايا البوصلة: السرعة واتجاه الهدف وبُعد السيارة بنظرة واحدة.
• تحسينات في التصميم وأسماء الخريطة أكبر وأوضح."""
NOTES_12 = """

NEW IN 1.2:
- Push notifications (optional): Settings tab -> "التنبيهات" -> enable and choose a region. Used only for rain/flood/event alerts in the chosen region; the user can turn them off any time.
- The compass now reads the device heading natively (Core Location heading) so no motion-permission prompt is needed.
- The trip room (from 1.1) is unchanged; see notes below."""
WHATS_NEW = """جديد: غرفة الرحلة
• تكلّم مع جماعتك بضغطة زر مثل اللاسلكي — حتى 15 شخصًا.
• شوف مواقعهم حولك وكم يبعدون واتجاههم، وتوجّه لأي واحد بالبوصلة.
• نقطة تجمّع يحددها أي عضو، وتنبيه إذا ابتعد أحد عن القافلة أكثر من 3 كم.
• زر استغاثة يرسل موقعك لكل أعضاء الغرفة فورًا.
• غرف خاصة برقم ورمز سري، تنتهي بعد 24 ساعة، والرسائل الصوتية تُحذف بعد ساعة.

وأيضًا: رادار الأمطار اللحظي من رادارات الأرصاد، وطبقة البرق، وتحسينات في التصميم."""
NOTES_11 = """

NEW IN THIS VERSION — Trip room (غرفة الرحلة), a private push-to-talk room for a travelling group:
- Compass tab -> scroll down -> "غرفة الرحلة" -> "إنشاء غرفة" (create): enter any name and a 4-digit PIN, tick the terms box, tap the gold button.
- Hold "اضغط مطوّلًا وتكلّم" to record a voice message (the microphone is used only while holding this button).
- To see a second member, open https://f10f100a-debug.github.io/dalil-app/?room=ROOMCODE in any desktop browser and join with the same PIN; both members then see each other's distance/direction, map markers, voice messages, the rally point and the SOS alert.
- Location is shared only with members of a room the user joined, only while the app is open, and is not stored on our server. Voice messages are deleted after 1 hour; rooms expire after 24 hours.
- Safeguards (Guideline 1.2): users accept zero-tolerance terms before joining (https://f10f100a-debug.github.io/dalil-app/support.html#room-terms); any member can mute another; a member muted by 3 members is removed automatically; any member can report another (the latest voice message is kept for review); reports are handled by the developer within 24 hours and offenders are banned from rooms."""

aid = asc.app_id()
vers = asc.get(f"/v1/apps/{aid}/appStoreVersions?filter[platform]=IOS&limit=10")["data"]
cur = next((v for v in vers if v["attributes"]["versionString"] == VERSION), None)
old = next((v for v in vers if v["attributes"]["versionString"] != VERSION), None)
if not cur:
    r = asc.post("/v1/appStoreVersions", {"data": {"type": "appStoreVersions",
        "attributes": {"platform": "IOS", "versionString": VERSION, "releaseType": "AFTER_APPROVAL"},
        "relationships": {"app": {"data": {"type": "apps", "id": aid}}}}})
    if "data" not in r: asc.note("Create version", r); sys.exit(1)
    cur = r["data"]; asc.note("Create version", f"created {VERSION} id={cur['id']}")
else:
    asc.note("Create version", f"exists {VERSION} state={cur['attributes'].get('appStoreState')}")
vid = cur["id"]

# ما الجديد (كل اللغات الموجودة؛ العربية بالنص العربي والإنجليزية بملخص)
locs = asc.get(f"/v1/appStoreVersions/{vid}/appStoreVersionLocalizations")["data"]
for l in locs:
    loc = l["attributes"]["locale"]
    text = (WHATS_NEW_12 if VERSION.startswith("1.2") else WHATS_NEW) if loc.startswith("ar") else ("New: optional push alerts for rain, floods and events in your region; native compass that works instantly; high-resolution satellite imagery and 3D navigation with road routing; offline prayer times." if VERSION.startswith("1.2") else "New: Trip room — push-to-talk voice for your group (up to 15), members' live distance and direction, rally point, convoy alert and SOS. Also: live rain radar and lightning layers, and design improvements.")
    asc.note("What's New " + loc, asc.patch(f"/v1/appStoreVersionLocalizations/{l['id']}", {"data": {"type": "appStoreVersionLocalizations", "id": l["id"], "attributes": {"whatsNew": text}}}))

# ربط البناء
if BUILD:
    bl = asc.get(f"/v1/builds?filter[app]={aid}&filter[version]={BUILD}&limit=5")["data"]
    b = next((x for x in bl if not x["attributes"].get("expired")), None)
    if b:
        asc.note("Attach build", f"{BUILD}: " + str(asc.patch(f"/v1/appStoreVersions/{vid}/relationships/build", {"data": {"type": "builds", "id": b["id"]}})))
    else:
        asc.note("Attach build", f"build {BUILD} not found")

# ملاحظات المراجع: ننسخ بيانات التواصل والملاحظات من الإصدار السابق ونضيف ملاحظات الإصدار الجديد
prev = asc.get(f"/v1/appStoreVersions/{old['id']}/appStoreReviewDetail").get("data") if old else None
pa = prev["attributes"] if prev else {}
base = (pa.get("notes") or "").split("\n\nNEW IN THIS VERSION")[0]
attrs = {k: pa.get(k) for k in ["contactFirstName", "contactLastName", "contactPhone", "contactEmail", "demoAccountRequired"] if pa.get(k) is not None}
attrs["notes"] = (base + (NOTES_12 if VERSION.startswith("1.2") else "") + NOTES_11)[:4000]
rd = asc.get(f"/v1/appStoreVersions/{vid}/appStoreReviewDetail").get("data")
if rd:
    asc.note("Review notes", asc.patch(f"/v1/appStoreReviewDetails/{rd['id']}", {"data": {"type": "appStoreReviewDetails", "id": rd["id"], "attributes": attrs}}))
else:
    r = asc.post("/v1/appStoreReviewDetails", {"data": {"type": "appStoreReviewDetails", "attributes": attrs,
        "relationships": {"appStoreVersion": {"data": {"type": "appStoreVersions", "id": vid}}}}})
    asc.note("Review notes", "created" if "data" in r else r)
asc.note("Notes length", len(attrs["notes"]))
