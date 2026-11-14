// خط الخريطة الجديد (14 نوفمبر): يحوّل خط TTF لملفات حروف الخريطة (glyphs PBF) ويدمجه مع Noto Sans الحالي كاحتياط
//   node tools/fonts/build_glyphs.js kufi.ttf "Dalil Kufi"
const fontnik = require('fontnik'), fs = require('fs'), path = require('path'), util = require('util');
const range = util.promisify(fontnik.range), composite = util.promisify(fontnik.composite);
const [ttf, name] = process.argv.slice(2);
const font = fs.readFileSync(ttf), out = path.join('vendor/glyphs', name), fb = 'vendor/glyphs/Noto Sans Regular';
fs.mkdirSync(out, {recursive: true});
(async()=>{
  let n = 0;
  for(let s = 0; s < 65536; s += 256){
    const e = s + 255, f = `${s}-${e}.pbf`;
    const k = await range({font, start: s, end: e});
    const bufs = [k]; if(fs.existsSync(path.join(fb, f))) bufs.push(fs.readFileSync(path.join(fb, f)));
    // نكتب بس النطاقات اللي فيها حروف (من الخط الجديد أو الاحتياطي)
    if(k.length < 40 && bufs.length === 1) continue;
    const c = bufs.length > 1 ? await composite(bufs) : k;
    fs.writeFileSync(path.join(out, f), c); n++;
  }
  console.log('ranges', n);
})();
