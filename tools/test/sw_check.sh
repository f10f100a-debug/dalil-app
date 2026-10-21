#!/bin/bash
# يتأكد أن النسخة المنشورة محدّثة وأن كل ملفات sw.js موجودة (لو فشل ملف واحد ما يتحدّث التطبيق عند المستخدمين)
B=https://f10f100a-debug.github.io/dalil-app/
curl -s "$B/sw.js?x=$RANDOM" -o sw.js; echo "live: $(head -c 60 sw.js)"
python3 - <<'PY'
import re,urllib.request
s=open('sw.js').read()
items=re.findall(r"'(\./[^']*)'",s)+re.findall(r'"(\./[^"]*)"',s)
bad=[]
for it in sorted(set(items)):
    u='https://f10f100a-debug.github.io/dalil-app/'+it[2:]
    try:
        r=urllib.request.urlopen(urllib.request.Request(u,method='HEAD'),timeout=20)
        if r.status!=200: bad.append((it,r.status))
    except Exception as e: bad.append((it,str(e)[:40]))
print('shell files',len(set(items)),'missing',bad)
PY
