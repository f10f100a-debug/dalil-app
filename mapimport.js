// دليل — تحويل الخرائط الخارجية إلى PMTiles على جوال المستخدم (لا يُرفع شيء لأي خادم).
// يدعم: MBTiles، GeoTIFF، صور معايرة (OziExplorer ‎.map، ملفات العالم ‎.jgw/.pgw/.tfw مع ‎.prj)،
// وطبقات الصور في KML/KMZ (GroundOverlay، ومنها خرائط Garmin المخصصة).
// الناتج ملف PMTiles واحد يُحفظ في ذاكرة الجهاز ويظهر في لوحة طبقات الخريطة ويعمل بلا إنترنت.
(function(){
'use strict';
const D2R = Math.PI / 180, R2D = 180 / Math.PI;
const fail = msg=>{ const e = new Error(msg); e.userMessage = msg; return e; };
const loadScript = src=>new Promise((res, rej)=>{ const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = ()=>rej(fail('تعذّر تحميل أداة التحويل؛ تأكد من الاتصال مرة واحدة ثم أعد المحاولة')); document.head.appendChild(s); });
let sqlP = null, tiffP = null;
const loadSql = ()=>sqlP || (sqlP = loadScript('vendor/sql-wasm.js').then(()=>window.initSqlJs({locateFile:f=>'vendor/' + f})).catch(e=>{ sqlP = null; throw e; }));
const loadTiff = ()=>tiffP || (tiffP = loadScript('vendor/geotiff.js').then(()=>window.GeoTIFF).catch(e=>{ tiffP = null; throw e; }));

// ---------- كاتب PMTiles v3 ----------
function pushVarint(o, n){ while(n >= 128){ o.push((n % 128) | 128); n = Math.floor(n / 128); } o.push(n); }
function serializeDir(es){
  const o = []; pushVarint(o, es.length);
  let last = 0; for(const e of es){ pushVarint(o, e.tileId - last); last = e.tileId; }
  for(const e of es) pushVarint(o, e.runLength);
  for(const e of es) pushVarint(o, e.length);
  es.forEach((e, i)=>pushVarint(o, i > 0 && e.offset === es[i - 1].offset + es[i - 1].length ? 0 : e.offset + 1));
  return new Uint8Array(o);
}
// الأدلة تُضغط gzip (المعتاد في PMTiles وتقرؤه كل الأدوات)، وبدون ضغط إن لم يدعمه المتصفح
const GZ = typeof CompressionStream !== 'undefined';
const gzip = async u=>GZ ? new Uint8Array(await new Response(new Blob([u]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer()) : u;
async function buildDirs(es){
  const MAX = 16384 - 127;
  let root = await gzip(serializeDir(es));
  if(root.length <= MAX) return {root, leaves:new Uint8Array(0)};
  for(let size = 4096; ; size *= 2){
    const rootEs = [], parts = []; let off = 0;
    for(let i = 0; i < es.length; i += size){
      const leaf = await gzip(serializeDir(es.slice(i, i + size)));
      rootEs.push({tileId:es[i].tileId, offset:off, length:leaf.length, runLength:0});
      parts.push(leaf); off += leaf.length;
    }
    root = await gzip(serializeDir(rootEs));
    if(root.length <= MAX){ const leaves = new Uint8Array(off); let p = 0; for(const x of parts){ leaves.set(x, p); p += x.length; } return {root, leaves}; }
  }
}
// tiles: [{z,x,y,data:Blob|Uint8Array}] — o: {tileType 1=mvt 2=png 3=jpg 4=webp, tileCompression 1=none 2=gzip, minZoom, maxZoom, bounds, meta}
async function writePmtiles(tiles, o){
  const Z = window.pmtiles.zxyToTileId;
  for(const t of tiles) t.id = Z(t.z, t.x, t.y);
  tiles.sort((a, b)=>a.id - b.id);
  const es = []; let off = 0;
  for(const t of tiles){
    const len = t.data.size != null ? t.data.size : t.data.byteLength;
    if(es.length && es[es.length - 1].tileId === t.id) continue;
    es.push({tileId:t.id, offset:off, length:len, runLength:1}); off += len; t.keep = true;
  }
  const {root, leaves} = await buildDirs(es), meta = await gzip(new TextEncoder().encode(JSON.stringify(o.meta || {})));
  const h = new ArrayBuffer(127), dv = new DataView(h), u = new Uint8Array(h);
  u.set([0x50, 0x4D, 0x54, 0x69, 0x6C, 0x65, 0x73], 0); u[7] = 3;
  const rootOff = 127, metaOff = rootOff + root.length, leafOff = metaOff + meta.length, dataOff = leafOff + leaves.length;
  const set64 = (p, v)=>{ dv.setUint32(p, v % 4294967296, true); dv.setUint32(p + 4, Math.floor(v / 4294967296), true); };
  set64(8, rootOff); set64(16, root.length); set64(24, metaOff); set64(32, meta.length); set64(40, leafOff); set64(48, leaves.length);
  set64(56, dataOff); set64(64, off); set64(72, es.length); set64(80, es.length); set64(88, es.length);
  u[96] = 1; u[97] = GZ ? 2 : 1; u[98] = o.tileCompression || 1; u[99] = o.tileType; u[100] = o.minZoom; u[101] = o.maxZoom;
  const b = o.bounds, e7 = v=>Math.round(v * 1e7);
  dv.setInt32(102, e7(b[0]), true); dv.setInt32(106, e7(b[1]), true); dv.setInt32(110, e7(b[2]), true); dv.setInt32(114, e7(b[3]), true);
  u[118] = o.minZoom; dv.setInt32(119, e7((b[0] + b[2]) / 2), true); dv.setInt32(123, e7((b[1] + b[3]) / 2), true);
  return new Blob([h, root, meta, leaves, ...tiles.filter(t=>t.keep).map(t=>t.data)], {type:'application/octet-stream'});
}

// ---------- MBTiles ← SQLite ----------
async function fromMbtiles(file, progress){
  if(file.size > 450 * 1048576) throw fail('ملف MBTiles أكبر من 450 MB؛ قسّمه أو حوّله إلى PMTiles على الكمبيوتر');
  progress && progress(0, 'قراءة MBTiles');
  const SQL = await loadSql();
  let db;
  try{ db = new SQL.Database(new Uint8Array(await file.arrayBuffer())); }catch(e){ throw fail('ملف MBTiles تالف أو أكبر من ذاكرة الجوال'); }
  try{
    const meta = {};
    try{ const r = db.exec('SELECT name, value FROM metadata'); if(r[0]) for(const [k, v] of r[0].values) meta[k] = v; }catch(e){}
    let total = 0; try{ total = db.exec('SELECT count(*) FROM tiles')[0].values[0][0]; }catch(e){ throw fail('الملف ليس MBTiles (لا يحوي جدول tiles)'); }
    if(!total) throw fail('ملف MBTiles فارغ');
    const st = db.prepare('SELECT zoom_level, tile_column, tile_row, tile_data FROM tiles');
    const tiles = []; let minZ = 99, maxZ = 0, first = null, n = 0;
    while(st.step()){
      const [z, x, row, d] = st.get();
      n++; if(n % 500 === 0){ progress && progress(n / total, 'تحويل البلاطات'); await new Promise(r=>setTimeout(r)); }
      if(!d || !d.length) continue;
      if(!first) first = d;
      tiles.push({z, x, y:Math.pow(2, z) - 1 - row, data:new Blob([d])});
      if(z < minZ) minZ = z; if(z > maxZ) maxZ = z;
    }
    st.free();
    if(!tiles.length) throw fail('ملف MBTiles فارغ');
    const fmt = String(meta.format || '').toLowerCase();
    const sig = first[0] === 0x89 && first[1] === 0x50 ? 'png' : first[0] === 0xFF && first[1] === 0xD8 ? 'jpg' : first[0] === 0x52 && first[1] === 0x49 ? 'webp' : '';
    const kind = sig || (/png/.test(fmt) ? 'png' : /jpe?g/.test(fmt) ? 'jpg' : /webp/.test(fmt) ? 'webp' : 'pbf');
    const tileType = {pbf:1, png:2, jpg:3, webp:4}[kind];
    const gz = kind === 'pbf' && first[0] === 0x1F && first[1] === 0x8B;
    let bounds = String(meta.bounds || '').split(',').map(Number);
    if(bounds.length !== 4 || bounds.some(v=>!Number.isFinite(v))){
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for(const t of tiles) if(t.z === maxZ){ x0 = Math.min(x0, t.x); x1 = Math.max(x1, t.x); y0 = Math.min(y0, t.y); y1 = Math.max(y1, t.y); }
      bounds = [tileLng(x0, maxZ), tileLat(y1 + 1, maxZ), tileLng(x1 + 1, maxZ), tileLat(y0, maxZ)];
    }
    let vector_layers = [];
    try{ vector_layers = JSON.parse(meta.json || '{}').vector_layers || []; }catch(e){}
    progress && progress(1, 'حفظ');
    return {blob:await writePmtiles(tiles, {tileType, tileCompression:gz ? 2 : 1, minZoom:minZ, maxZoom:maxZ, bounds,
      meta:{name:meta.name || '', format:kind, vector_layers, attribution:meta.attribution || '', overlay:meta.type === 'overlay' || hasAlpha(first)}}), name:meta.name || ''};
  }finally{ db.close(); }
}

// صورة PNG فيها شفافية (طبقة أسماء/حدود فوق الخريطة) أم خريطة أساس معتمة
function hasAlpha(d){
  if(!(d && d[0] === 0x89 && d[1] === 0x50)) return false;
  const ct = d[25]; if(ct === 4 || ct === 6) return true;
  for(let i = 33; i < Math.min(d.length - 4, 4096); i++) if(d[i] === 0x74 && d[i + 1] === 0x52 && d[i + 2] === 0x4E && d[i + 3] === 0x53) return true;
  return false;
}
// ---------- OsmAnd ‎.sqlitedb (بلاطات صور في SQLite) ----------
async function fromSqlitedb(file, progress){
  if(file.size > 450 * 1048576) throw fail('ملف ‎.sqlitedb أكبر من 450 MB؛ قسّمه على الكمبيوتر');
  progress && progress(0, 'قراءة خريطة OsmAnd');
  const SQL = await loadSql();
  let db;
  try{ db = new SQL.Database(new Uint8Array(await file.arrayBuffer())); }catch(e){ throw fail('ملف ‎.sqlitedb تالف أو أكبر من ذاكرة الجوال'); }
  try{
    const info = {};
    try{ const r = db.exec('SELECT * FROM info LIMIT 1'); if(r[0]) r[0].columns.forEach((c, i)=>{ info[c.toLowerCase()] = r[0].values[0][i]; }); }catch(e){}
    let total = 0, zr;
    try{ total = db.exec('SELECT count(*) FROM tiles')[0].values[0][0]; zr = db.exec('SELECT z, max(x), max(y) FROM tiles GROUP BY z')[0]; }catch(e){ throw fail('الملف ليس خريطة بلاطات من OsmAnd'); }
    if(!total || !zr) throw fail('خريطة OsmAnd فارغة');
    // ترقيم BigPlanet يخزّن 17 − التكبير؛ نتحقق أي التفسيرين يطابق أرقام البلاطات
    const fits = f=>zr.values.every(([z, mx, my])=>{ const zz = f(z); return zz >= 0 && zz <= 24 && mx < Math.pow(2, zz) && my < Math.pow(2, zz); });
    const tn = String(info.tilenumbering || '').toLowerCase();
    // بلا عمود tilenumbering يفترض OsmAnd ترقيم BigPlanet؛ وعند التعارض نفضّل ما يقع في جزيرة العرب
    const inArabia = f=>zr.values.some(([z, mx, my])=>{ const zz = f(z); const lng = tileLng(mx, zz), lat = tileLat(my, zz); return lng > 30 && lng < 62 && lat > 8 && lat < 36; });
    const fb = fits(z=>17 - z), fd = fits(z=>z);
    const big = tn === 'bigplanet' ? true : tn ? false : fb && !fd ? true : fd && !fb ? false : inArabia(z=>z) && !inArabia(z=>17 - z) ? false : true;
    const zoomOf = z=>big ? 17 - z : z, inv = Number(info.inverted_y || info.invertedy || 0) === 1;
    const st = db.prepare('SELECT x, y, z, image FROM tiles');
    const tiles = []; let minZ = 99, maxZ = 0, n = 0, first = null, alpha = false;
    while(st.step()){
      const [x, y0, zs, d] = st.get();
      n++; if(n % 500 === 0){ progress && progress(n / total, 'تحويل البلاطات'); await new Promise(r=>setTimeout(r)); }
      if(!d || !d.length) continue;
      const z = zoomOf(zs), y = inv ? Math.pow(2, z) - 1 - y0 : y0;
      if(!first) first = d; if(!alpha && n < 50) alpha = hasAlpha(d);
      tiles.push({z, x, y, data:new Blob([d])});
      if(z < minZ) minZ = z; if(z > maxZ) maxZ = z;
    }
    st.free();
    if(!tiles.length) throw fail('خريطة OsmAnd فارغة');
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for(const t of tiles) if(t.z === maxZ){ x0 = Math.min(x0, t.x); x1 = Math.max(x1, t.x); y0 = Math.min(y0, t.y); y1 = Math.max(y1, t.y); }
    const bounds = [tileLng(x0, maxZ), tileLat(y1 + 1, maxZ), tileLng(x1 + 1, maxZ), tileLat(y0, maxZ)];
    const kind = first[0] === 0xFF ? 'jpg' : first[0] === 0x52 ? 'webp' : 'png';
    progress && progress(1, 'حفظ');
    return {blob:await writePmtiles(tiles, {tileType:{png:2, jpg:3, webp:4}[kind], minZoom:minZ, maxZoom:maxZ, bounds, meta:{format:kind, overlay:alpha}}), name:'', overlay:alpha};
  }finally{ db.close(); }
}

// ---------- الإسقاطات ----------
const WA = 6378137, WF = 1 / 298.257223563, K0 = 0.9996, E2 = WF * (2 - WF), EP2 = E2 / (1 - E2);
function utmFwd(lng, lat, zone, south){
  const l0 = ((zone - 1) * 6 - 177) * D2R, p = lat * D2R, s = Math.sin(p), c = Math.cos(p), t = Math.tan(p);
  const N = WA / Math.sqrt(1 - E2 * s * s), T = t * t, C = EP2 * c * c, A = c * (lng * D2R - l0);
  const M = WA * ((1 - E2 / 4 - 3 * E2 * E2 / 64 - 5 * E2 ** 3 / 256) * p - (3 * E2 / 8 + 3 * E2 * E2 / 32 + 45 * E2 ** 3 / 1024) * Math.sin(2 * p)
    + (15 * E2 * E2 / 256 + 45 * E2 ** 3 / 1024) * Math.sin(4 * p) - (35 * E2 ** 3 / 3072) * Math.sin(6 * p));
  const x = K0 * N * (A + (1 - T + C) * A ** 3 / 6 + (5 - 18 * T + T * T + 72 * C - 58 * EP2) * A ** 5 / 120) + 500000;
  const y = K0 * (M + N * t * (A * A / 2 + (5 - T + 9 * C + 4 * C * C) * A ** 4 / 24 + (61 - 58 * T + T * T + 600 * C - 330 * EP2) * A ** 6 / 720));
  return [x, south ? y + 10000000 : y];
}
function utmInv(x, y, zone, south){
  x -= 500000; if(south) y -= 10000000;
  const l0 = ((zone - 1) * 6 - 177) * D2R, mu = y / K0 / (WA * (1 - E2 / 4 - 3 * E2 * E2 / 64 - 5 * E2 ** 3 / 256));
  const e1 = (1 - Math.sqrt(1 - E2)) / (1 + Math.sqrt(1 - E2));
  const p1 = mu + (3 * e1 / 2 - 27 * e1 ** 3 / 32) * Math.sin(2 * mu) + (21 * e1 * e1 / 16 - 55 * e1 ** 4 / 32) * Math.sin(4 * mu)
    + (151 * e1 ** 3 / 96) * Math.sin(6 * mu) + (1097 * e1 ** 4 / 512) * Math.sin(8 * mu);
  const s = Math.sin(p1), c = Math.cos(p1), t = Math.tan(p1);
  const N1 = WA / Math.sqrt(1 - E2 * s * s), T1 = t * t, C1 = EP2 * c * c, R1 = WA * (1 - E2) / Math.pow(1 - E2 * s * s, 1.5), D = x / (N1 * K0);
  const lat = p1 - (N1 * t / R1) * (D * D / 2 - (5 + 3 * T1 + 10 * C1 - 4 * C1 * C1 - 9 * EP2) * D ** 4 / 24 + (61 + 90 * T1 + 298 * C1 + 45 * T1 * T1 - 252 * EP2 - 3 * C1 * C1) * D ** 6 / 720);
  const lng = l0 + (D - (1 + 2 * T1 + C1) * D ** 3 / 6 + (5 - 2 * C1 + 28 * T1 - 3 * C1 * C1 + 8 * EP2 + 24 * T1 * T1) * D ** 5 / 120) / c;
  return [lng * R2D, lat * R2D];
}
const MR = 6378137;
const CRS = {
  geo:{fwd:(lng, lat)=>[lng, lat], inv:(x, y)=>[x, y]},
  merc:{fwd:(lng, lat)=>[MR * lng * D2R, MR * Math.log(Math.tan(Math.PI / 4 + lat * D2R / 2))], inv:(x, y)=>[x / MR * R2D, (2 * Math.atan(Math.exp(y / MR)) - Math.PI / 2) * R2D]},
  utm:(zone, south)=>({fwd:(lng, lat)=>utmFwd(lng, lat, zone, south), inv:(x, y)=>utmInv(x, y, zone, south)})
};
function crsFromEpsg(code){
  code = Number(code);
  if([4326, 4269, 4258, 4019, 4030, 4204, 4283, 4617].includes(code)) return CRS.geo;
  if([3857, 900913, 3785, 102100, 102113, 3395].includes(code)) return CRS.merc;
  if(code >= 32601 && code <= 32660) return CRS.utm(code - 32600, false);
  if(code >= 32701 && code <= 32760) return CRS.utm(code - 32700, true);
  if(code >= 20436 && code <= 20440) return CRS.utm(code - 20400, false);   // عين العبد / UTM (المساحة السعودية القديمة)
  return null;
}
function crsFromWkt(w){
  if(!w) return null;
  const m = /UTM[\s_]*zone[\s_]*(\d{1,2})\s*([NS])?/i.exec(w);
  if(m) return CRS.utm(Number(m[1]), (m[2] || 'N').toUpperCase() === 'S');
  if(/Pseudo[\s_-]*Mercator|Mercator_Auxiliary_Sphere|Popular Visualisation|Web[\s_]*Mercator|EPSG["\s,:]*3857/i.test(w)) return CRS.merc;
  const e = /AUTHORITY\["EPSG",\s*"(\d+)"\]\s*\]\s*$/i.exec(w.trim()); if(e && crsFromEpsg(e[1])) return crsFromEpsg(e[1]);
  if(/^\s*GEOGCS/i.test(w) || /^\s*GEOGCRS/i.test(w)) return CRS.geo;
  return null;
}

// ---------- نماذج المعايرة: بكسل ↔ خط طول/عرض ----------
function solve3(A, b){   // حل 3×3 بطريقة كرامر
  const d = m=>m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
  const D = d(A); if(Math.abs(D) < 1e-18) return null;
  return [0, 1, 2].map(i=>d(A.map((r, k)=>r.map((v, j)=>j === i ? b[k] : v))) / D);
}
// تحويل أفيني بالمربعات الصغرى: (u,v) ← (x,y)
function fitAffine(pairs, from, to){
  const S = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], bu = [0, 0, 0], bv = [0, 0, 0];
  for(const p of pairs){ const r = [p[from][0], p[from][1], 1]; for(let i = 0; i < 3; i++){ for(let j = 0; j < 3; j++) S[i][j] += r[i] * r[j]; bu[i] += r[i] * p[to][0]; bv[i] += r[i] * p[to][1]; } }
  const a = solve3(S, bu), b = solve3(S, bv);
  if(!a || !b) throw fail('نقاط المعايرة غير كافية أو على خط واحد');
  return (x, y)=>[a[0] * x + a[1] * y + a[2], b[0] * x + b[1] * y + b[2]];
}
function modelFromPairs(pairs){   // pairs: [{px:[x,y], ll:[lng,lat]}]
  if(pairs.length < 3) throw fail('يلزم 3 نقاط معايرة على الأقل');
  return {toPixel:fitAffine(pairs, 'll', 'px'), toLngLat:fitAffine(pairs, 'px', 'll')};
}
function modelFromAffine(aff, crs){   // aff: [A,B,C,D,E,F]  X = A*x + B*y + C ، Y = D*x + E*y + F (x,y إحداثيات حافة البكسل)
  const [A, B, C, D, E, F] = aff, det = A * E - B * D;
  if(!det) throw fail('ملف المعايرة غير صالح');
  return {
    toLngLat:(x, y)=>crs.inv(A * x + B * y + C, D * x + E * y + F),
    toPixel:(lng, lat)=>{ const [X, Y] = crs.fwd(lng, lat), dx = X - C, dy = Y - F; return [(E * dx - B * dy) / det, (A * dy - D * dx) / det]; }
  };
}

// ---------- قطع الصور إلى بلاطات ويب ----------
const tileLng = (x, z)=>x / Math.pow(2, z) * 360 - 180;
const tileLat = (y, z)=>Math.atan(Math.sinh(Math.PI * (1 - 2 * y / Math.pow(2, z)))) * R2D;
const lngTile = (lng, z)=>Math.floor((lng + 180) / 360 * Math.pow(2, z));
const latTile = (lat, z)=>{ const s = Math.sin(Math.max(-85.05, Math.min(85.05, lat)) * D2R); return Math.floor((0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * Math.pow(2, z)); };
function borderLngLat(L){
  const pts = [], k = 8;
  for(let i = 0; i <= k; i++){ const f = i / k; pts.push(L.model.toLngLat(f * L.w, 0), L.model.toLngLat(f * L.w, L.h), L.model.toLngLat(0, f * L.h), L.model.toLngLat(L.w, f * L.h)); }
  return pts;
}
function zoomFor(L){
  const [lng, lat] = L.model.toLngLat(L.w / 2, L.h / 2), d = 0.0005;
  const p1 = L.model.toPixel(lng, lat), p2 = L.model.toPixel(lng + d, lat), p3 = L.model.toPixel(lng, lat + d);
  const pxPerM = Math.max(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) / (d * 111320 * Math.cos(lat * D2R)), Math.hypot(p3[0] - p1[0], p3[1] - p1[1]) / (d * 110574));
  return Math.round(Math.log2(156543.03 * Math.cos(lat * D2R) * pxPerM));
}
// layers: [{w,h,model,chunks:[{x0,y0,w,h,load:()=>Promise<CanvasImageSource>}]}]
async function tileLayers(layers, progress){
  let b = [180, 85, -180, -85];
  for(const L of layers) for(const [lng, lat] of borderLngLat(L)){
    if(!Number.isFinite(lng) || !Number.isFinite(lat)) throw fail('معايرة الخريطة غير صالحة');
    b = [Math.min(b[0], lng), Math.min(b[1], lat), Math.max(b[2], lng), Math.max(b[3], lat)];
  }
  b = [Math.max(-180, b[0]), Math.max(-85, b[1]), Math.min(180, b[2]), Math.min(85, b[3])];
  if(b[0] >= b[2] || b[1] >= b[3]) throw fail('معايرة الخريطة غير صالحة');
  const count = z=>(lngTile(b[2], z) - lngTile(b[0], z) + 1) * (latTile(b[1], z) - latTile(b[3], z) + 1);
  let maxZ = Math.max(1, Math.min(18, Math.max(...layers.map(zoomFor))));
  while(maxZ > 1 && count(maxZ) > 12000) maxZ--;
  const minZ = Math.max(0, maxZ - 6);
  let total = 0; for(let z = minZ; z <= maxZ; z++) total += count(z);
  const cv = document.createElement('canvas'); cv.width = cv.height = 256;
  const ctx = cv.getContext('2d', {willReadFrequently:true});
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
  const lru = new Map();
  const getChunk = async ch=>{
    if(lru.has(ch)){ const v = lru.get(ch); lru.delete(ch); lru.set(ch, v); return v; }
    const img = await ch.load(); lru.set(ch, img);
    while(lru.size > 6){ const [k, v] = lru.entries().next().value; lru.delete(k); if(v && v.close) v.close(); }
    return img;
  };
  const toBlob = type=>new Promise((res, rej)=>cv.toBlob(bl=>bl ? res(bl) : rej(fail('تعذّر إنشاء البلاطات')), type, 0.86));
  const tiles = []; let done = 0;
  for(let z = maxZ; z >= minZ; z--){
    const n = Math.pow(2, z), xs = lngTile(b[0], z), xe = lngTile(b[2], z), ys = latTile(b[3], z), ye = latTile(b[1], z);
    for(let ty = ys; ty <= ye; ty++) for(let tx = xs; tx <= xe; tx++){
      done++; if(done % 20 === 0){ progress && progress(done / total, 'تجهيز الخريطة'); await new Promise(r=>setTimeout(r)); }
      ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, 256, 256);
      let drew = false;
      const P = (u, v)=>[(tx + u / 256) / n * 360 - 180, Math.atan(Math.sinh(Math.PI * (1 - 2 * (ty + v / 256) / n))) * R2D];
      for(const L of layers){
        const pa = L.model.toPixel(...P(0, 0)), pb = L.model.toPixel(...P(256, 0)), pc = L.model.toPixel(...P(0, 256)), pd = L.model.toPixel(...P(256, 256));
        const sx0 = Math.max(0, Math.floor(Math.min(pa[0], pb[0], pc[0], pd[0])) - 1), sx1 = Math.min(L.w, Math.ceil(Math.max(pa[0], pb[0], pc[0], pd[0])) + 1);
        const sy0 = Math.max(0, Math.floor(Math.min(pa[1], pb[1], pc[1], pd[1])) - 1), sy1 = Math.min(L.h, Math.ceil(Math.max(pa[1], pb[1], pc[1], pd[1])) + 1);
        if(sx0 >= sx1 || sy0 >= sy1) continue;
        // مصفوفة البلاطة ← المصدر، ثم معكوسها لرسم المصدر داخل البلاطة
        const m00 = (pb[0] - pa[0]) / 256, m01 = (pc[0] - pa[0]) / 256, m10 = (pb[1] - pa[1]) / 256, m11 = (pc[1] - pa[1]) / 256, det = m00 * m11 - m01 * m10;
        if(!det) continue;
        const i00 = m11 / det, i01 = -m01 / det, i10 = -m10 / det, i11 = m00 / det;
        const e = -(i00 * pa[0] + i01 * pa[1]), f = -(i10 * pa[0] + i11 * pa[1]);
        for(const ch of L.chunks){
          const lx0 = Math.max(sx0, ch.x0), lx1 = Math.min(sx1, ch.x0 + ch.w), ly0 = Math.max(sy0, ch.y0), ly1 = Math.min(sy1, ch.y0 + ch.h);
          if(lx0 >= lx1 || ly0 >= ly1) continue;
          const img = await getChunk(ch);
          ctx.setTransform(i00, i10, i01, i11, e + i00 * ch.x0 + i01 * ch.y0, f + i10 * ch.x0 + i11 * ch.y0);
          ctx.drawImage(img, lx0 - ch.x0, ly0 - ch.y0, lx1 - lx0, ly1 - ly0, lx0 - ch.x0, ly0 - ch.y0, lx1 - lx0, ly1 - ly0);
          drew = true;
        }
      }
      if(!drew) continue;
      const px = ctx.getImageData(0, 0, 256, 256).data;
      let opaque = true, any = false;
      for(let i = 3; i < px.length; i += 4){ if(px[i] < 250) opaque = false; else any = true; if(!opaque && any) break; }
      if(!any) continue;
      tiles.push({z, x:tx, y:ty, data:await toBlob(opaque ? 'image/jpeg' : 'image/png')});
    }
  }
  for(const v of lru.values()) if(v && v.close) v.close();
  if(!tiles.length) throw fail('لم ينتج عن الخريطة أي بلاطات؛ تحقق من المعايرة');
  progress && progress(1, 'حفظ');
  return await writePmtiles(tiles, {tileType:2, minZoom:minZ, maxZoom:maxZ, bounds:b, meta:{format:'png'}});
}
async function imageLayer(blob, model){
  let img;
  try{ img = await createImageBitmap(blob); }catch(e){ throw fail('تعذّر فتح الصورة؛ قد تكون أكبر من قدرة الجوال أو بصيغة غير مدعومة'); }
  return {w:img.width, h:img.height, model:model(img.width, img.height), chunks:[{x0:0, y0:0, w:img.width, h:img.height, load:async()=>img}]};
}

// ---------- GeoTIFF ----------
async function fromGeoTiff(file, progress){
  progress && progress(0, 'قراءة GeoTIFF');
  const GT = await loadTiff();
  let img;
  try{ img = await (await GT.fromBlob(file)).getImage(); }catch(e){ throw fail('ملف TIFF تالف أو بضغط غير مدعوم'); }
  const w = img.getWidth(), h = img.getHeight(), gk = img.getGeoKeys() || {}, fd = img.getFileDirectory();
  let crs = crsFromEpsg(gk.ProjectedCSTypeGeoKey);
  if(!crs && gk.GTModelTypeGeoKey === 2) crs = crsFromEpsg(gk.GeographicTypeGeoKey) || CRS.geo;
  if(!crs && gk.ProjectedCSTypeGeoKey) crs = crsFromWkt(gk.PCSCitationGeoKey || gk.GTCitationGeoKey || '');
  if(!crs && gk.GeographicTypeGeoKey) crs = crsFromEpsg(gk.GeographicTypeGeoKey);
  if(!crs) throw fail('ملف TIFF بلا معايرة جغرافية أو بإسقاط غير مدعوم (المدعوم: WGS84، Web Mercator، UTM)');
  let aff;
  if(fd.ModelTransformation){ const t = fd.ModelTransformation; aff = [t[0], t[1], t[3], t[4], t[5], t[7]]; }
  else{
    let o, r; try{ o = img.getOrigin(); r = img.getResolution(); }catch(e){ throw fail('ملف TIFF بلا معايرة جغرافية (ليس GeoTIFF)'); }
    aff = [r[0], 0, o[0], 0, r[1], o[1]];
  }
  const nodata = img.getGDALNoData();
  const CH = 1024, chunks = [];
  for(let y0 = 0; y0 < h; y0 += CH) for(let x0 = 0; x0 < w; x0 += CH){
    const cw = Math.min(CH, w - x0), chh = Math.min(CH, h - y0);
    chunks.push({x0, y0, w:cw, h:chh, load:async()=>{
      const rgb = await img.readRGB({window:[x0, y0, x0 + cw, y0 + chh], interleave:true, enableAlpha:true});
      const ch = rgb.length / (cw * chh), out = new Uint8ClampedArray(cw * chh * 4);
      let max = 255; if(!(rgb instanceof Uint8Array || rgb instanceof Uint8ClampedArray)){ max = 0; for(let i = 0; i < rgb.length; i++) if(rgb[i] > max) max = rgb[i]; max = max || 1; }
      const sc = 255 / max;
      for(let i = 0, j = 0; i < cw * chh; i++, j += ch){
        const r = rgb[j], g = rgb[j + 1], bb = rgb[j + 2];
        out[i * 4] = r * sc; out[i * 4 + 1] = g * sc; out[i * 4 + 2] = bb * sc;
        out[i * 4 + 3] = ch >= 4 ? rgb[j + 3] * sc : (nodata != null && r === nodata && g === nodata && bb === nodata ? 0 : 255);
      }
      return createImageBitmap(new ImageData(out, cw, chh));
    }});
  }
  return tileLayers([{w, h, model:modelFromAffine(aff, crs), chunks}], progress);
}

// ---------- صورة + ملف العالم (.jgw/.pgw/.tfw/.wld) ----------
async function fromWorldFile(imageFile, worldText, prjText, progress){
  const v = worldText.trim().split(/\s+/).map(Number);
  if(v.length < 6 || v.some(x=>!Number.isFinite(x))) throw fail('ملف العالم (world file) غير صالح');
  const [A, D, B, E, C, F] = v;
  let crs = crsFromWkt(prjText);
  if(!crs){
    if(Math.abs(C) <= 180 && Math.abs(F) <= 90) crs = CRS.geo;
    else throw fail('الإحداثيات بالأمتار؛ اختر ملف ‎.prj مع الصورة لمعرفة الإسقاط');
  }
  // ملف العالم يصف مركز البكسل الأول؛ نحوّله إلى حافته
  const aff = [A, B, C - A / 2 - B / 2, D, E, F - D / 2 - E / 2];
  progress && progress(0, 'قراءة الصورة');
  return tileLayers([await imageLayer(imageFile, ()=>modelFromAffine(aff, crs))], progress);
}

// ---------- OziExplorer ‎.map ----------
function parseOziMap(text){
  const lines = text.split(/\r?\n/);
  if(!/^OziExplorer Map Data File/i.test(lines[0] || '')) throw fail('ملف ‎.map ليس من OziExplorer');
  const image = (lines[2] || '').trim().split(/[\\/]/).pop();
  const pts = [], pxy = {}, pll = {}; let iw = 0, ih = 0;
  for(const ln of lines){
    const p = ln.split(',').map(s=>s.trim());
    if(/^Point\d+$/i.test(p[0]) && p[1] === 'xy' && p[2] !== '' && p[3] !== ''){
      const x = Number(p[2]), y = Number(p[3]);
      if(p[6] !== '' && p[9] !== '' && Number.isFinite(Number(p[6]))){
        let lat = Number(p[6]) + Number(p[7] || 0) / 60, lng = Number(p[9]) + Number(p[10] || 0) / 60;
        if(/S/i.test(p[8])) lat = -lat; if(/W/i.test(p[11])) lng = -lng;
        pts.push({px:[x, y], ll:[lng, lat]});
      }else if(p[12] === 'grid' && p[13] !== '' && p[14] !== ''){
        pts.push({px:[x, y], ll:utmInv(Number(p[14]), Number(p[15]), Number(p[13]), /S/i.test(p[16] || ''))});
      }
    }
    if(p[0] === 'MMPXY') pxy[p[1]] = [Number(p[2]), Number(p[3])];
    if(p[0] === 'MMPLL') pll[p[1]] = [Number(p[2]), Number(p[3])];
    if(p[0] === 'IWH'){ iw = Number(p[2]); ih = Number(p[3]); }
  }
  if(pts.length < 3) for(const k of Object.keys(pxy)) if(pll[k]) pts.push({px:pxy[k], ll:pll[k]});
  if(pts.length < 3) throw fail('ملف ‎.map لا يحوي نقاط معايرة كافية');
  return {image, pts, iw, ih};
}
async function fromOzi(mapText, imageFile, progress){
  const m = parseOziMap(mapText);
  progress && progress(0, 'قراءة الصورة');
  return tileLayers([await imageLayer(imageFile, (w, h)=>{
    const sx = m.iw ? w / m.iw : 1, sy = m.ih ? h / m.ih : 1;   // إن صُغّرت الصورة بعد المعايرة
    return modelFromPairs(m.pts.map(p=>({px:[p.px[0] * sx, p.px[1] * sy], ll:p.ll})));
  })], progress);
}

// ---------- KML/KMZ GroundOverlay ----------
function groundOverlays(doc){
  const out = [];
  for(const go of doc.getElementsByTagName('GroundOverlay')){
    const href = go.getElementsByTagName('href')[0]?.textContent?.trim();
    if(!href) continue;
    const quad = [...go.getElementsByTagNameNS('*', 'LatLonQuad')][0];
    let corners;   // [TL, TR, BR, BL] بخط الطول/العرض
    if(quad){
      const c = quad.getElementsByTagName('coordinates')[0]?.textContent.trim().split(/\s+/).map(t=>t.split(',').map(Number));
      if(!c || c.length < 4) continue;
      corners = [c[3], c[2], c[1], c[0]];
    }else{
      const box = go.getElementsByTagName('LatLonBox')[0]; if(!box) continue;
      const g = k=>Number(box.getElementsByTagName(k)[0]?.textContent);
      const n = g('north'), s = g('south'), e = g('east'), w = g('west'), rot = (g('rotation') || 0) * D2R;
      if(![n, s, e, w].every(Number.isFinite)) continue;
      const cx = (e + w) / 2, cy = (n + s) / 2, k = Math.cos(cy * D2R);
      const R = ([x, y])=>{ const dx = (x - cx) * k, dy = y - cy; return [cx + (dx * Math.cos(rot) - dy * Math.sin(rot)) / k, cy + dx * Math.sin(rot) + dy * Math.cos(rot)]; };
      corners = [[w, n], [e, n], [e, s], [w, s]].map(R);
    }
    out.push({href, corners});
  }
  return out;
}
// resolve(href) → Promise<Blob|null>
async function fromGroundOverlays(doc, resolve, progress){
  const gos = groundOverlays(doc);
  if(!gos.length) return null;
  const layers = [];
  for(const g of gos){
    const blob = await resolve(g.href);
    if(!blob) continue;
    let dims;
    try{ const bm = await createImageBitmap(blob); dims = [bm.width, bm.height]; bm.close && bm.close(); }catch(e){ continue; }
    const [w, h] = dims;
    layers.push({w, h, model:modelFromPairs([{px:[0, 0], ll:g.corners[0]}, {px:[w, 0], ll:g.corners[1]}, {px:[w, h], ll:g.corners[2]}, {px:[0, h], ll:g.corners[3]}]),
      chunks:[{x0:0, y0:0, w, h, load:()=>createImageBitmap(blob)}]});
  }
  if(!layers.length) throw fail('صور طبقة الخريطة (GroundOverlay) غير موجودة؛ اختر ملف KML مع صوره أو استخدم KMZ');
  return tileLayers(layers, progress);
}

// ---------- ZIP (KMZ) ----------
async function zipEntries(buf){
  const dv = new DataView(buf), out = new Map();
  let eocd = -1;
  for(let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 65557); i--) if(dv.getUint32(i, true) === 0x06054b50){ eocd = i; break; }
  if(eocd < 0) return out;
  let off = dv.getUint32(eocd + 16, true);
  const count = dv.getUint16(eocd + 10, true);
  for(let n = 0; n < count; n++){
    if(dv.getUint32(off, true) !== 0x02014b50) break;
    const method = dv.getUint16(off + 10, true), size = dv.getUint32(off + 20, true);
    const nameLen = dv.getUint16(off + 28, true), extraLen = dv.getUint16(off + 30, true), commentLen = dv.getUint16(off + 32, true), local = dv.getUint32(off + 42, true);
    const name = new TextDecoder().decode(new Uint8Array(buf, off + 46, nameLen));
    off += 46 + nameLen + extraLen + commentLen;
    const start = local + 30 + dv.getUint16(local + 26, true) + dv.getUint16(local + 28, true);
    out.set(name.replace(/\\/g, '/').toLowerCase(), async()=>{
      const bytes = new Uint8Array(buf, start, size);
      if(method === 0) return new Blob([bytes]);
      if(method === 8 && typeof DecompressionStream !== 'undefined') return new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).blob();
      return null;
    });
  }
  return out;
}

window.DalilMapImport = {fromSqlitedb, fromMbtiles, fromGeoTiff, fromWorldFile, fromOzi, parseOziMap, fromGroundOverlays, zipEntries, writePmtiles, _utm:{utmFwd, utmInv}};
})();
