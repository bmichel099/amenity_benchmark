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

WGS84     = "EPSG:4326"
MOLLWEIDE = "ESRI:54009"   # native GHSL CRS — used as fallback when raster unreachable

# Unit conversions
M_PER_KM   = 1000.0
M2_PER_KM2 = 1_000_000.0

# Upload guards — large shapefiles would exhaust memory / request timeouts
MAX_UPLOAD_FEATURES = 50
MAX_UPLOAD_BYTES    = 20 * 1024 * 1024   # 20 MB zip

# ESRI .shx index format: fixed 100-byte header, then one 8-byte record per feature
SHX_HEADER_BYTES     = 100
SHX_BYTES_PER_RECORD = 8


def raster_configured() -> bool:
    """True when a GHSL raster URL is set in the environment."""
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


def _features_to_gdf(features: list[dict]) -> tuple[gpd.GeoDataFrame, list[dict]]:
    """
    Build a WGS84 GeoDataFrame from GeoJSON-ish feature dicts, skipping any
    without geometry. Returns (gdf, meta) where meta is a parallel list of
    {id, name, buffer_km} per row.
    """
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
    gdf = gpd.GeoDataFrame(geometry=geoms, crs=WGS84)
    return gdf, meta


def _apply_buffers(gdf: gpd.GeoDataFrame, meta: list[dict]) -> gpd.GeoDataFrame:
    """Buffer rows (metres) where buffer_km is set. gdf must be in an equal-area CRS."""
    for i, m in enumerate(meta):
        bkm = m.get("buffer_km")
        if bkm:
            gdf.at[i, "geometry"] = gdf.geometry.iloc[i].buffer(float(bkm) * M_PER_KM)
    return gdf


def _extract_sums(ds, gdf: gpd.GeoDataFrame) -> list[float]:
    """
    Run exactextract zonal sum over gdf rows.
    Tries the whole batch first; if it fails (e.g. "Never get here" internal
    assert on a bad geometry), falls back to per-row extraction, zeroing out
    individual failures so the rest of the batch still succeeds.
    """
    def _parse(df) -> list[float]:
        sum_col = next((c for c in df.columns if str(c).endswith("sum")), None)
        if sum_col is None:
            raise RuntimeError(f"exactextract returned no sum column: {list(df.columns)}")
        return [max(0.0, float(v or 0.0)) for v in df[sum_col]]

    try:
        return _parse(exact_extract(ds, gdf, ["sum"], output="pandas"))
    except Exception:
        pass  # batch failed — try one row at a time

    sums = []
    for idx in range(len(gdf)):
        try:
            row_df = exact_extract(ds, gdf.iloc[[idx]], ["sum"], output="pandas")
            sums.append(_parse(row_df)[0])
        except Exception:
            sums.append(0.0)
    return sums


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

    gdf, meta = _features_to_gdf(features)
    if not len(gdf):
        return {"results": [], "total": 0.0}

    gdf = gdf.to_crs(_ea_crs())
    gdf = _apply_buffers(gdf, meta)

    # Repair any invalid geometries (self-intersections etc.) that can trigger
    # exactextract's internal assertions on large/diverse polygon sets.
    gdf["geometry"] = gdf.geometry.buffer(0)

    areas_km2 = (gdf.geometry.area / M2_PER_KM2).tolist()

    with rasterio.open(_vsi_path(GHSL_RASTER_URL)) as ds:
        sums = _extract_sums(ds, gdf)

    results, total = [], 0.0
    for m, pop, area in zip(meta, sums, areas_km2):
        total += pop
        results.append({
            "id": m["id"],
            "name": m["name"],
            "population": round(pop),
            "area_km2": round(area, 3),
        })

    return {"results": results, "total": round(total)}


def parse_shapefile(zip_bytes: bytes) -> dict:
    """
    Parse an uploaded zipped shapefile (or zipped GeoJSON/GeoPackage).
    Returns { "geojson": <FeatureCollection>, "geometry_type": "point"|"polygon" }
    with geometries reprojected to WGS84 for display/drawing.

    Raises ValueError for user-correctable problems (size/feature limits,
    missing vector layer).
    """
    if len(zip_bytes) > MAX_UPLOAD_BYTES:
        raise ValueError(
            f"Upload is {len(zip_bytes) // (1024*1024)} MB — the limit is "
            f"{MAX_UPLOAD_BYTES // (1024*1024)} MB. Please clip your data to a "
            "smaller area or reduce the number of features."
        )

    with tempfile.TemporaryDirectory() as tmp:
        zpath = os.path.join(tmp, "upload.zip")
        with open(zpath, "wb") as fh:
            fh.write(zip_bytes)

        # Find the first vector layer inside the archive (handles nested subdirs)
        with zipfile.ZipFile(zpath) as zf:
            names = zf.namelist()

        # Skip Mac OS metadata entries (__MACOSX/…)
        inner = next(
            (n for n in names
             if not n.startswith("__MACOSX")
             and n.lower().endswith((".shp", ".geojson", ".json", ".gpkg"))),
            None,
        )
        if not inner:
            raise ValueError("No .shp, .geojson or .gpkg found inside the archive")

        _check_feature_count_via_shx(zpath, names, inner)

        gdf = gpd.read_file(f"/vsizip/{zpath}/{inner}")

    if len(gdf) > MAX_UPLOAD_FEATURES:
        raise ValueError(
            f"File contains {len(gdf):,} features — the limit is "
            f"{MAX_UPLOAD_FEATURES:,}. Please upload a smaller subset."
        )

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


def _check_feature_count_via_shx(zpath: str, names: list[str], inner: str) -> None:
    """
    Cheap feature-count check before loading any geometry: the .shx index file's
    size encodes the record count, so oversized uploads are rejected without the
    memory cost of reading the .shp itself.
    """
    if not inner.lower().endswith(".shp"):
        return
    shx_name = inner[:-4] + ".shx"
    if shx_name not in names:
        return

    with zipfile.ZipFile(zpath) as zf:
        with zf.open(shx_name) as shx:
            shx_size = len(shx.read())

    if shx_size < SHX_HEADER_BYTES:
        return
    num_feats = (shx_size - SHX_HEADER_BYTES) // SHX_BYTES_PER_RECORD
    if num_feats > MAX_UPLOAD_FEATURES:
        raise ValueError(
            f"File contains {num_feats:,} features — the limit is "
            f"{MAX_UPLOAD_FEATURES:,}. Please upload a smaller subset."
        )


def export_shapefile(features: list[dict], results: list[dict]) -> bytes:
    """
    Build a GeoDataFrame from features (applying buffers where buffer_km is set),
    append population results, and return a zipped shapefile as bytes.
    Works even when the raster is not configured (population columns will be null).
    """
    if not features:
        raise ValueError("No features to export")

    gdf, meta = _features_to_gdf(features)
    if not len(gdf):
        raise ValueError("No features to export")

    gdf["name"]      = [m["name"] for m in meta]
    gdf["buffer_km"] = [m["buffer_km"] for m in meta]

    # Buffer points into polygons (circles + point shapefiles) in equal-area CRS
    gdf_ea = gdf.to_crs(_ea_crs())
    gdf_ea = _apply_buffers(gdf_ea, meta)

    # Area in equal-area CRS, then bring back to WGS84 for the exported file
    gdf_ea["area_km2"] = (gdf_ea.geometry.area / M2_PER_KM2).round(3)
    gdf = gdf_ea.to_crs(WGS84)

    # Append population results (null where estimate hasn't been run)
    results_by_id = {r["id"]: r for r in results}
    gdf["population"] = [
        results_by_id[m["id"]]["population"] if m["id"] in results_by_id else None
        for m in meta
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
