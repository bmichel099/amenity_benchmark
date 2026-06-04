'use strict';

// ═══════════════════════════════════════════════════════════════════════════
// POPULATION ESTIMATE TOOL
// Reuses helpers from app.js ($, setStatus, sleep) — population.js loads after.
// ═══════════════════════════════════════════════════════════════════════════

const popState = {
  map:        null,
  inited:     false,
  features:   [],     // {_id,name,type,layer,geometry,buffer_km,population,area_km2,color}
  drawing:    null,   // active editable layer while drawing
  drawMode:   null,   // 'polygon' | 'circle'
  paletteIdx: 0,
  pendingPoints: null, // geojson awaiting a buffer distance
};

const POP_PALETTE = ['#0072B2','#D55E00','#009E73','#CC79A7','#E69F00',
                     '#56B4E9','#7c3aed','#db2777','#65a30d','#ea580c'];

const nf = n => Number(n).toLocaleString();

// ── Boot ────────────────────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
  initTabs();
  bindPopEvents();
});

function initTabs() {
  $('tab-amenity').addEventListener('click',    () => switchTab('amenity'));
  $('tab-population').addEventListener('click', () => switchTab('population'));
}

function switchTab(tab) {
  const amenity = tab === 'amenity';
  $('tab-amenity').classList.toggle('active', amenity);
  $('tab-population').classList.toggle('active', !amenity);
  $('amenity-toolbar').style.display    = amenity ? '' : 'none';
  $('population-toolbar').style.display = amenity ? 'none' : '';
  $('view-amenity').style.display       = amenity ? '' : 'none';
  $('view-population').style.display    = amenity ? 'none' : '';

  if (amenity) {
    setTimeout(() => state.map && state.map.invalidateSize(), 60);
  } else {
    initPopMap();
    setTimeout(() => popState.map && popState.map.invalidateSize(), 60);
  }
}

function initPopMap() {
  if (popState.inited) return;
  popState.inited = true;

  popState.map = L.map('pop-map', {
    center: [20, 0], zoom: 2, worldCopyJump: true, minZoom: 1, editable: true,
  });
  L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
    attribution: '© <a href="https://openstreetmap.org">OSM</a> © <a href="https://carto.com">CARTO</a> · pop. © <a href="https://human-settlement.emergency.copernicus.eu">GHSL</a>',
    subdomains: 'abcd', maxZoom: 19,
  }).addTo(popState.map);

  // Live radius readout while drawing / editing circle buffers
  popState.map.on('editable:drawing:move', e => {
    if (popState.drawMode === 'circle' && popState.drawing?.getRadius)
      showRadius(popState.drawing.getRadius());
  });

  // Warn early if the server can't reach the raster
  fetch('/api/health').then(r => r.json()).then(h => {
    if (!h.population_available)
      $('pop-hint').textContent = 'Population backend unavailable — geospatial dependencies are not installed on the server.';
    else if (!h.population_configured)
      $('pop-hint').textContent = 'GHSL_RASTER_URL is not set on the server — drawing works, but Estimate will fail until the raster is configured.';
  }).catch(() => {});
}

// ── Events ──────────────────────────────────────────────────────────────────
function bindPopEvents() {
  $('pop-draw-polygon-btn').addEventListener('click', popDrawPolygon);
  $('pop-draw-circle-btn').addEventListener('click',  popDrawCircle);
  $('pop-upload-btn').addEventListener('click',       () => $('pop-file-input').click());
  $('pop-file-input').addEventListener('change',      onFileChosen);
  $('pop-cancel-btn').addEventListener('click',       cancelPopDraw);
  $('pop-estimate-btn').addEventListener('click',     popEstimate);
  $('pop-reset-btn').addEventListener('click',        popReset);
  $('pop-download-btn').addEventListener('click',     popDownloadGeoJSON);

  $('buffer-confirm').addEventListener('click', () => {
    const km = parseFloat($('buffer-input').value);
    $('buffer-modal').style.display = 'none';
    if (popState.pendingPoints && km > 0) addGeojsonPoints(popState.pendingPoints, km);
    popState.pendingPoints = null;
  });
  $('buffer-cancel').addEventListener('click', () => {
    $('buffer-modal').style.display = 'none';
    popState.pendingPoints = null;
  });
}

// ── Drawing ─────────────────────────────────────────────────────────────────
function popDrawPolygon() {
  cancelPopDraw();
  popState.drawMode = 'polygon';
  $('pop-cancel-btn').style.display = '';
  setStatus('loading', 'Click the map to place vertices — double-click to finish.');
  popState.map.once('editable:drawing:commit', e => {
    addPopFeature({ type: 'polygon', layer: e.layer, geometry: e.layer.toGeoJSON().geometry, buffer_km: null });
    finishDraw();
  });
  popState.drawing = popState.map.editTools.startPolygon();
}

function popDrawCircle() {
  cancelPopDraw();
  popState.drawMode = 'circle';
  $('pop-cancel-btn').style.display = '';
  setStatus('loading', 'Click to place the centre, move to size the buffer, click again to finish.');
  popState.map.once('editable:drawing:commit', e => {
    const layer = e.layer;
    const c  = layer.getLatLng();
    const km = layer.getRadius() / 1000;
    addPopFeature({
      type: 'circle', layer,
      geometry: { type: 'Point', coordinates: [c.lng, c.lat] },
      buffer_km: km,
    });
    hideRadius();
    finishDraw();
  });
  popState.drawing = popState.map.editTools.startCircle();
}

function finishDraw() {
  popState.drawMode = null;
  popState.drawing  = null;
  $('pop-cancel-btn').style.display = 'none';
  setStatus('idle', `${popState.features.length} area(s) ready — click Estimate population.`);
}

function cancelPopDraw() {
  if (popState.map?.editTools) popState.map.editTools.stopDrawing();
  if (popState.drawing && popState.drawMode) {
    // drawing layer not yet committed → remove it
    if (!popState.features.some(f => f.layer === popState.drawing))
      popState.map.removeLayer(popState.drawing);
  }
  popState.drawing  = null;
  popState.drawMode = null;
  hideRadius();
  $('pop-cancel-btn').style.display = 'none';
}

// ── Radius readout ──────────────────────────────────────────────────────────
function showRadius(metres) {
  const el = $('pop-radius-readout');
  el.style.display = '';
  el.textContent = metres >= 1000
    ? `radius ${(metres / 1000).toFixed(2)} km`
    : `radius ${Math.round(metres)} m`;
}
function hideRadius() { $('pop-radius-readout').style.display = 'none'; }

// ── Shapefile upload ────────────────────────────────────────────────────────
async function onFileChosen(e) {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;

  setStatus('loading', `Parsing ${file.name}…`);
  try {
    const fd = new FormData();
    fd.append('file', file);
    const res = await fetch('/api/shapefile', { method: 'POST', body: fd });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }));
      throw new Error(err.detail || res.statusText);
    }
    const data = await res.json();

    if (data.geometry_type === 'point') {
      popState.pendingPoints = data.geojson;
      $('buffer-count').textContent = `${data.feature_count} point`;
      $('buffer-input').value = '1';
      $('buffer-modal').style.display = 'flex';
      setTimeout(() => $('buffer-input').focus(), 50);
      setStatus('idle', 'Point layer loaded — choose a buffer distance.');
    } else {
      addGeojsonPolygons(data.geojson);
      setStatus('idle', `${data.feature_count} polygon(s) added — click Estimate.`);
    }
  } catch (err) {
    setStatus('error', `Shapefile error: ${err.message}`);
  }
}

function featureName(props, i, prefix) {
  if (props) {
    for (const k of ['name', 'NAME', 'Name', 'label', 'id', 'ID']) {
      if (props[k] != null && String(props[k]).trim()) return String(props[k]);
    }
  }
  return `${prefix} ${i + 1}`;
}

function addGeojsonPolygons(geojson) {
  const feats = geojson.features || [];
  feats.forEach((f, i) => {
    if (!f.geometry) return;
    const layer = L.geoJSON(f.geometry);
    addPopFeature({
      type: 'polygon', layer,
      geometry: f.geometry, buffer_km: null,
      name: featureName(f.properties, i, 'Area'),
    });
  });
  fitPopBounds();
}

function addGeojsonPoints(geojson, km) {
  const feats = geojson.features || [];
  feats.forEach((f, i) => {
    const g = f.geometry;
    if (!g || g.type !== 'Point') return;
    const [lon, lat] = g.coordinates;
    const layer = L.circle([lat, lon], { radius: km * 1000 });
    addPopFeature({
      type: 'circle', layer,
      geometry: { type: 'Point', coordinates: [lon, lat] },
      buffer_km: km,
      name: featureName(f.properties, i, 'Buffer'),
    });
  });
  fitPopBounds();
  setStatus('idle', `${feats.length} buffer(s) added (${km} km) — click Estimate.`);
}

// ── Feature management ──────────────────────────────────────────────────────
function addPopFeature({ type, layer, geometry, buffer_km, name }) {
  const _id   = crypto.randomUUID();
  const color = POP_PALETTE[popState.paletteIdx++ % POP_PALETTE.length];

  layer.setStyle && layer.setStyle({ color, weight: 2, opacity: 0.9, fillColor: color, fillOpacity: 0.15 });
  layer.addTo(popState.map);

  const feat = {
    _id, type, layer, geometry, buffer_km,
    name: name || (type === 'circle' ? `Buffer ${popState.features.length + 1}` : `Area ${popState.features.length + 1}`),
    population: null, area_km2: null, color,
  };

  layer.bindTooltip(feat.name, { permanent: true, direction: 'center', className: 'polygon-label' });

  // Circle buffers stay editable so the radius can be dragged afterwards
  if (type === 'circle' && layer.enableEdit) {
    layer.enableEdit();
    layer.on('editable:editing', () => {
      feat.buffer_km = layer.getRadius() / 1000;
      showRadius(layer.getRadius());
    });
    layer.on('editable:vertex:dragend editable:dragend', () => {
      feat.buffer_km = layer.getRadius() / 1000;
      hideRadius();
    });
  }

  popState.features.push(feat);
  addPopChip(feat);
  showPopButtons();
}

function addPopChip(feat) {
  const bar = $('pop-bar');
  bar.classList.add('visible');

  const chip = document.createElement('div');
  chip.className = 'location-chip selected';
  chip.dataset.id = feat._id;
  chip.innerHTML = `
    <span class="chip-dot" style="background:${feat.color}"></span>
    <span class="chip-name">${feat.name}</span>
    <span class="chip-remove" title="Remove">×</span>
  `;
  chip.querySelector('.chip-remove').addEventListener('click', e => {
    e.stopPropagation(); removePopFeature(feat._id);
  });
  chip.addEventListener('click', () => {
    if (feat.layer.getBounds)      popState.map.fitBounds(feat.layer.getBounds().pad(0.4));
    else if (feat.layer.getLatLng) popState.map.panTo(feat.layer.getLatLng());
  });
  bar.appendChild(chip);
}

function removePopFeature(id) {
  const idx = popState.features.findIndex(f => f._id === id);
  if (idx < 0) return;
  popState.map.removeLayer(popState.features[idx].layer);
  popState.features.splice(idx, 1);
  document.querySelector(`#pop-bar .location-chip[data-id="${id}"]`)?.remove();
  if (!popState.features.length) {
    $('pop-bar').classList.remove('visible');
    showPopButtons();
  }
}

function showPopButtons() {
  const has = popState.features.length > 0;
  $('pop-estimate-btn').style.display = has ? '' : 'none';
  $('pop-reset-btn').style.display    = has ? '' : 'none';
}

function fitPopBounds() {
  const layers = popState.features.map(f => f.layer);
  if (!layers.length) return;
  try {
    popState.map.fitBounds(L.featureGroup(layers).getBounds().pad(0.2), { maxZoom: 13 });
  } catch { /* single point — ignore */ }
}

function popReset() {
  popState.features.forEach(f => popState.map.removeLayer(f.layer));
  popState.features = [];
  popState.paletteIdx = 0;
  $('pop-bar').innerHTML = '';
  $('pop-bar').classList.remove('visible');
  $('pop-stats').style.display = 'none';
  $('pop-content').style.display = 'none';
  $('pop-loading').style.display = 'none';
  $('pop-empty').style.display = '';
  showPopButtons();
  setStatus('idle', 'Cleared.');
}

// ── Estimate ────────────────────────────────────────────────────────────────
async function popEstimate() {
  if (!popState.features.length) return;

  $('pop-empty').style.display = 'none';
  $('pop-content').style.display = 'none';
  $('pop-loading').style.display = '';
  $('pop-loading-detail').textContent = `Summing GHSL population over ${popState.features.length} area(s)…`;
  $('pop-estimate-btn').disabled = true;
  setStatus('loading', 'Estimating population from GHSL raster…');

  try {
    const payload = {
      features: popState.features.map(f => ({
        id: f._id, name: f.name, geometry: f.geometry, buffer_km: f.buffer_km,
      })),
    };
    const res = await fetch('/api/population', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }));
      throw new Error(err.detail || res.statusText);
    }
    const data = await res.json();

    for (const r of data.results) {
      const f = popState.features.find(x => x._id === r.id);
      if (f) { f.population = r.population; f.area_km2 = r.area_km2; }
    }
    renderPopResults(data);
    setStatus('idle', `Total population ≈ ${nf(data.total)} across ${data.results.length} area(s).`);
  } catch (err) {
    $('pop-loading').style.display = 'none';
    $('pop-empty').style.display = '';
    $('pop-empty').querySelector('.empty-text').innerHTML = `<strong>Estimate failed</strong><br>${err.message}`;
    setStatus('error', `Population estimate failed: ${err.message}`);
  } finally {
    $('pop-estimate-btn').disabled = false;
  }
}

function renderPopResults(data) {
  $('pop-loading').style.display = 'none';
  $('pop-content').style.display = '';

  $('pop-total').textContent = `Total ≈ ${nf(data.total)} people`;
  $('pop-stats').style.display = '';
  $('pop-stats').innerHTML =
    `<strong>${nf(data.total)}</strong> people · <strong>${data.results.length}</strong> area${data.results.length > 1 ? 's' : ''}`;

  const c = $('pop-results');
  c.innerHTML = '';
  const sorted = [...data.results].sort((a, b) => b.population - a.population);
  for (const r of sorted) {
    const feat    = popState.features.find(f => f._id === r.id);
    const color   = feat ? feat.color : '#888';
    const density = r.area_km2 > 0 ? Math.round(r.population / r.area_km2) : 0;
    const row = document.createElement('div');
    row.className = 'pop-row';
    row.innerHTML = `
      <span class="legend-swatch" style="background:${color}; margin-top:5px"></span>
      <div style="flex:1; min-width:0">
        <div class="pop-row-name">${r.name}</div>
        <div class="pop-row-stat">${r.area_km2} km² · ~${nf(density)} / km²</div>
      </div>
      <div class="pop-row-value">${nf(r.population)}</div>`;
    c.appendChild(row);
  }
}

// ── Download ────────────────────────────────────────────────────────────────
function popDownloadGeoJSON() {
  if (!popState.features.length) return;
  const features = popState.features.map(f => ({
    type: 'Feature',
    geometry: f.geometry,
    properties: {
      name: f.name,
      buffer_km: f.buffer_km,
      population: f.population,
      area_km2: f.area_km2,
    },
  }));
  const blob = new Blob([JSON.stringify({ type: 'FeatureCollection', features }, null, 2)],
                        { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'population-estimate.geojson';
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
}
