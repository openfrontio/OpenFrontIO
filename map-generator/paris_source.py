import json, math, numpy as np
from PIL import Image, ImageDraw, ImageFilter
LAT0,LAT1,LON0,LON1 = 48.76,48.96,2.14,2.56
W = 1800
kx = math.cos(math.radians(48.86))
H = int(round(W*(LAT1-LAT0)/((LON1-LON0)*kx)))//4*4
W = W//4*4
def px(lat,lon): return ((lon-LON0)/(LON1-LON0)*W, (LAT1-lat)/(LAT1-LAT0)*H)
print(W,H,W*H)

def rings_from(el):
    """Return (outers, inners) as lists of point lists."""
    if el['type']=='way':
        g=el.get('geometry') or []
        pts=[px(p['lat'],p['lon']) for p in g]
        return ([pts],[]) if len(pts)>2 else ([],[])
    outs,ins=[],[]
    for role,acc in (('outer',outs),('inner',ins)):
        segs=[[ (p['lat'],p['lon']) for p in m['geometry']] for m in el.get('members',[]) if m['type']=='way' and m.get('role',"outer" )==role and m.get('geometry')]
        # join segments into rings
        while segs:
            ring=segs.pop(0)
            changed=True
            while ring[0]!=ring[-1] and changed:
                changed=False
                for i,s in enumerate(segs):
                    if s[0]==ring[-1]: ring+=s[1:]
                    elif s[-1]==ring[-1]: ring+=s[::-1][1:]
                    elif s[-1]==ring[0]: ring=s[:-1]+ring
                    elif s[0]==ring[0]: ring=s[::-1][:-1]+ring
                    else: continue
                    segs.pop(i); changed=True; break
            if len(ring)>2: acc.append([px(a,b) for a,b in ring])
    return outs,ins

def mask(fname, lines_tag=None, line_w=0):
    m=Image.new('L',(W,H),0); d=ImageDraw.Draw(m)
    els=json.load(open(fname))['elements']
    holes=[]
    for el in els:
        tags=el.get('tags',{})
        if lines_tag and tags.get('waterway')==lines_tag:
            pts=[px(p['lat'],p['lon']) for p in el.get('geometry',[])]
            if len(pts)>1: d.line(pts,fill=255,width=line_w)
            continue
        o,i=rings_from(el)
        for r in o: d.polygon(r,fill=255)
        holes+=i
    for r in holes: d.polygon(r,fill=0)
    return np.array(m)>127

water=mask("water.json","canal",3)
water=np.array(Image.fromarray((water*255).astype(np.uint8)).filter(ImageFilter.MaxFilter(3)))>127
parks=mask('parks.json')

# elevation from terrarium z13
z=13;n=2**z
def tf(lat,lon): return (lon+180)/360*n, (1-math.asinh(math.tan(math.radians(lat)))/math.pi)/2*n
xs0,ys0=tf(LAT1,LON0); xs1,ys1=tf(LAT0,LON1)
tx0,ty0,tx1,ty1=int(xs0),int(ys0),int(xs1),int(ys1)
mosaic=np.zeros(((ty1-ty0+1)*256,(tx1-tx0+1)*256))
for x in range(tx0,tx1+1):
    for y in range(ty0,ty1+1):
        a=np.array(Image.open(f'tiles/{x}_{y}.png').convert('RGB')).astype(float)
        mosaic[(y-ty0)*256:(y-ty0+1)*256,(x-tx0)*256:(x-tx0+1)*256]=a[...,0]*256+a[...,1]+a[...,2]/256-32768
jj,ii=np.mgrid[0:H,0:W]
lon=LON0+(ii+.5)/W*(LON1-LON0); lat=LAT1-(jj+.5)/H*(LAT1-LAT0)
fx=((lon+180)/360*n-tx0)*256; fy=((1-np.arcsinh(np.tan(np.radians(lat)))/np.pi)/2*n-ty0)*256
elev=mosaic[np.clip(fy.astype(int),0,mosaic.shape[0]-1),np.clip(fx.astype(int),0,mosaic.shape[1]-1)]
lo,hi=elev.min(),elev.max()
q=Image.fromarray(((elev-lo)/(hi-lo)*255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(2))
elev=np.array(q).astype(float)/255*(hi-lo)+lo
print('elev range',elev.min(),elev.max(),np.percentile(elev,[5,50,95]))
blue=140+np.clip((elev-35)*0.42,0,58)
blue=np.where(parks, np.maximum(blue+14,160), blue)
blue=np.clip(blue,140,200).astype(np.uint8)
blue[water]=106
img=np.stack([blue,blue,blue],-1); img[water]=[40,60,106]
Image.fromarray(img).save('image.png')
print('water px',water.sum(),'park px',parks.sum())
