"""
Amenity Benchmark — FastAPI backend.

The only server-side responsibility is hiding the Google AI API key and
running the Gemini prompt that turns a free-form user category like
"boutique design district" into:
  • a flexible list of representative benchmark locations worldwide
  • a context-appropriate set of amenity groups

All OSM data fetching (Nominatim + Overpass) still happens in the browser.

Deployment on Render:
  - Build:  pip install -r requirements.txt
  - Start:  uvicorn app:app --host 0.0.0.0 --port $PORT
  - Env:    GOOGLE_AI_API_KEY (mandatory)
"""

import json
import os

import google.generativeai as genai
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from amenity_config import AMENITY_VOCABULARY, DEFAULT_GROUPS

load_dotenv()

# ── Setup ─────────────────────────────────────────────────────────────────────

app = FastAPI(title="Amenity Benchmark")

GOOGLE_AI_KEY = os.getenv("GOOGLE_AI_API_KEY", "")
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-1.5-flash")

if GOOGLE_AI_KEY:
    genai.configure(api_key=GOOGLE_AI_KEY)


# ── Schema ────────────────────────────────────────────────────────────────────


class SuggestRequest(BaseModel):
    category: str
    num_locations: int = Field(default=15, ge=4, le=30)


# ── Prompt ────────────────────────────────────────────────────────────────────


PALETTE = [
    "#E69F00", "#D55E00", "#56B4E9", "#009E73", "#CC79A7",
    "#0072B2", "#F0E442", "#44AA99", "#7c3aed", "#db2777",
    "#65a30d", "#ea580c",
]


def build_prompt(category: str, num_locations: int) -> str:
    vocab_str = ", ".join(sorted(AMENITY_VOCABULARY))
    palette_str = ", ".join(PALETTE)

    return f"""You are an urban planning analyst helping benchmark amenity ecosystems.

The user wants to benchmark this location type: "{category}"

Produce a JSON response with TWO parts.

═══ PART 1 — LOCATIONS ═══
List exactly {num_locations} representative real-world locations that genuinely exemplify "{category}".
Pick well-known, data-rich places spread across continents where OpenStreetMap coverage is reliable.
Prefer district / neighbourhood / borough granularity over whole cities (so the boundary is tight enough
to make the amenity count meaningful).

For each location, provide:
  - name:         short display name, 1–3 words
  - search_query: a precise Nominatim search string that resolves to an administrative boundary
                  (include city + country at minimum; add district/admin level when it disambiguates)
  - city:         city name
  - country:      country name
  - description:  one sentence saying why this is a good benchmark for "{category}"

═══ PART 2 — AMENITY GROUPS ═══
Define 6–9 amenity groups that are MEANINGFUL specifically for "{category}".
The groups should reflect what these locations TYPICALLY CONTAIN, not generic shop categories.

Examples to follow the spirit of (do NOT copy verbatim — invent the right ones for "{category}"):
  • For a ski resort:   "Mountain Sports", "Après-Ski", "Alpine Dining", "Equipment & Rental", "Resort Wellness"
  • For a CBD:          "Corporate Dining", "Professional Services", "After-Work Bars", "Convenience Retail"
  • For a beach resort: "Beachfront Dining", "Water Sports", "Resort Boutiques", "Spa & Wellness"
  • For a historic centre: "Tourist Dining", "Cultural Venues", "Heritage Retail", "Local Services"

Hard rules:
  - Every group name should be 2–4 words, in English title case.
  - Every group has a distinct hex color drawn from this palette: {palette_str}
  - Assign EVERY amenity from the vocabulary below to EXACTLY ONE group. No duplicates, no omissions.
  - If you cannot find a meaningful group for an amenity, put it in a final group named "Other Services".
  - The group order should reflect importance for "{category}" (most defining first).

OSM amenity / shop vocabulary (assign ALL of these — every value must appear exactly once):
{vocab_str}

═══ OUTPUT ═══
Return ONLY valid JSON with this exact structure. No prose, no markdown:

{{
  "locations": [
    {{
      "name": "...",
      "search_query": "...",
      "city": "...",
      "country": "...",
      "description": "..."
    }}
  ],
  "groups": [
    {{
      "name": "Group Name",
      "color": "#hexcode",
      "items": ["amenity1", "amenity2"],
      "description": "what this group captures"
    }}
  ]
}}
"""


# ── Routes ────────────────────────────────────────────────────────────────────


@app.post("/api/suggest")
async def suggest(req: SuggestRequest):
    """Generate AI-driven benchmark locations + dynamic amenity groups."""
    if not GOOGLE_AI_KEY:
        raise HTTPException(503, "GOOGLE_AI_API_KEY not configured on the server")

    model = genai.GenerativeModel(
        GEMINI_MODEL,
        generation_config={
            "response_mime_type": "application/json",
            "temperature": 0.4,
        },
    )

    try:
        response = model.generate_content(build_prompt(req.category, req.num_locations))
    except Exception as exc:
        raise HTTPException(502, f"Gemini API error: {exc}") from exc

    raw = (response.text or "").strip()
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise HTTPException(500, f"AI returned invalid JSON: {exc}. Raw: {raw[:400]}") from exc

    locations = data.get("locations", [])
    groups = data.get("groups", [])
    if not locations or not groups:
        raise HTTPException(500, "AI response missing 'locations' or 'groups'")

    # Sanity-pass the groups: clamp to vocabulary, fill anything the AI missed
    seen = set()
    cleaned_groups = []
    for g in groups:
        items = [i for i in g.get("items", []) if i in AMENITY_VOCABULARY and i not in seen]
        seen.update(items)
        if items:
            cleaned_groups.append({
                "name": g.get("name", "Group"),
                "color": g.get("color", "#999999"),
                "items": items,
                "description": g.get("description", ""),
            })

    missing = AMENITY_VOCABULARY - seen
    if missing:
        cleaned_groups.append({
            "name": "Other Services",
            "color": "#999999",
            "items": sorted(missing),
            "description": "Amenities not strongly associated with this location type",
        })

    return {"locations": locations, "groups": cleaned_groups}


@app.get("/api/defaults")
async def defaults():
    """Return the fallback group schema for non-AI modes."""
    return {"groups": DEFAULT_GROUPS}


@app.get("/api/health")
async def health():
    return {"ok": True, "ai_configured": bool(GOOGLE_AI_KEY), "model": GEMINI_MODEL}


# ── Static frontend ───────────────────────────────────────────────────────────


@app.get("/")
async def index():
    return FileResponse("docs/index.html")


# Serve everything under docs/ at the root path (style.css, app.js, etc.)
app.mount("/", StaticFiles(directory="docs"), name="static")
