/* A single v63 map bundle. Archive scripts are never executed. */
(function(root){
'use strict';
const PREFIX='dalil-v63-bundle-',FILES=['abumalik-v63.pmtiles','abumalik-v63-hs.pmtiles','abumalik-v63-signature.pmtiles'];
const fail=message=>Object.assign(new Error(message),{userMessage:message});
const table=new Uint32Array(256);for(let i=0;i<256;i++){let n=i;for(let k=0;k<8;k++)n=n&1?0xEDB88320^(n>>>1):n>>>1;table[i]=n>>>0;}
function crcUpdate(value,bytes){for(let i=0;i<bytes.length;i++)value=table[(value^bytes[i])&255]^(value>>>8);return value>>>0;}
const assetBase=new URL('./',root.document?.currentScript?.src||new URL('v63/import-bundle.js',root.location.href));
const cacheUrl=name=>new URL('maps/'+name+'?v=63',assetBase).href;
function cacheNameOK(name){return typeof name==='string'&&/^dalil-v63-bundle-[a-z0-9-]+$/.test(name);}
function maps(){try{const a=JSON.parse(root.localStorage.getItem('dalil_user_maps')||'[]');return Array.isArray(a)?a:[];}catch(e){return[];}}
function findActive(){return maps().find(m=>m.bundleVersion===63&&m.on!==false&&cacheNameOK(m.cacheName))||null;}
async function inspectZip(file){
 if(file.size<22||file.size>1073741824)throw fail('حجم حزمة الخريطة غير صالح');
 const tail=new Uint8Array(await file.slice(Math.max(0,file.size-65557)).arrayBuffer()),view=new DataView(tail.buffer);let end=-1;
 for(let i=tail.length-22;i>=0;i--)if(view.getUint32(i,true)===0x06054b50&&i+22+view.getUint16(i+20,true)===tail.length){end=i;break;}
 if(end<0)throw fail('ملف الخريطة غير مكتمل؛ أعد تنزيله');
 if(view.getUint16(end+4,true)||view.getUint16(end+6,true))throw fail('اختر ملف الخريطة الكامل');
 const count=view.getUint16(end+10,true),length=view.getUint32(end+12,true),offset=view.getUint32(end+16,true);
 if(count>128||length>1048576||offset+length>file.size-22||count===65535)throw fail('بنية حزمة الخريطة غير مدعومة');
 const bytes=new Uint8Array(await file.slice(offset,offset+length).arrayBuffer()),dv=new DataView(bytes.buffer),out=new Map();let p=0;
 for(let i=0;i<count;i++){
  if(p+46>bytes.length||dv.getUint32(p,true)!==0x02014b50)throw fail('فهرس حزمة الخريطة تالف');
  const n=dv.getUint16(p+28,true),extra=dv.getUint16(p+30,true),comment=dv.getUint16(p+32,true),next=p+46+n+extra+comment;
  if(next>bytes.length)throw fail('فهرس حزمة الخريطة غير مكتمل');
  const name=new TextDecoder().decode(bytes.subarray(p+46,p+46+n));
  if(name.includes('\\')||name.split('/').some(x=>x==='..')||name.startsWith('/')||out.has(name))throw fail('مسارات الحزمة غير صالحة');
  const entry={name,flags:dv.getUint16(p+8,true),method:dv.getUint16(p+10,true),crc:dv.getUint32(p+16,true),compressed:dv.getUint32(p+20,true),size:dv.getUint32(p+24,true),offset:dv.getUint32(p+42,true)};
  if(entry.flags&1||entry.offset+30+entry.compressed>offset)throw fail('حزمة الخريطة مشفرة أو تالفة');
  out.set(name,entry);p=next;
 }
 if(p!==bytes.length)throw fail('فهرس حزمة الخريطة غير صالح');return out;
}
async function entryStream(file,e,{tileType,onBytes}={}){
 const raw=await file.slice(e.offset,e.offset+30).arrayBuffer();if(raw.byteLength!==30)throw fail('ملف الخريطة غير مكتمل');
 const v=new DataView(raw);if(v.getUint32(0,true)!==0x04034b50||v.getUint16(8,true)!==e.method)throw fail('جزء الخريطة تالف');
 const offset=e.offset+30+v.getUint16(26,true)+v.getUint16(28,true);if(offset+e.compressed>file.size)throw fail('جزء الخريطة غير مكتمل');
 let stream=file.slice(offset,offset+e.compressed).stream();
 if(e.method===8){try{stream=stream.pipeThrough(new root.DecompressionStream('deflate-raw'));}catch(error){throw fail('تعذر فك حزمة الخريطة؛ جرّب Safari محدثًا');}}
 else if(e.method!==0)throw fail('طريقة ضغط الحزمة غير مدعومة');
 let size=0,crc=0xFFFFFFFF,header=new Uint8Array(127),headerSize=0;
 return stream.pipeThrough(new root.TransformStream({transform(chunk,controller){
  size+=chunk.length;if(size>e.size)throw fail('حجم جزء الخريطة غير صحيح');crc=crcUpdate(crc,chunk);
  if(tileType&&headerSize<127){const n=Math.min(127-headerSize,chunk.length);header.set(chunk.subarray(0,n),headerSize);headerSize+=n;
   if(headerSize===127){
    const magic=new TextDecoder().decode(header.subarray(0,7)),h=new DataView(header.buffer);
    if(magic!=='PMTiles'||header[7]!==3||header[99]!==tileType||![1,2].includes(header[97])||![1,2].includes(header[98])||header[100]>header[101]||header[101]>26)throw fail('بيانات الخريطة لا تطابق الحزمة');
    for(const at of [8,24,40,56]){const start=Number(h.getBigUint64(at,true)),length=Number(h.getBigUint64(at+8,true));if(start<127||start+length>e.size)throw fail('فهرس ملف الخريطة غير صالح');}
    if(h.getBigUint64(16,true)===0n||h.getBigUint64(64,true)===0n)throw fail('ملف الخريطة فارغ');
   }}
  if(onBytes)onBytes(chunk.length);controller.enqueue(chunk);
 },flush(){if(size!==e.size||((crc^0xFFFFFFFF)>>>0)!==e.crc||(tileType&&headerSize!==127))throw fail('تعذر التحقق من سلامة الخريطة؛ أعد تنزيل الملف');}}));
}
async function readSmall(file,e){if(!e||e.size>1048576)throw fail('تعريف حزمة الخريطة غير صالح');return new Response(await entryStream(file,e)).text();}
async function importFile(file,progress){
 const entries=await inspectZip(file),base=[...entries.keys()].find(n=>n.endsWith('/maps/'+FILES[0])||n==='maps/'+FILES[0]);
 if(!base)return null;
 try{return await importKnown(file,progress,entries,base);}catch(error){error.v63Bundle=true;throw error;}
}
async function importKnown(file,progress,entries,base){
 const prefix=base.slice(0,-('maps/'+FILES[0]).length);
 const parts=FILES.map(n=>entries.get(prefix+'maps/'+n)),definition=entries.get(prefix+'data/maps-v63.json');
 if(parts.some(x=>!x)||!definition)throw fail('حزمة v63 ناقصة؛ اختر الملف الكامل');
 const manifest=JSON.parse(await readSmall(file,definition)),region=manifest.regions?.[0];
 if(!region||region.id!=='abumalik-v63'||region.v!==63||!Array.isArray(region.bbox)||region.bbox.length!==4||!region.bbox.every(Number.isFinite))throw fail('تعريف خريطة v63 غير صحيح');
 if(parts.some(p=>p.size>536870912)||parts.reduce((n,p)=>n+p.size,0)>1073741824)throw fail('حجم الخريطة بعد الفك غير مدعوم');
 const cacheName=PREFIX+(root.crypto.randomUUID?root.crypto.randomUUID():Date.now().toString(36)+'-'+Math.random().toString(36).slice(2)),cache=await root.caches.open(cacheName),total=parts.reduce((n,p)=>n+p.size,0);let done=0;
 try{
  for(let i=0;i<parts.length;i++){
   const stream=await entryStream(file,parts[i],{tileType:i===1?3:1,onBytes:n=>{done+=n;if(progress)progress(done/total,'حفظ الخريطة');}});
   await cache.put(cacheUrl(FILES[i]),new Response(stream,{headers:{'Content-Type':'application/octet-stream'}}));
  }
  const id='v63-'+cacheName.slice(PREFIX.length),list=maps(),old=list.filter(m=>m.bundleVersion===63);
  const map={id,bundleVersion:63,cacheName,name:'خريطة أبو مالك v63',type:'bundle',bounds:region.bbox,minzoom:5,maxzoom:22,size:total,archiveSizes:parts.map(p=>p.size),on:true,addedAt:Date.now()};
  root.localStorage.setItem('dalil_user_maps',JSON.stringify([map,...list.filter(m=>m.bundleVersion!==63)]));
  for(const m of old)if(cacheNameOK(m.cacheName))try{await root.caches.delete(m.cacheName);}catch(e){}
  try{await root.navigator.storage.persist();}catch(e){}return map;
 }catch(error){await root.caches.delete(cacheName);throw error;}
}
async function isInstalled(m){if(!cacheNameOK(m.cacheName))return false;const c=await root.caches.open(m.cacheName);for(const n of FILES)if(!await c.match(cacheUrl(n)))return false;return true;}
async function remove(m){if(cacheNameOK(m.cacheName))await root.caches.delete(m.cacheName);}
const api={importFile,inspectZip,entryStream,isInstalled,remove,findActive,FILES};root.DalilV63Bundle=api;if(typeof module!=='undefined')module.exports=api;
})(typeof window==='undefined'?globalThis:window);
