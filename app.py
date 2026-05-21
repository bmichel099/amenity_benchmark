"""
Amenity Benchmark — FastAPI backend.

Endpoints:
  POST /api/suggest   → Claude suggests locations for a query
  POST /api/geocode   → Nominatim boundary lookup
  POST /api/amenities → Overpass OSM amenity fetch
  POST /api/diagram   → Build bubble-chart data from amenity list
"""

import asyncio
import json
import os
from pathlib import Path

import anthropic
import httpx
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from amenity_config import AMENITY_TO_GROUP, EXCLUDE, GROUPS

# ── Setup ─────────────────────────────────────────────────────────────────────

app = FastAPI(title="Amenity Benchmark")
app.mount("/static", StaticFiles(directory="static"), name="static")

OVERPASS_URL = "https://overpass-api.de/api/interpreter"
NOMINATIM_URL = "https://nominatim.openstreetmap.org"
ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY", "")

# ── Request models ────────────────────────────────────────────────────────────


class SuggestRequest(BaseModel):
    query: str


class GeocodeRequest(BaseModel):
    search_query: str
    name: str


class AmenitiesRequest(BaseModel):
    locations: list[dict]  # [{osm_id, osm_type, name}]


class DiagramRequest(BaseModel):
    amenities: list[dict]


# ── Routes ────────────────────────────────────────────────────────────────────


@app.get("/")
async def index():
    return FileResponse("static/index.html")


@app.post("/api/suggest")
async def suggest_locations(req: SuggestRequest):
    """Use Claude to suggest representative locations for a location type."""
    if not ANTHROPIC_API_KEY:
        raise HTTPException(503, "ANTHROPIC_API_KEY not configured")

    client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)

    message = client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=1200,
        messages=[
            {
                "role": "user",
                "content": (
                    f'Suggest 8 representative "{req.query}" locations worldwide '
                    "for an amenity benchmarking study.\n\n"
                    "Return ONLY a valid JSON array — no prose, no markdown fences — "
                    "with this exact structure:\n"
                    '[\n  {"name": "display name", "search_query": "precise Nominatim search string", '
                    '"city": "city", "country": "country", "description": "one sentence"}\n]\n\n'
                    "The search_query must be specific enough for Nominatim to return the correct "
                    "administrative boundary (prefer district/neighbourhood/borough level). "
                    "Choose well-known, data-rich examples."
                ),
            }
        ],
    )

    raw = message.content[0].text.strip()
    # Strip markdown code fences if the model added them anyway
    if raw.startswith("```"):
        raw = raw.split("```")[1]
        if raw.startswith("json"):
            raw = raw[4:]
        raw = raw.strip().rstrip("`").strip()

    try:
        locations = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise HTTPException(500, f"Model returned invalid JSON: {exc}") from exc

    return {"locations": locations}


@app.post("/api/geocode")
async def geocode_location(req: GeocodeRequest):
    """Look up the OSM relation ID and boundary polygon via Nominatim."""
    async with httpx.AsyncClient(timeout=20) as client:
        resp = await client.get(
            f"{NOMINATIM_URL}/search",
            params={
                "q": req.search_query,
                "format": "json",
                "limit": 5,
                "polygon_geojson": 1,
                "addressdetails": 1,
            },
            headers={"User-Agent": "AmenityBenchmark/1.0 (bench.michin@gmail.com)"},
        )

    results = resp.json()
    if not results:
        raise HTTPException(404, f"No results for: {req.search_query}")

    # Prefer relation type (administrative boundary) for best polygon quality
    for r in results:
        if r.get("osm_type") == "relation":
            return _nominatim_to_location(r, req.name)

    # Fallback to first result
    return _nominatim_to_location(results[0], req.name)


def _nominatim_to_location(r: dict, display_name: str) -> dict:
    return {
        "osm_id": int(r["osm_id"]),
        "osm_type": r.get("osm_type", "relation"),
        "display_name": r.get("display_name", display_name),
        "geojson": r.get("geojson"),
        "bbox": r.get("boundingbox"),  # [minlat, maxlat, minlon, maxlon]
    }


@app.post("/api/amenities")
async def fetch_amenities(req: AmenitiesRequest):
    """
    Fetch amenities from Overpass for a list of OSM locations.
    Handles both relation and way types.
    """
    if not req.locations:
        return {"amenities": [], "total": 0}

    # Build area selectors
    area_parts = []
    for loc in req.locations:
        osm_id = int(loc["osm_id"])
        osm_type = loc.get("osm_type", "relation")
        if osm_type == "relation":
            area_id = 3_600_000_000 + osm_id
        elif osm_type == "way":
            area_id = 2_400_000_000 + osm_id
        else:
            area_id = 3_600_000_000 + osm_id
        area_parts.append(f"  area(id:{area_id});")

    area_union = "\n".join(area_parts)

    query = (
        "[out:json][timeout:120];\n"
        "(\n"
        f"{area_union}\n"
        ")->.search;\n"
        "(\n"
        '  node["amenity"](area.search);\n'
        '  way["amenity"](area.search);\n'
        '  node["shop"](area.search);\n'
        '  way["shop"](area.search);\n'
        ");\n"
        "out center tags;"
    )

    async with httpx.AsyncClient(timeout=150) as client:
        resp = await client.post(OVERPASS_URL, data={"data": query})

    if resp.status_code != 200:
        raise HTTPException(502, f"Overpass error {resp.status_code}: {resp.text[:200]}")

    elements = resp.json().get("elements", [])

    amenities = []
    for el in elements:
        tags = el.get("tags", {})
        amenity_type = tags.get("amenity") or tags.get("shop")
        if not amenity_type:
            continue
        if amenity_type in EXCLUDE:
            continue
        group = AMENITY_TO_GROUP.get(amenity_type)
        if not group:
            continue

        if el["type"] == "node":
            lat, lon = el.get("lat"), el.get("lon")
        else:
            c = el.get("center", {})
            lat, lon = c.get("lat"), c.get("lon")

        if lat is None or lon is None:
            continue

        amenities.append(
            {
                "type": amenity_type,
                "group": group,
                "lat": lat,
                "lon": lon,
                "name": tags.get("name", ""),
            }
        )

    return {"amenities": amenities, "total": len(amenities)}


@app.post("/api/diagram")
async def build_diagram(req: DiagramRequest):
    """Convert raw amenity list into bubble-chart hierarchy data."""
    if not req.amenities:
        return {"groups": [], "total_amenities": 0}

    counts: dict[str, int] = {}
    for a in req.amenities:
        t = a["type"]
        counts[t] = counts.get(t, 0) + 1

    total = sum(counts.values())

    groups = []
    for gname, gd in GROUPS.items():
        items = []
        for item_type in gd["items"]:
            if item_type in counts:
                items.append(
                    {
                        "id": item_type,
                        "count": counts[item_type],
                        "proportion": counts[item_type] / total,
                    }
                )
        if not items:
            continue

        items.sort(key=lambda x: x["proportion"], reverse=True)
        group_total = sum(i["proportion"] for i in items)
        group_count = sum(i["count"] for i in items)

        groups.append(
            {
                "id": gname,
                "color": gd["color"],
                "total": group_total,
                "total_count": group_count,
                "children": items,
            }
        )

    groups.sort(key=lambda x: x["total"], reverse=True)
    return {"groups": groups, "total_amenities": total}
