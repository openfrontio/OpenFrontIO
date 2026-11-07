"""Download one lon/lat window of the ETOPO 2022 30s GeoTIFF (remote tiled read) into data/etopo_canada_30s.tif."""
import sys, os, time
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), 'pylibs'))
import rasterio, numpy as np
from rasterio.windows import from_bounds
u='/vsicurl/https://www.ngdc.noaa.gov/mgg/global/relief/ETOPO2022/data/30s/30s_surface_elev_gtif/ETOPO_2022_v1_30s_N90W180_surface.tif'
t=time.time()
with rasterio.open(u) as ds:
    win=from_bounds(-170, 40, -10, 84, ds.transform)
    win=win.round_offsets().round_lengths()
    print('window', win, flush=True)
    arr=ds.read(1, window=win)
    tr=ds.window_transform(win)
    print('read', arr.shape, arr.dtype, arr.min(), arr.max(), f'{time.time()-t:.0f}s', flush=True)
    prof=ds.profile.copy()
prof.update(width=arr.shape[1], height=arr.shape[0], transform=tr, dtype='int16', nodata=None, compress='deflate', tiled=True, blockxsize=256, blockysize=256)
with rasterio.open('data/etopo_canada_30s.tif','w',**prof) as out:
    out.write(np.round(arr).astype('int16'), 1)
print('saved', os.path.getsize('data/etopo_canada_30s.tif')//1e6, 'MB', f'{time.time()-t:.0f}s')
