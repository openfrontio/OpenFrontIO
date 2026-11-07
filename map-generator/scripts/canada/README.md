# Canada map source pipeline

Regenerates `assets/maps/canada/image.png` and `info.json` from open data.

Inputs (download into `data/` next to these scripts):

- Natural Earth 10m: `admin_0_countries`, `admin_1_states_provinces`, `rivers_lake_centerlines`, `populated_places` (unzip into `data/ne/`)
- GSHHG 2.3.7 shapefiles, full resolution `GSHHS_shp/f/` (unzip into `data/gshhg/`)
- ETOPO 2022 15 arc-second surface GeoTIFF tiles N45..N90 x W180..W015 into `data/etopo15/`, then `python mosaic_etopo15.py`

Python deps (`pip install --target pylibs ...`): numpy pillow rasterio pyproj shapely pyshp

Build at 2 km per pixel: `python -I build_canada.py --width 3428 --ss 4 --rivers 3 --margin-km 20`

Projection: Lambert conformal conic, standard parallels 49/77, central meridian 95W.
Nationality: nearest Natural Earth polygon (Canada wins ties); all non-Canadian land is impassable.
