# آيفون 1.11 (19 نوفمبر): ملفات المسار GPX تفتح في دليل، ونافذة التقييم من آبل.
# يشتغل بعد خطوة «Background location + links» (يحتاج DalilBg موجود في AppDelegate.swift). من مجلد native.
import plistlib, re, sys
P = "ios/App/App/Info.plist"
with open(P, "rb") as f: pl = plistlib.load(f)
pl["CFBundleDocumentTypes"] = [{
    "CFBundleTypeName": "GPX", "CFBundleTypeRole": "Viewer", "LSHandlerRank": "Alternate",
    "LSItemContentTypes": ["com.topografix.gpx"]}]
pl["UTImportedTypeDeclarations"] = [{
    "UTTypeIdentifier": "com.topografix.gpx", "UTTypeDescription": "GPS Exchange Format (GPX)",
    "UTTypeConformsTo": ["public.xml", "public.data"],
    "UTTypeTagSpecification": {"public.filename-extension": ["gpx", "GPX"], "public.mime-type": ["application/gpx+xml"]}}]
pl["LSSupportsOpeningDocumentsInPlace"] = False
with open(P, "wb") as f: plistlib.dump(pl, f)

A = "ios/App/App/AppDelegate.swift"
s = open(A).read()
ok = []
if "import StoreKit" not in s:
    s = s.replace("import UIKit", "import UIKit\nimport StoreKit", 1); ok.append("storekit")
k = s.find("final class DalilBg")
if k < 0: sys.exit("::error::DalilBg missing")
old = "func openURL(_ url: URL) { pendingURL = url.absoluteString }"
new = """private var pendingFile: [String]?
    func openURL(_ url: URL) {
        // 1.11: ملف مسار (GPX) من واتساب/الملفات/الإيميل — نقراه هنا ونعطيه للصفحة (الصفحة ما تقدر تقرا file://)
        if url.isFileURL {
            let sec = url.startAccessingSecurityScopedResource()
            defer { if sec { url.stopAccessingSecurityScopedResource() } }
            if let d = try? Data(contentsOf: url), d.count < 20_000_000,
               let t = String(data: d, encoding: .utf8) ?? String(data: d, encoding: .isoLatin1) {
                pendingFile = [url.lastPathComponent, t]
            }
            if url.path.contains("/Inbox/") { try? FileManager.default.removeItem(at: url) }
            return
        }
        pendingURL = url.absoluteString
    }"""
if old in s: s = s.replace(old, new, 1); ok.append("openFile")
anchor = 'if !attached { attached = true; w.configuration.userContentController.add(self, name: "dalil") }'
j = s.find(anchor, k)
if j >= 0:
    e = j + len(anchor)
    s = s[:e] + """
            if let f = pendingFile, UIApplication.shared.applicationState == .active,
               let d = try? JSONSerialization.data(withJSONObject: f), let a = String(data: d, encoding: .utf8) {
                w.evaluateJavaScript("window.__dalilOpenFile ? window.__dalilOpenFile.apply(null," + a + ") : false") { r, _ in
                    if (r as? Bool) == true { self.pendingFile = nil }
                }
            }""" + s[e:]; ok.append("deliverFile")
m = re.search(r'let cmd = b\["cmd"\] as\? String else \{ return \}', s[k:])
if m:
    e = k + m.end()
    s = s[:e] + """
        // 1.11: نافذة «قيّم دليل» الرسمية من آبل (هي اللي تقرر تطلعها أو لا — بحد أقصى 3 مرات بالسنة)
        if cmd == "review" {
            DispatchQueue.main.async {
                if let sc = UIApplication.shared.connectedScenes.first(where: { $0.activationState == .foregroundActive }) as? UIWindowScene {
                    SKStoreReviewController.requestReview(in: sc)
                }
            }
            return
        }""" + s[e:]; ok.append("review")
open(A, "w").write(s)
need = {"storekit", "openFile", "deliverFile", "review"}
miss = need - set(ok) - ({"storekit"} if "import StoreKit" in s else set())
print("::notice::1.11 patch: " + ",".join(ok) + ("" if not miss else " MISSING " + ",".join(miss)))
if miss: sys.exit(1)
