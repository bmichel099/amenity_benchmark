# Population Estimate — raster setup (GHSL on Cloudflare R2)

The population tool reads the **GHS-POP 100m (2025)** raster lazily over HTTP
range requests. The raster is **never** committed to git or bundled in the
deploy — it lives as a Cloud-Optimized GeoTIFF (COG) on Cloudflare R2, and the
backend reads only the few KB of window each polygon overlaps via GDAL `/vsicurl`.

## 1. Convert your download to a COG

Keep the native Mollweide CRS (`ESRI:54009`) — GHS-POP pixels are *people per cell*,
so a polygon's population is the area-weighted sum of the cells it covers.

```bash
# GDAL (>= 3.1) — single global file
gdal_translate GHS_POP_E2025_GLOBE_R2023A_54009_100_V1_0.tif ghs_pop_2025_cog.tif \
  -of COG -co COMPRESS=DEFLATE -co PREDICTOR=2 -co BIGTIFF=YES -co NUM_THREADS=ALL_CPUS
```

If GHSL gave you several regional tiles, COG each one and either upload them all
(the app can point at one URL — use a global mosaic) or build a small VRT mosaic
and translate that to one global COG.

## 2. Upload to Cloudflare R2

1. Create an R2 bucket (free tier: 10 GB, no egress fees).
2. Upload `ghs_pop_2025_cog.tif`.
3. Enable public access (R2 → bucket → Settings → Public access, or attach a
   custom domain). You'll get a URL like:
   `https://<hash>.r2.dev/ghs_pop_2025_cog.tif`

R2 supports HTTP range requests, which is all GDAL needs.

> Prefer a **private** bucket? GDAL can read R2's S3-compatible endpoint with
> `/vsis3/`. Set `AWS_S3_ENDPOINT`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`,
> `AWS_VIRTUAL_HOSTING=FALSE` and point `GHSL_RASTER_URL` at `/vsis3/<bucket>/<key>`.

## 3. Configure the server

On Render → Environment, add:

```
GHSL_RASTER_URL = https://<hash>.r2.dev/ghs_pop_2025_cog.tif
```

Redeploy. Verify with `GET /api/health`:

```json
{ "population_available": true, "population_configured": true }
```

That's it — the **Population Estimate** tab can now draw polygons / circle
buffers / upload shapefiles and sum GHSL population inside each.
