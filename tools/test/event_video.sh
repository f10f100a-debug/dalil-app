#!/bin/bash
# اختبار رفع حدث بفيديو إلى dalil-public ثم وضعه «مرفوض» حتى يُحذف تلقائيًا
FN=https://penhpgvjtxytgyrhmetg.supabase.co/functions/v1
KEY=sb_publishable_WUbfRD9na71sHZ1rxFwImQ_JGzDOyXw
cd "$(dirname "$0")"
echo "submit: $(curl -s -H "apikey: $KEY" -F photo=@frame.jpg\;type=image/jpeg -F thumb=@frame.jpg\;type=image/jpeg -F video=@clip.mp4\;type=video/mp4 -F vdur=3 -F kind=other -F caption=TEST-VIDEO-CI -F device=ci "$FN/dalil-public?a=submit")"
echo "bad video: $(curl -s -H "apikey: $KEY" -F photo=@frame.jpg\;type=image/jpeg -F thumb=@frame.jpg\;type=image/jpeg -F video=@frame.jpg\;type=video/mp4 -F vdur=3 -F kind=other "$FN/dalil-public?a=submit")"
echo "admin alive: $(curl -s -H "apikey: $KEY" -H 'content-type: application/json' -d '{"user":"citest","pass":"x","action":"ping"}' "$FN/dalil-admin")"
echo "err report: $(curl -s -H 'content-type: text/plain' -d '{"msg":"CI test error","src":"ci:1","ver":"ci","page":"ci"}' "$FN/dalil-public?a=err")"
