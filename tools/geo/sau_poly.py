import json,collections,math
b=json.load(open('data/sau-boundary.json'))
polys=b['coordinates']
bb=[(min(p[0] for p in poly[0]),min(p[1] for p in poly[0]),max(p[0] for p in poly[0]),max(p[1] for p in poly[0])) for poly in polys]
def inring(x,y,r):
    c=False;n=len(r);j=n-1
    for i in range(n):
        xi,yi=r[i];xj,yj=r[j]
        if (yi>y)!=(yj>y) and x<(xj-xi)*(y-yi)/(yj-yi)+xi: c=not c
        j=i
    return c
def inside(x,y):
    for poly,(a,bm,c,d) in zip(polys,bb):
        if a<=x<=c and bm<=y<=d and inring(x,y,poly[0]) and not any(inring(x,y,h) for h in poly[1:]): return True
    return False
V=[(x,y) for poly in polys for x,y in poly[0]]
def dist_border(x,y):
    k=math.cos(math.radians(y))
    return min(math.hypot((x-a)*k,y-b) for a,b in V)*111.2
