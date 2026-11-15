// فحص محوّل الأندرويد (android/aac.js): يبني M4A من إطارات AAC حقيقية (ffmpeg) ويتأكد إن ffprobe يقرأه AAC
// ويفكّه بدون أخطاء — نفس صيغة رسائل الآيفون. يحتاج ffmpeg. exit 1 إذا فيه خلل.
const fs = require('fs'), vm = require('vm'), {execSync} = require('child_process'), os = require('os'), path = require('path');
const T = fs.mkdtempSync(path.join(os.tmpdir(), 'aac-'));
execSync(`ffmpeg -loglevel error -y -f lavfi -i "sine=frequency=440:duration=2.5:sample_rate=44100" -ac 1 -c:a aac -b:a 48k -f adts ${T}/t.aac`);
const MR = function(){}; MR.isTypeSupported = ()=>true;
const ctx = {MediaRecorder:MR, navigator:{userAgent:'x DalilAndroid/1.6'}, Uint8Array, Blob, Promise, setTimeout, Math, Array, Object, String}; ctx.window = ctx;
vm.createContext(ctx); vm.runInContext(fs.readFileSync(path.join(__dirname, '../../android/aac.js'), 'utf8'), ctx);
const a = fs.readFileSync(`${T}/t.aac`), frames = []; let i = 0;
while(i < a.length){ const len = ((a[i+3] & 3) << 11) | (a[i+4] << 3) | (a[i+5] >> 5); frames.push(new Uint8Array(a.subarray(i + ((a[i+1] & 1) ? 7 : 9), i + len))); i += len; }
fs.writeFileSync(`${T}/t.m4a`, ctx.__dalMuxM4a(frames, frames.map(()=>1024), [0x12, 0x08], 44100));
const info = execSync(`ffprobe -v error -show_entries stream=codec_name,sample_rate,channels,duration -of csv=p=0 ${T}/t.m4a`).toString().trim();
execSync(`ffmpeg -v error -xerror -i ${T}/t.m4a -f null -`);
const ok = /^aac,44100,1,2\.5/.test(info);
console.log((ok ? 'محوّل صوت الأندرويد: سليم — ' : 'محوّل صوت الأندرويد: خلل — ') + info);
process.exit(ok ? 0 : 1);
