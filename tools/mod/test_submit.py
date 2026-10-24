# اختبار مراجعة الذكاء الاصطناعي: يرفع صورتين حقيقيتين (سيل + صورة ما لها علاقة) عبر نفس مسار التطبيق
import json, urllib.request, urllib.parse, io, uuid, time
from PIL import Image
UA = {"User-Agent": "dalil-app-test/1.0 (dalilbarr.app@gmail.com)"}
def get(u): return urllib.request.urlopen(urllib.request.Request(u, headers=UA), timeout=60).read()
def commons(q):
    u = "https://commons.wikimedia.org/w/api.php?" + urllib.parse.urlencode({"action": "query", "format": "json", "generator": "search", "gsrsearch": q, "gsrnamespace": 6, "gsrlimit": 5, "prop": "imageinfo", "iiprop": "url|mime", "iiurlwidth": 1200})
    for p in json.loads(get(u))["query"]["pages"].values():
        ii = p["imageinfo"][0]
        if ii.get("mime") == "image/jpeg": return p["title"], ii["thumburl"]
def jpeg(img, w, q):
    im = img.convert("RGB"); im.thumbnail((w, w)); b = io.BytesIO(); im.save(b, "JPEG", quality=q); return b.getvalue(), im.size
def submit(title, url, kind, caption):
    img = Image.open(io.BytesIO(get(url)))
    photo, (w, h) = jpeg(img, 1080, 70); thumb, _ = jpeg(img, 420, 70)
    bd = uuid.uuid4().hex; parts = []
    def f(n, v): parts.append(f'--{bd}\r\nContent-Disposition: form-data; name="{n}"\r\n\r\n{v}\r\n'.encode())
    def fl(n, data): parts.append(f'--{bd}\r\nContent-Disposition: form-data; name="{n}"; filename="{n}.jpg"\r\nContent-Type: image/jpeg\r\n\r\n'.encode() + data + b"\r\n")
    fl("photo", photo); fl("thumb", thumb)
    for k, v in {"kind": kind, "caption": caption, "region": "الجوف", "nickname": "اختبار", "device": "ai-test", "w": w, "h": h}.items(): f(k, v)
    body = b"".join(parts) + f"--{bd}--\r\n".encode()
    r = urllib.request.urlopen(urllib.request.Request("https://penhpgvjtxytgyrhmetg.supabase.co/functions/v1/dalil-public?a=submit", data=body,
        headers={"content-type": "multipart/form-data; boundary=" + bd, "origin": "https://f10f100a-debug.github.io", **UA}), timeout=60)
    return json.loads(r.read())
out = []
for q, kind, cap in [("flash flood wadi Saudi Arabia", "flood", "سيل الوادي اليوم"), ("cheeseburger", "rain", "")]:
    t = commons(q); res = submit(t[0], t[1], kind, cap) if t else "no image"
    out.append(f"{q} | {t[0] if t else ''} | {res}"); time.sleep(2)
print("::notice::" + " || ".join(out))
