import pyarrow.dataset as ds, pyarrow.fs as fs, pyarrow.parquet as pq, time, sys
s3=fs.S3FileSystem(anonymous=True,region='us-west-2')
R='overturemaps-us-west-2/release/2026-09-23.1/theme='
X0,X1,Y0,Y1=45.4,47.9,23.7,25.9
f=(ds.field('bbox','xmin')<X1)&(ds.field('bbox','xmax')>X0)&(ds.field('bbox','ymin')<Y1)&(ds.field('bbox','ymax')>Y0)
for t,cols in [('transportation/type=segment',['id','names','subtype','class','geometry','bbox','road_surface']),
               ('base/type=land_use',['id','names','subtype','class','geometry','bbox']),
               ('base/type=land',['id','names','subtype','class','geometry','bbox','elevation']),
               ('base/type=water',['id','names','subtype','class','geometry','bbox','is_intermittent']),
               ('divisions/type=division',['id','names','subtype','class','geometry','bbox','population'])]:
    t0=time.time(); d=ds.dataset(R+t+'/',filesystem=s3,format='parquet')
    cols=[c for c in cols if c in d.schema.names]
    tb=d.to_table(columns=cols,filter=f); pq.write_table(tb,t.split('=')[1]+'.parquet'); print(t,tb.num_rows,round(time.time()-t0),flush=True)
