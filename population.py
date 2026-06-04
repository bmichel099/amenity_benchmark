"""
Population-estimate tool — zonal statistics over the GHSL population raster.

The heavy GHS-POP 100m raster is NEVER bundled with the app. It lives as a
Cloud-Optimized GeoTIFF (COG) on object storage (e.g. Cloudflare R2) and is read
lazily over HTTP range requests via GDAL's /vsicurl. A query over a small polygon
only downloads the few KB of raster window it overlaps.

Configure with the GHSL_RASTER_URL environment variable, e.g.:
    GHSL_RASTER_URL=https://<bucket>.r2.dev/ghs_pop_2025_cog.tif

GHS-POP pixel values are population counts per cell, so the population inside a
polygon is the (area-weighted) sum of the cells it covers. exactextract handles
partial-edge-pixel coverage exactly.
"""

import io
import os
import tempfile
import zipfile
from functools import lru_cache

import geopandas as gpd
import rasterio
from exactextract import exact_extract
from shapely.geometry import shape

# GDAL tuning for fast remote COG reads
os.environ.setdefault("GDAL_DISABLE_READDIR_ON_OPEN", "EMPTY_DIR")
os.environ.setdefault("CPL_VSIL_CURL_ALLOWED_EXTENSIONS", ".tif,.tiff")
os.environ.setdefault("VSI_CACHE", "TRUE")
os.environ.setdefault("GDAL_HTTP_MULTIRANGE", "YES")
os.environ.setdefault("GDAL_HTTP_MERGE_CONSECUTIVE_RANGES", "YES")

GHSL_RASTER_URL = os.getenv("GHSL_RASTER_URL", "")

WGS84           = "EPSG:4326"
MOLLWEIDE       = "ESRI:54009"   # native GHSL CRS — used as fallback when raster unreachable


def raster_configured() -> bool:
    return bool(GHSL_RASTER_URL)


def _vsi_path(url: str) -> str:
    """Wrap a remote URL for GDAL's virtual file system."""
    if url.startswith(("http://", "https://")):
        return f"/vsicurl/{url}"
    return url  # local path (dev)


@lru_cache(maxsize=1)
def _raster_crs() -> str:
    """The raster's native CRS read from the COG header."""
    with rasterio.open(_vsi_path(GHSL_RASTER_URL)) as ds:
        return ds.crs.to_string()


def _ea_crs() -> str:
    """Equal-area CRS for buffering / area calculation."""
    if raster_configured():
        try:
            return _raster_crs()
        except Exception:
            pass
    return MOLLWEIDE


def estimate_population(features: list[dict]) -> dict:
    """
    features: list of GeoJSON-ish dicts, each:
        { "id": <any>, "name": <str>, "geometry": <GeoJSON geometry>,
          "buffer_km": <float|None> }
    A non-null buffer_km buffers the geometry (used for points / circle buffers).

    Returns: { "results": [ {id, name, population, area_km2} ], "total": <float> }
    """
    if not raster_configured():
        raise RuntimeError("GHSL_RASTER_URL not configured on the server")
    if not features:
        return {"results": [], "total": 0.0}

    geoms, meta = [], []
    for f in features:
        geom = f.get("geometry")
        if not geom:
            continue
        geoms.append(shape(geom))
        meta.append({
            "id": f.get("id"),
            "name": f.get("name") or "Area",
            "buffer_km": f.get("buffer_km"),
        })

    if not geoms:
        return {"results": [], "total": 0.0}

    gdf = gpd.GeoDataFrame({"_i": range(len(geoms))}, geometry=geoms, crs=WGS84)

    # Reproject into the raster's equal-area CRS, then buffer (metres) where asked.
    gdf = gdf.to_crs(_ea_crs())
    for i, m in enumerate(meta):
        bkm = m.get("buffer_km")
        if bkm:
            gdf.loc[gdf["_i"] == i, "geometry"] = gdf.loc[gdf["_i"] == i, "geometry"].buffer(float(bkm) * 1000.0)

    # Area (km²) in the equal-area CRS
    areas_km2 = (gdf.geometry.area / 1_000_000.0).tolist()

    with rasterio.open(_vsi_path(GHSL_RASTER_URL)) as ds:
        df = exact_extract(ds, gdf, ["sum"], output="pandas")

    # Column is usually "sum" but some versions prefix the band ("band_1_sum")
    sum_col = next((c for c in df.columns if str(c).endswith("sum")), None)
    if sum_col is None:
        raise RuntimeError(f"exactextract returned no sum column (got {list(df.columns)})")
    sums = df[sum_col].tolist()

    results, total = [], 0.0
    for m, s, a in zip(meta, sums, areas_km2):
        pop = max(0.0, float(s or 0.0))
        total += pop
        results.append({
            "id": m["id"],
            "name": m["name"],
            "population": round(pop),
            "area_km2": round(a, 3),
        })

    return {"results": results, "total": round(total)}


def parse_shapefile(zip_bytes: bytes) -> dict:
    """
    Parse an uploaded zipped shapefile (or zipped GeoJSON/GeoPackage).
    Returns { "geojson": <FeatureCollection>, "geometry_type": "point"|"polygon" }
    with geometries reprojected to WGS84 for display/drawing.
    """
    with tempfile.TemporaryDirectory() as tmp:
        zpath = os.path.join(tmp, "upload.zip")
        with open(zpath, "wb") as fh:
            fh.write(zip_bytes)

        # Find the first vector layer inside the archive
        with zipfile.ZipFile(zpath) as zf:
            names = zf.namelist()
        inner = next((n for n in names if n.lower().endswith((".shp", ".geojson", ".json", ".gpkg"))), None)
        if not inner:
            raise ValueError("No .shp, .geojson or .gpkg found inside the archive")

        gdf = gpd.read_file(f"/vsizip/{zpath}/{inner}")

    if gdf.crs is None:
        gdf = gdf.set_crs(WGS84)        # assume lon/lat if the .prj is missing
    gdf = gdf.to_crs(WGS84)

    gtypes = set(gdf.geom_type.str.replace("Multi", "", regex=False).unique())
    geometry_type = "point" if gtypes <= {"Point"} else "polygon"

    return {
        "geojson": gdf.__geo_interface__,
        "geometry_type": geometry_type,
        "feature_count": int(len(gdf)),
    }


def export_shapefile(features: list[dict], results: list[dict]) -> bytes:
    """
    Build a GeoDataFrame from features (applying buffers where buffer_km is set),
    append population results, and return a zipped shapefile as bytes.
    Works even when the raster is not configured (population columns will be null).
    """
    if not features:
        raise ValueError("No features to export")

    results_by_id = {r["id"]: r for r in results}

    geoms, rows = [], []
    for f in features:
        geom = f.get("geometry")
        if not geom:
            continue
        geoms.append(shape(geom))
        rows.append({
            "name":       f.get("name") or "Area",
            "buffer_km":  f.get("buffer_km"),
        })

    gdf = gpd.GeoDataFrame(rows, geometry=geoms, crs=WGS84)

    # Buffer points into polygons (circles + point shapefiles) in equal-area CRS
    ea = _ea_crs()
    gdf_ea = gdf.to_crs(ea)
    for i, f in enumerate(features[:len(geoms)]):
        bkm = f.get("buffer_km")
        if bkm:
            gdf_ea.at[i, "geometry"] = gdf_ea.geometry.iloc[i].buffer(float(bkm) * 1000.0)

    # Area in equal-area CRS, then bring back to WGS84 for the exported file
    gdf_ea["area_km2"] = (gdf_ea.geometry.area / 1_000_000.0).round(3)
    gdf = gdf_ea.to_crs(WGS84)

    # Append population results (null where estimate hasn't been run)
    feat_ids = [f.get("id") for f in features[:len(geoms)]]
    gdf["population"] = [
        results_by_id[fid]["population"] if fid in results_by_id else None
        for fid in feat_ids
    ]
    # density column (people / km²) — null if either value missing
    gdf["density"] = [
        round(row["population"] / row["area_km2"])
        if row["population"] is not None and row["area_km2"] > 0 else None
        for _, row in gdf.iterrows()
    ]

    # Write to in-memory zip
    with tempfile.TemporaryDirectory() as tmp:
        shp_path = os.path.join(tmp, "population_estimate.shp")
        gdf.to_file(shp_path)

        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w", compression=zipfile.ZIP_DEFLATED) as zf:
            for fname in os.listdir(tmp):
                zf.write(os.path.join(tmp, fname), fname)
        return buf.getvalue()
