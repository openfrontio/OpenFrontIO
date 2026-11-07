"""Build OpenFront's Canada map image from ETOPO 2022 + Natural Earth.
Usage: python -I build_canada.py [--target-land 2400000] [--rivers 2] [--width W]
Outputs: out/image.png (map-generator input), out/preview.png, out/nations.json
"""
import sys, os, json, argparse, math
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, 'pylibs'))
import numpy as np, rasterio, shapefile
from rasterio.warp import reproject, Resampling
from rasterio.features import rasterize
from rasterio.transform import from_origin
from shapely.geometry import shape, box
from shapely.ops import transform as shp_transform, unary_union
from pyproj import Transformer, CRS
from PIL import Image

ap = argparse.ArgumentParser()
ap.add_argument('--target-land', type=int, default=2_400_000)
ap.add_argument('--rivers', type=int, default=2, help='max Natural Earth scalerank of rivers to draw (0 = none)')
ap.add_argument('--margin-km', type=float, default=80)
ap.add_argument('--width', type=int, default=0, help='force output width (skips land-fraction estimate)')
ap.add_argument('--dem', default='etopo15_mosaic.tif', help='file in data/ (etopo15_mosaic.tif or etopo_canada_30s.tif)')
ap.add_argument('--ss', type=int, default=2, help='supersampling factor for the land mask and elevation')
ap.add_argument('--out', default='out', help='output folder name (under this script\'s folder)')
ap.add_argument('--smooth', action='store_true', help='old smoothed/majority-filtered mountain classification')
args = ap.parse_args()

DEM = os.path.join(HERE, 'data', args.dem)
NE = os.path.join(HERE, 'data', 'ne')
GSHHG = os.path.join(HERE, 'data', 'gshhg', 'GSHHS_shp', 'f')
OUT = os.path.join(HERE, args.out); os.makedirs(OUT, exist_ok=True)

LCC = CRS.from_proj4('+proj=lcc +lat_1=49 +lat_2=77 +lat_0=49 +lon_0=-95 +datum=WGS84 +units=m +no_defs')
fwd = Transformer.from_crs('EPSG:4326', LCC, always_xy=True).transform
BBOX = box(-170, 35, -10, 90)  # lon/lat clip before projecting (avoids antimeridian garbage)
ICELAND = shp_transform(fwd, box(-30, 60, -10, 70))  # everything in this lon/lat box becomes water


def read_shapes(name, pred=None, folder=None):
    r = shapefile.Reader(os.path.join(folder or NE, name))
    flds = [f[0] for f in r.fields[1:]]
    bb = BBOX.bounds
    out = []
    for sr in r.iterShapeRecords():
        b = sr.shape.bbox if hasattr(sr.shape, 'bbox') else None
        if b is not None and (b[2] < bb[0] or b[0] > bb[2] or b[3] < bb[1] or b[1] > bb[3]):
            continue
        rec = dict(zip(flds, sr.record))
        if pred and not pred(rec):
            continue
        g = shape(sr.shape.__geo_interface__)
        if not g.is_valid:
            g = g.buffer(0)
        g = g.intersection(BBOX)
        if g.is_empty:
            continue
        out.append((rec, shp_transform(fwd, g)))
    return out


print('reading vectors...', flush=True)
countries = read_shapes('ne_10m_admin_0_countries.shp')
canada = unary_union([g for rec, g in countries if rec['ADMIN'] == 'Canada'])
foreign = unary_union([g for rec, g in countries if rec['ADMIN'] != 'Canada'])
greenland = unary_union([g for rec, g in countries if rec['ADMIN'] == 'Greenland'])
alaska = unary_union([g for rec, g in read_shapes('ne_10m_admin_1_states_provinces.shp', lambda r: r['name'] == 'Alaska')])
alaska = alaska.intersection(shp_transform(fwd, box(-168, 50, -125, 75)))  # drop the outer Aleutians
# GSHHG full-resolution shoreline: L1 land, L2 lakes, L3 islands in lakes, L4 ponds on those islands
gl1 = [g for _, g in read_shapes('GSHHS_f_L1.shp', folder=GSHHG)]
lakes = [g for _, g in read_shapes('GSHHS_f_L2.shp', folder=GSHHG)]
gl3 = [g for _, g in read_shapes('GSHHS_f_L3.shp', folder=GSHHG)]
gl4 = [g for _, g in read_shapes('GSHHS_f_L4.shp', folder=GSHHG)]
print(f'gshhg land={len(gl1)} lakes={len(lakes)} islands-in-lakes={len(gl3)} ponds={len(gl4)}', flush=True)
# major rivers everywhere (Columbia, Yukon, Niagara, Mississippi... cross impassable land to the sea), plus more inside Canada
rivers_all = read_shapes('ne_10m_rivers_lake_centerlines.shp', lambda r: r['scalerank'] <= args.rivers + 1)
rivers = [g for rec, g in rivers_all if rec['scalerank'] <= args.rivers or g.intersects(canada)]
river_union = unary_union(rivers) if rivers else None
print(f'lakes={len(lakes)} rivers={len(rivers)}', flush=True)

minx, miny, maxx, maxy = unary_union([canada, greenland, alaska]).bounds
m = args.margin_km * 1000
minx -= m; miny -= m; maxx += m; maxy += m
aspect = (maxx - minx) / (maxy - miny)
print(f'frame km: {(maxx-minx)/1000:.0f} x {(maxy-miny)/1000:.0f}  aspect {aspect:.3f}', flush=True)

dem = rasterio.open(DEM)


def build(width):
    width -= width % 4
    height = int(round(width / aspect)); height -= height % 4
    res = (maxx - minx) / width
    tr = from_origin(minx, maxy, res, (maxy - miny) / height)
    SS = args.ss  # supersample: rasterize the shoreline per sub-pixel, then majority vote -> crisp coasts
    trs = from_origin(minx, maxy, res / SS, (maxy - miny) / height / SS)

    def rz(geoms, scale=1):
        t = tr if scale == 1 else trs
        if not geoms:
            return np.zeros((height * scale, width * scale), dtype=bool)
        return rasterize([(g, 1) for g in geoms], out_shape=(height * scale, width * scale), transform=t, fill=0, dtype='uint8').astype(bool)

    blocks = lambda a: a.reshape(height, SS, width, SS)

    # --- shoreline from GSHHG: land minus lakes plus islands-in-lakes minus ponds, at sub-pixel resolution ---
    land_s = rz(gl1, SS)
    land_s &= ~rz([ICELAND], SS)  # Iceland is rendered as open water
    lake_s = rz(lakes, SS)
    land_s &= ~lake_s
    land_s |= rz(gl3, SS)
    land_s &= ~rz(gl4, SS)
    land_frac = blocks(land_s.astype('float32')).mean(axis=(1, 3))
    lake_frac = blocks(lake_s.astype('float32')).mean(axis=(1, 3))
    del lake_s

    # --- elevation (mean over the land sub-pixels) ---
    elev_s = np.full((height * SS, width * SS), -9999, dtype='float32')
    reproject(rasterio.band(dem, 1), elev_s, dst_transform=trs, dst_crs=LCC, src_crs='EPSG:4326',
              resampling=Resampling.bilinear, dst_nodata=-9999)
    valid = land_s & (elev_s > -9000)
    elev = blocks(np.where(valid, elev_s, 0)).sum(axis=(1, 3)) / np.maximum(blocks(valid).sum(axis=(1, 3)), 1)
    elev = np.where(land_frac > 0, elev, -1)
    del elev_s, valid, land_s

    is_land = land_frac >= 0.5
    is_lake = lake_frac >= 0.5

    # --- nationality: nearest polygon wins (Canada first on ties), so islands missing from the
    # Natural Earth outline still belong to whichever coast they lie off ---
    nat = np.zeros((height, width), dtype='uint8')  # 1 = Canada, 2 = foreign
    for km in (0, 3, 8, 15, 30, 60, 120):
        ca = rz([canada.buffer(km * 1000)]) if km else rz([canada])
        fo = rz([foreign.buffer(km * 1000)]) if km else rz([foreign])
        nat[(nat == 0) & ca] = 1
        nat[(nat == 0) & fo] = 2
        del ca, fo
    nat[nat == 0] = 1
    in_canada = nat == 1

    # lakes: all inside Canada; outside only those touching Canada (Great Lakes...) or on a drawn river
    from shapely import prepared
    pc = prepared.prep(canada.buffer(3000))
    pr = prepared.prep(river_union.buffer(res)) if river_union is not None else None
    keep = [g for g in lakes if pc.intersects(g) or (pr is not None and pr.intersects(g))]
    lake_m = (is_lake & in_canada) | rz(keep)
    river_m = rz([g.buffer(res * 1.1) for g in rivers]) if rivers else np.zeros_like(in_canada)
    land = is_land & in_canada & ~river_m
    black = (is_land | is_lake) & ~in_canada & ~lake_m & ~river_m
    return width, height, res, tr, elev, land, black


if args.width:
    W = args.width
else:
    w0 = 800
    _, h0, _, _, _, land0, _ = build(w0)
    f = land0.sum() / (w0 * h0)
    W = int(math.sqrt(args.target_land / f * aspect))
    print(f'land fraction {f:.3f} -> width {W}', flush=True)

width, height, res, tr, elev, land, black = build(W)
print(f'final {width}x{height} = {width*height/1e6:.2f} Mpx, res {res/1000:.2f} km/px, '
      f'land {land.sum()/1e6:.3f} M, black {black.sum()/1e6:.2f} M', flush=True)

# --- magnitude: smoothed elevation + relief over a wide window, then a majority filter so ranges are coherent ---
from PIL import ImageFilter
KM = 1000 / res  # pixels per km


def box_blur(a, radius_km):
    """separable box mean of radius r px (edge-replicated), via cumulative sums"""
    r = max(1, int(round(radius_km * KM)))
    out = a.astype('float32')
    for axis in (1, 0):
        p = np.pad(out, [(0, 0), (r + 1, r)] if axis == 1 else [(r + 1, r), (0, 0)], mode='edge')
        c = np.cumsum(p, axis=axis, dtype='float64')
        n = p.shape[axis]
        if axis == 1:
            out = ((c[:, 2 * r + 1:n] - c[:, 0:n - 2 * r - 1]) / (2 * r + 1)).astype('float32')
        else:
            out = ((c[2 * r + 1:n, :] - c[0:n - 2 * r - 1, :]) / (2 * r + 1)).astype('float32')
        del p, c
    return out


def range_filter(a, half_km, mask=None):
    """max - min over a (2h+1)^2 window, separable. With a mask, only pixels where mask is True take part,
    so water (height 0) never makes a shore look like a cliff."""
    h = max(1, int(round(half_km * KM)))
    if mask is None:
        mx = a.copy(); mn = a.copy()
    else:
        mx = np.where(mask, a, -1e9).astype('float32'); mn = np.where(mask, a, 1e9).astype('float32')
    for axis in (1, 0):
        base_mx, base_mn = mx.copy(), mn.copy()
        for s in range(1, h + 1):
            for sh in (s, -s):
                mx = np.maximum(mx, np.roll(base_mx, sh, axis=axis))
                mn = np.minimum(mn, np.roll(base_mn, sh, axis=axis))
    return mx - mn


surf = np.maximum(elev, 0).astype('float32')  # lakes keep their surface height in ETOPO: no false ring on shores
if args.smooth:
    E_smooth = box_blur(surf, 3)
    relief = box_blur(range_filter(box_blur(surf, 1), 4.5), 2.5)
    v_elev = np.interp(E_smooth, [0, 150, 400, 800, 1300, 2200, 3500], [140, 145, 150, 157, 166, 184, 200])
    v_rel = np.interp(relief, [0, 250, 500, 900, 1500], [140, 150, 165, 185, 200])
    v = np.maximum(v_elev, v_rel)
    cls = np.where(v >= 179, 2, np.where(v >= 159, 1, 0)).astype('uint8')
    counts = np.stack([box_blur((cls == k).astype('float32'), 2) for k in range(3)])
    cls = counts.argmax(axis=0).astype('uint8')
    lo = np.choose(cls, [140, 159, 179]).astype('float32'); hi = np.choose(cls, [158, 178, 200]).astype('float32')
    v = np.clip(v, lo, hi)
    del E_smooth, counts, lo, hi
else:
    # crisp: per-pixel relief over the 3x3 neighbourhood (~3 km at 1 km/px), no blur, no majority vote.
    # Each pixel's height is already the mean of its sub-samples, so this follows ridges and valleys without speckle.
    relief = range_filter(surf, 1.0 / KM, mask=land)  # exactly 1 px half-window, land pixels only
    relief = np.where(land, np.clip(relief, 0, None), 0)
    v_elev = np.interp(surf, [0, 150, 400, 800, 1300, 2200, 3500], [140, 145, 150, 157, 166, 184, 200])
    v_rel = np.interp(relief, [0, 120, 300, 600, 1100], [140, 150, 165, 185, 200])
    v = np.maximum(v_elev, v_rel)
    cls = np.where(v >= 179, 2, np.where(v >= 159, 1, 0)).astype('uint8')
v = np.where(cls == 0, 140 + (v - 140) * 0.5, v)  # flatter plains
v = np.round(v).astype('uint8')
del surf, relief, v_elev, v_rel

img = np.zeros((height, width, 3), dtype='uint8')
img[..., 2] = 106  # water: blue 106
img[land] = np.stack([v[land]] * 3, axis=-1)
img[black] = 0
Image.fromarray(img, 'RGB').save(os.path.join(OUT, 'image.png'), optimize=True)

# preview: colour-coded, downscaled
pv = np.zeros_like(img)
pv[...] = (40, 80, 160)
plains = land & (v < 159); high = land & (v >= 159) & (v < 179); mtn = land & (v >= 179)
pv[plains] = (120, 170, 90); pv[high] = (200, 180, 120); pv[mtn] = (235, 235, 235); pv[black] = (20, 20, 20)
np.save(os.path.join(OUT, 'land.npy'), land)


# --- nation candidates: project lat/lon to pixel ---
def px(lon, lat):
    x, y = fwd(lon, lat)
    c, r = ~tr * (x, y)
    return [int(round(c)), int(round(r))]


NATIONS = [  # name, lat, lon, flag (None = no flag yet)
    ('British Columbia', 48.43, -123.35, 'britishcolumbia'),   # Victoria
    ('Alberta', 53.55, -113.50, 'alberta'),                    # Edmonton
    ('Saskatchewan', 50.45, -104.62, 'saskatchewan'),          # Regina
    ('Manitoba', 49.88, -97.17, 'manitoba'),                   # Winnipeg
    ('Ontario', 43.70, -79.42, 'ontario'),                     # Toronto
    ('Quebec', 46.84, -71.25, 'Quebec'),                       # Quebec City
    ('New Brunswick', 45.95, -66.63, 'newbrunswick'),          # Fredericton
    ('Nova Scotia', 44.65, -63.60, 'novascotia'),              # Halifax
    ('Prince Edward Island', 46.24, -63.13, 'princeedwardisland'),  # Charlottetown
    ('Newfoundland and Labrador', 47.58, -52.68, 'newfoundlandandlabrador'),  # St. John's
    ('Yukon', 60.72, -135.05, 'Yukon'),                        # Whitehorse
    ('Northwest Territories', 62.45, -114.37, 'northwestterritories'),  # Yellowknife
    ('Nunavut', 63.75, -68.52, 'Nunavut'),                     # Iqaluit
    ('Canada', 45.42, -75.70, 'ca'),                           # Ottawa
    ('Metis', 52.74, -106.11, 'Metis'),                        # Batoche
    ('Haida', 53.25, -132.07, 'haida_flag'),                   # Haida Gwaii (Skidegate)
    ('Inuvialuit', 68.36, -133.72, None),                      # Inuvik
    ('Nunavik', 58.10, -68.40, None),                          # Kuujjuaq
    ('Nunatsiavut', 56.54, -61.69, None),                      # Nain
    ('Cree', 53.79, -78.90, None),                             # Chisasibi (Eeyou Istchee)
    ('Innu', 50.21, -66.38, None),                             # Sept-Iles / Uashat
    ("Mi'kmaq", 46.14, -60.19, None),                          # Cape Breton (Membertou)
    ('Haudenosaunee', 43.07, -80.12, None),                    # Six Nations of the Grand River
    ('Anishinaabe', 46.52, -84.33, None),                      # Sault Ste. Marie / Garden River
    ('Dene', 61.86, -121.35, None),                            # Fort Simpson (Dehcho)
    ('Blackfoot', 50.55, -113.09, None),                       # Siksika
    ("Gwich'in", 67.44, -134.88, None),                        # Fort McPherson
    ('Tlingit', 60.17, -132.72, None),                         # Teslin
    ("Nisga'a", 55.10, -129.08, None),                         # New Aiyansh
    ('Secwepemc', 50.67, -120.33, None),                       # Kamloops
    ('Nuu-chah-nulth', 49.15, -125.90, None),                  # Tofino
    ("Kwakwaka'wakw", 50.60, -127.08, None),                   # Alert Bay
    ('Wolastoqiyik', 46.10, -67.00, None),                     # Tobique / Woodstock area
    ('Atikamekw', 47.43, -72.78, None),                        # La Tuque / Wemotaci
    ('Oji-Cree', 53.07, -93.34, None),                         # Sandy Lake
    ('Nakoda', 51.18, -115.00, None),                          # Morley (Stoney)
    ('Kitikmeot Inuit', 69.12, -105.06, None),                 # Cambridge Bay
    ('Kivalliq Inuit', 62.81, -92.09, None),                   # Rankin Inlet
]
nations = []
for name, lat, lon, flag in NATIONS:
    c, r = px(lon, lat)
    on_land = bool(0 <= r < height and 0 <= c < width and land[r, c])
    if not on_land:  # nudge to the nearest land pixel within 8 px
        best = None
        for dr in range(-8, 9):
            for dc in range(-8, 9):
                rr, cc = r + dr, c + dc
                if 0 <= rr < height and 0 <= cc < width and land[rr, cc]:
                    d = dr * dr + dc * dc
                    if best is None or d < best[0]:
                        best = (d, rr, cc)
        if best:
            r, c = best[1], best[2]; on_land = True
    n = {'coordinates': [c, r], 'name': name}
    if flag:
        n['flag'] = flag
    n['_on_land'] = on_land
    nations.append(n)
json.dump(nations, open(os.path.join(OUT, 'nations.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
for n in nations:  # red dots on the preview (half scale)
    c, r = n['coordinates']
    pv[max(0, r - 8):r + 9, max(0, c - 8):c + 9] = (255, 0, 0)
Image.fromarray(pv, 'RGB').save(os.path.join(OUT, 'preview.png'))  # full resolution
print('nations off land:', [n['name'] for n in nations if not n['_on_land']])


def nearest_land(c, r, radius=6):
    if 0 <= r < height and 0 <= c < width and land[r, c]:
        return c, r
    best = None
    for dr in range(-radius, radius + 1):
        for dc in range(-radius, radius + 1):
            rr, cc = r + dr, c + dc
            if 0 <= rr < height and 0 <= cc < width and land[rr, cc]:
                d = dr * dr + dc * dc
                if best is None or d < best[0]:
                    best = (d, cc, rr)
    return (best[1], best[2]) if best else None


# --- tribes = Canadian cities, placed at their real location ---
pp = shapefile.Reader(os.path.join(NE, 'ne_10m_populated_places.shp'))
pf = [f[0] for f in pp.fields[1:]]
cities = [dict(zip(pf, r)) for r in pp.records()]
cities = [c for c in cities if c['ADM0NAME'] == 'Canada']
cities.sort(key=lambda c: -c['POP_MAX'])
nation_px = {tuple(n['coordinates']) for n in nations}
nation_names = {n['name'] for n in nations}
tribes, seen = [], set()
for c in cities:
    name = c['NAME']
    if name in seen or name in nation_names:
        continue
    pos = nearest_land(*px(c['LONGITUDE'], c['LATITUDE']))
    if pos is None:
        continue
    # keep tribes at least 12 px from any nation spawn or other tribe
    if any((pos[0] - x) ** 2 + (pos[1] - y) ** 2 < 12 * 12 for x, y in nation_px):
        continue
    nation_px.add(pos); seen.add(name)
    tribes.append({'name': name, 'coordinates': [pos[0], pos[1]]})
    if len(tribes) >= 60:
        break
print('tribes:', len(tribes), [t['name'] for t in tribes[:12]], '...')

info = {
    '$schema': '../../../info.schema.json',
    'id': 'Canada',
    'name': 'Canada',
    'translation_key': 'map.canada',
    'categories': ['north_america', 'countries'],
    'location': {'lat': 60, 'lon': -95},
    'author': 'cazlabIO',
    'description': 'Canada from the Great Lakes to Ellesmere Island, with Alaska, Greenland and the United States as impassable terrain.',
    'themes': ['north_america'],
    'nations': [{k: v for k, v in n.items() if k != '_on_land'} for n in nations],
    'custom_tribes': tribes,
}
json.dump(info, open(os.path.join(OUT, 'info.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
print('done')
