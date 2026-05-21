"""
Amenity Benchmark — optional local server.

The frontend (index.html / style.css / app.js) is fully static and calls
Nominatim and Overpass directly from the browser, so no backend is needed
for GitHub Pages.  This file simply serves those static files locally so
you don't need a separate HTTP server.

Run:
    uvicorn app:app --reload
or:
    ./run.sh
"""

from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

app = FastAPI(title="Amenity Benchmark")


@app.get("/")
async def index():
    return FileResponse("index.html")


@app.get("/style.css")
async def css():
    return FileResponse("style.css", media_type="text/css")


@app.get("/app.js")
async def js():
    return FileResponse("app.js", media_type="application/javascript")
