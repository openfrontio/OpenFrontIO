"""Stitch the ETOPO 2022 15s tiles into one int16 GeoTIFF covering lon -180..-10, lat 30..90."""
import sys, os, glob
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, 'pylibs'))
import numpy as np, rasterio
from rasterio.transform import from_origin
from rasterio.windows import Window

tiles = sorted(glob.glob(os.path.join(HERE, 'data', 'etopo15', '*.tif')))
print('tiles', len(tiles))
W, E, S, N = -180.0, 0.0, 30.0, 90.0
res = 15 / 3600
width, height = int(round((E - W) / res)), int(round((N - S) / res))
tr = from_origin(W, N, res, res)
out_path = os.path.join(HERE, 'data', 'etopo15_mosaic.tif')
prof = dict(driver='GTiff', width=width, height=height, count=1, dtype='int16', crs='EPSG:4326', transform=tr,
            tiled=True, blockxsize=512, blockysize=512, compress='deflate', nodata=-32768, BIGTIFF='YES')
with rasterio.open(out_path, 'w', **prof) as dst:
    for t in tiles:
        with rasterio.open(t) as src:
            b = src.bounds
            win = Window(int(round((b.left - W) / res)), int(round((N - b.top) / res)), src.width, src.height)
            data = src.read(1)
            data = np.where(np.isfinite(data), np.round(data), -32768).astype('int16')
            dst.write(data, 1, window=win)
            print(os.path.basename(t), data.shape, '->', (win.col_off, win.row_off), flush=True)
print('wrote', out_path, os.path.getsize(out_path) // 1e6, 'MB')
