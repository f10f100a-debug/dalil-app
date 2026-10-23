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

WHATS_NEW_13 = """جديد في هذا التحديث:
• تسجيل المسار يستمر والجوال مقفل، وتُضاف النقاط تلقائيًا عند فتحه.
• في غرفة الرحلة يبقى موقعك ظاهرًا لجماعتك حتى لو قفلت الجوال.
• رابط الدعوة يفتح الغرفة مباشرة في التطبيق مع الرقم والرمز جاهزين.
• صوت الغرفة أسرع، مع نغمة قبل الكلام وبعده مثل اللاسلكي.
• تنبيه لجماعتك عند الاستغاثة أو وصول رسالة صوتية."""
NOTES_13 = """

NEW IN 1.3 — background location (UIBackgroundModes: location):
- Used ONLY while the user is (a) recording a track (Map tab "الخريطة" -> "بدء تسجيل مسار جديد") or (b) inside a trip room. Uses the existing When-In-Use permission; no Always permission is requested. The blue location indicator is shown the whole time (showsBackgroundLocationIndicator).
- Track: points recorded while the phone is locked stay on the device and are added to the track when the app is opened again.
- Trip room: the member's position is relayed to the other room members over the room's private channel (about every 30 s, not stored). Stops immediately when the user stops recording or leaves the room.
- To test: create a trip room (any 4-digit PIN), lock the phone and walk; a second device in the same room sees the distance update.
- New URL scheme dalil://room?code=…&pin=… opens the join screen pre-filled (used by the invite link)."""
WHATS_NEW_14 = """جديد في هذا التحديث:
• لاسلكي حقيقي: رسائل غرفة الرحلة تشتغل بالصوت مباشرة والجوال مقفل، وترد من زر اللاسلكي في شاشة القفل.
• رابط الدعوة يفتح الغرفة في التطبيق مباشرة من واتساب.
• فتح أسرع للتطبيق حتى مع الشبكة الضعيفة، ويعمل بدون إنترنت بعد أول تشغيل.
• رادار الأمطار يتحدث تلقائيًا، وتنبيه إذا كان المطر قريبًا منك.
• تحسينات وإصلاحات."""
NOTES_14 = """

NEW IN 1.4 — Push to Talk (PushToTalk framework, UIBackgroundModes: push-to-talk):
- The trip room (غرفة الرحلة) is a real walkie-talkie for a travelling group. When the user enters a room, the app joins a PTChannel named after the room; leaving the room leaves the channel.
- Incoming voice messages from room members are delivered with a pushtotalk APNs push and played immediately while the phone is locked; the user can reply with the system Talk button. No other use of the channel.
- To test: create a room on device A (any 4-digit PIN), join it on device B with the room number + PIN, lock device B, hold "اضغط مطوّلًا وتكلّم" on A — B plays the message.
- Universal links: https://f10f100a-debug.github.io/dalil-app/?room=... opens the join screen in the app."""
WHATS_NEW_15 = """جديد في هذا التحديث:
• اللاسلكي أثبت: زر «تحدّث» في شاشة القفل ما يعلق ولا يفصل، والرسائل المتتالية تشتغل كلها.
• زر الكلام داخل التطبيق يبدأ فورًا بدون انتظار.
• علامة «سمعها»: تعرف مين سمع رسالتك الصوتية، حتى والجوال مقفل.
• روابط الدعوة القصيرة dalilbarr.com تفتح الغرفة في التطبيق مباشرة.
• تنبيه مطر أدق: يعرف هل المطر جاي عليك أو بيمر جنبك، وتنبيه البرق القريب.
• تحسينات وإصلاحات."""
NOTES_15 = """

NEW IN 1.5:
- Push to Talk reliability: the in-app talk button now transmits through PTChannelManager (requestBeginTransmitting/stopTransmitting) so the system owns the microphone; the audio session is kept .playAndRecord; the active remote participant is always cleared after playback (with a 20 s safety timeout).
- Read receipts for trip-room voice messages ("heard by").
- Universal links now also include applinks:dalilbarr.com (short invite links https://dalilbarr.com/r/<room>/<pin>, AASA served from that domain).
- To test: same as 1.4 — two devices in one room, lock device B, talk from A, then reply from B with the system Talk button."""
WHATS_NEW_16 = """جديد في هذا التحديث:
• اللاسلكي يشتغل حتى لو كان التطبيق مقفول: رسالة جماعتك الصوتية تشتغل مباشرة بدون ما تفتح التطبيق.
• زر الكلام داخل التطبيق يستخدم لاسلكي الآيفون دائمًا، فصار أثبت.
• تنبيه مطر أدق: يفرّق بين المطر الحقيقي والسحب اللي غالبًا ما ينزل منها شيء، ومنطقة التنبيهات تتحدد تلقائيًا من موقعك.
• سهم البوصلة أنعم وأسرع أثناء القيادة.
• تحسينات وإصلاحات."""
NOTES_16 = """

NEW IN 1.6:
- Push to Talk fix: when the app was terminated and the system relaunches it in the background for an incoming pushtotalk push, the app now plays the voice message itself (previously it assumed the app was in the foreground and played nothing).
- The audio session is configured as .playAndRecord in channelDescriptor(restoredChannelUUID:), and the voice file download starts immediately in incomingPushResult, as recommended in Apple Developer Forums for PushToTalk apps.
- UIBackgroundModes now includes "audio" (in addition to push-to-talk and location) so the received walkie-talkie message can finish playing while the phone is locked. Audio is only played for incoming trip-room voice messages.
- To test: same as 1.4/1.5 - two devices in one room; on device B swipe the app away (terminate it) and lock the phone; hold the talk button on device A - B plays the message without opening the app."""
# ما الجديد (كل اللغات الموجودة؛ العربية بالنص العربي والإنجليزية بملخص)
locs = asc.get(f"/v1/appStoreVersions/{vid}/appStoreVersionLocalizations")["data"]
for l in locs:
    loc = l["attributes"]["locale"]
    text = (WHATS_NEW_16 if VERSION.startswith("1.6") else WHATS_NEW_15 if VERSION.startswith("1.5") else WHATS_NEW_14 if VERSION.startswith("1.4") else WHATS_NEW_13 if VERSION.startswith("1.3") else WHATS_NEW_12 if VERSION.startswith("1.2") else WHATS_NEW) if loc.startswith("ar") else ("New: the walkie-talkie now plays your group's voice messages even when the app is closed, a steadier in-app talk button, more accurate rain alerts that tell real rain from clouds that will likely stay dry, alert region set automatically from your location, and a smoother compass arrow while driving." if VERSION.startswith("1.6") else "New: more reliable walkie-talkie (lock-screen Talk button no longer sticks or cuts out), instant in-app talk button, 'heard by' receipts for voice messages, short invite links that open the app, and smarter rain alerts that tell whether rain is heading to you or passing by, plus nearby-lightning warnings." if VERSION.startswith("1.5") else "New: real walkie-talkie — trip room voice plays on the lock screen and you can reply with the system Talk button; invite links open the app; faster launch on weak networks; auto-updating rain radar." if VERSION.startswith("1.4") else "New: track recording continues with the phone locked; your trip-room position stays visible to your group in the background; invite links open the room directly in the app; faster room voice with walkie-talkie tones." if VERSION.startswith("1.3") else "New: optional push alerts for rain, floods and events in your region; native compass that works instantly; high-resolution satellite imagery and 3D navigation with road routing; offline prayer times." if VERSION.startswith("1.2") else "New: Trip room — push-to-talk voice for your group (up to 15), members' live distance and direction, rally point, convoy alert and SOS. Also: live rain radar and lightning layers, and design improvements.")
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
base = (pa.get("notes") or "").split("\n\nNEW IN")[0]   # ملاحظات المراجع الأساسية بدون أقسام الإصدارات
attrs = {k: pa.get(k) for k in ["contactFirstName", "contactLastName", "contactPhone", "contactEmail", "demoAccountRequired"] if pa.get(k) is not None}
cur_notes = NOTES_16 if VERSION.startswith("1.6") else NOTES_15 if VERSION.startswith("1.5") else NOTES_14 if VERSION.startswith("1.4") else NOTES_13 if VERSION.startswith("1.3") else NOTES_12 if VERSION.startswith("1.2") else ""
older = [n for n in (NOTES_15, NOTES_14, NOTES_13, NOTES_12) if n != cur_notes]
attrs["notes"] = (base + cur_notes + "".join(older) + NOTES_11)[:4000]   # الإصدار الحالي أولًا حتى لا يُقص
rd = asc.get(f"/v1/appStoreVersions/{vid}/appStoreReviewDetail").get("data")
if rd:
    asc.note("Review notes", asc.patch(f"/v1/appStoreReviewDetails/{rd['id']}", {"data": {"type": "appStoreReviewDetails", "id": rd["id"], "attributes": attrs}}))
else:
    r = asc.post("/v1/appStoreReviewDetails", {"data": {"type": "appStoreReviewDetails", "attributes": attrs,
        "relationships": {"appStoreVersion": {"data": {"type": "appStoreVersions", "id": vid}}}}})
    asc.note("Review notes", "created" if "data" in r else r)
asc.note("Notes length", len(attrs["notes"]))
