'use strict';

// ═══════════════════════════════════════════════════════════════════════════
// POPULATION ESTIMATE TOOL
// Reuses helpers from app.js ($, setStatus) — population.js loads after.
// ═══════════════════════════════════════════════════════════════════════════

const popState = {
  map:        null,
  inited:     false,
  features:   [],     // {_id,name,type,layer,geometry,buffer_km,population,area_km2,color}
  drawMode:   null,   // 'polygon' | 'circle' while actively drawing
  paletteIdx: 0,
  pendingPoints: null, // geojson awaiting a buffer distance
};

let _popCtxTarget = null;   // { subLayer, feat } for right-click edit menu

const POP_PALETTE = ['#0072B2','#D55E00','#009E73','#CC79A7','#E69F00',
                     '#56B4E9','#7c3aed','#db2777','#65a30d','#ea580c'];

const nf = n => Number(n).toLocaleString();

// ── Boot ────────────────────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
  initTabs();
  bindPopEvents();
});

let _activeTab = 'amenity';

function initTabs() {
  $('tab-amenity').addEventListener('click',    () => switchTab('amenity'));
  $('tab-population').addEventListener('click', () => switchTab('population'));

  // Help (?) → info modal for the active tool
  $('help-btn').addEventListener('click', () => {
    const id = _activeTab === 'population' ? 'info-population-modal' : 'info-amenity-modal';
    $(id).style.display = 'flex';
  });
  document.querySelectorAll('.info-close').forEach(b =>
    b.addEventListener('click', () => {
      $('info-amenity-modal').style.display = 'none';
      $('info-population-modal').style.display = 'none';
    }));
  document.querySelectorAll('#info-amenity-modal, #info-population-modal').forEach(m =>
    m.addEventListener('click', e => { if (e.target === m) m.style.display = 'none'; }));
}

function switchTab(tab) {
  const amenity = tab === 'amenity';
  _activeTab = tab;
  $('tab-amenity').classList.toggle('active', amenity);
  $('tab-population').classList.toggle('active', !amenity);
  $('amenity-toolbar').style.display    = amenity ? 'flex' : 'none';
  $('population-toolbar').style.display = amenity ? 'none' : 'flex';
  $('view-amenity').style.display       = amenity ? 'flex' : 'none';
  $('view-population').style.display    = amenity ? 'none' : 'flex';
  if (typeof updateCount === 'function') updateCount();

  if (amenity) {
    setTimeout(() => state.map && state.map.invalidateSize(), 120);
  } else {
    const firstInit = !popState.inited;
    initPopMap();
    // Two passes: once the container is laid out, and again after the transition.
    // On first init, fit to the same world view as the amenity map so both
    // tools open at identical scale and position on every screen size.
    const fitIfFirst = () => {
      if (!popState.map) return;
      if (firstInit) fitWorldView(popState.map);
      else popState.map.invalidateSize();
    };
    setTimeout(fitIfFirst, 120);
    setTimeout(fitIfFirst, 400);
  }
}

function initPopMap() {
  if (popState.inited) return;
  popState.inited = true;

  popState.map = L.map('pop-map', {
    worldCopyJump: true, minZoom: 1, zoomSnap: 0, editable: true,
  });
  L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
    attribution:
      '© <a href="https://openstreetmap.org">OSM</a> © <a href="https://carto.com">CARTO</a>' +
      ' · pop. © <a href="https://human-settlement.emergency.copernicus.eu">GHSL</a>',
    subdomains: 'abcd', maxZoom: 19,
  }).addTo(popState.map);

  // Live radius readout while drawing / editing circle buffers
  popState.map.on('editable:drawing:move editable:vertex:drag editable:drag', () => {
    // find the circle being interacted with (if any)
    if (popState.drawMode === 'circle') {
      // drawing commit hasn't fired yet — the editTools hold the tentative layer
      const tmp = popState.map.editTools._drawing;
      if (tmp?.getRadius) showRadius(tmp.getRadius());
    }
  });
  popState.map.on('editable:editing', e => {
    if (e.layer?.getRadius) showRadius(e.layer.getRadius());
  });
  popState.map.on('editable:vertex:dragend editable:dragend', () => hideRadius());

  // Warn early if server can't reach the raster
  fetch('/api/health').then(r => r.json()).then(h => {
    if (!h.population_available)
      $('pop-hint').textContent =
        'Population backend unavailable — geospatial dependencies are not installed on the server.';
    else if (!h.population_configured)
      $('pop-hint').textContent =
        'GHSL_RASTER_URL is not set on the server — drawing works, but Estimate will fail until the raster is configured.';
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

  $('pop-download-geojson-btn').addEventListener('click', popDownloadGeoJSON);
  $('pop-download-csv-btn').addEventListener('click',     popDownloadCSV);
  $('pop-download-shp-btn').addEventListener('click',     popDownloadSHP);

  // Right-click rename for population shapes (polygons + circles)
  $('pop-ctx-rename-btn').addEventListener('click', () => {
    if (!_popCtxTarget) return;
    const { feat } = _popCtxTarget;
    $('pop-ctx-menu').style.display = 'none';
    _popCtxTarget = null;
    openRenameModal(feat.name, newName => renamePopFeature(feat, newName));
  });

  // Right-click edit menu for population polygons
  $('pop-ctx-edit-btn').addEventListener('click', () => {
    if (!_popCtxTarget) return;
    const { subLayer, feat } = _popCtxTarget;
    if (subLayer.editor) {
      subLayer.disableEdit();
    } else if (subLayer.enableEdit) {
      subLayer.enableEdit();
      subLayer.on('editable:vertex:dragend', () => {
        // Update stored geometry; nullify stale results so re-estimate is clear
        feat.geometry    = subLayer.toGeoJSON().geometry;
        feat.population  = null;
        feat.area_km2    = null;
      });
    }
    $('pop-ctx-menu').style.display = 'none';
    _popCtxTarget = null;
  });

  document.addEventListener('click', e => {
    if (!e.target.closest('#pop-ctx-menu')) $('pop-ctx-menu').style.display = 'none';
  });

  // Name modal (draw polygon / circle)
  $('pop-name-confirm').addEventListener('click', () => {
    const next = popState.features.length + 1;
    const name = $('pop-name-input').value.trim() || `Area ${next}`;
    $('pop-name-modal').style.display = 'none';
    const cb = _popNameOnConfirm;
    _popNameOnConfirm = _popNameOnCancel = null;
    if (cb) cb(name);
  });
  $('pop-name-cancel').addEventListener('click', () => {
    $('pop-name-modal').style.display = 'none';
    const cb = _popNameOnCancel;
    _popNameOnConfirm = _popNameOnCancel = null;
    if (cb) cb();
    setStatus('idle', 'Draw cancelled.');
  });
  $('pop-name-input').addEventListener('keydown', e => {
    if (e.key === 'Enter')  $('pop-name-confirm').click();
    if (e.key === 'Escape') $('pop-name-cancel').click();
  });

  // Buffer-distance modal
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
  $('buffer-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') $('buffer-confirm').click();
  });
}

// ── Drawing ─────────────────────────────────────────────────────────────────
function popDrawPolygon() {
  cancelPopDraw();
  popState.drawMode = 'polygon';
  $('pop-cancel-btn').style.display = '';
  setStatus('loading', 'Click map to place vertices — double-click to finish. Right-click a polygon to edit its vertices.');
  popState.map.once('editable:drawing:commit', e => {
    promptPopName('Area', name =>
      addPopFeature({ type: 'polygon', layer: e.layer, geometry: e.layer.toGeoJSON().geometry, buffer_km: null, name }),
      () => popState.map.removeLayer(e.layer));
    finishDraw();
  });
  popState.map.editTools.startPolygon();
}

function popDrawCircle() {
  cancelPopDraw();
  popState.drawMode = 'circle';
  $('pop-cancel-btn').style.display = '';
  setStatus('loading', 'Click to place the centre, drag to size the buffer, click again to finish. The circle stays editable after.');
  popState.map.once('editable:drawing:commit', e => {
    const layer = e.layer;
    const c  = layer.getLatLng();
    const km = layer.getRadius() / 1000;
    hideRadius();
    promptPopName('Buffer', name =>
      addPopFeature({
        type: 'circle', layer,
        geometry: { type: 'Point', coordinates: [c.lng, c.lat] },
        buffer_km: km, name,
      }),
      () => popState.map.removeLayer(layer));
    finishDraw();
  });
  popState.map.editTools.startCircle();
}

// Ask the user to name a freshly-drawn area, pre-filling the next default
// nomenclature ("Area 1", "Buffer 1", …). onConfirm(name) adds the feature;
// onCancel() discards the temporary drawing layer.
let _popNameOnConfirm = null;
let _popNameOnCancel  = null;
function promptPopName(prefix, onConfirm, onCancel) {
  _popNameOnConfirm = onConfirm;
  _popNameOnCancel  = onCancel;
  const next  = popState.features.length + 1;
  const input = $('pop-name-input');
  input.value = `${prefix} ${next}`;
  $('pop-name-modal').style.display = 'flex';
  setTimeout(() => { input.focus(); input.select(); }, 50);
}

function finishDraw() {
  popState.drawMode = null;
  $('pop-cancel-btn').style.display = 'none';
  setStatus('idle', `${popState.features.length} area(s) ready — click Estimate population.`);
}

function cancelPopDraw() {
  if (popState.map?.editTools) popState.map.editTools.stopDrawing();
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
    showAlert(err.message, 'Shapefile Upload Error');
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
    _id, type, layer, geometry, buffer_km, color,
    name: name || (type === 'circle'
      ? `Buffer ${popState.features.length + 1}`
      : `Area ${popState.features.length + 1}`),
    population: null, area_km2: null,
  };

  layer.bindTooltip(feat.name, { permanent: true, direction: 'center', className: 'polygon-label' });

  // Circle buffers stay editable so radius can be dragged afterwards
  if (type === 'circle' && layer.enableEdit) {
    layer.enableEdit();
    layer.on('editable:vertex:drag editable:drag', () => showRadius(layer.getRadius()));
    layer.on('editable:vertex:dragend editable:dragend', () => {
      feat.buffer_km   = layer.getRadius() / 1000;
      const c          = layer.getLatLng();
      feat.geometry    = { type: 'Point', coordinates: [c.lng, c.lat] };
      feat.population  = null;
      feat.area_km2    = null;
      hideRadius();
    });
  }

  // Right-click menu: polygons get vertex editing + rename; circles get rename
  bindPopCtxMenu(layer, feat);

  popState.features.push(feat);
  addPopChip(feat);
  showPopButtons();
  if (typeof updateCount === 'function') updateCount();
}

// Bind the right-click menu on a shape (handles L.Polygon, L.GeoJSON, L.Circle).
// Polygons offer "Edit vertices" + "Rename"; circles offer "Rename" only
// (their radius is always drag-editable, so vertex editing doesn't apply).
function bindPopCtxMenu(layer, feat) {
  const attach = (sub) => {
    sub.on('contextmenu', e => {
      L.DomEvent.stop(e);
      _popCtxTarget = { subLayer: sub, feat };
      const editBtn = $('pop-ctx-edit-btn');
      if (feat.type === 'circle') {
        editBtn.style.display = 'none';
      } else {
        editBtn.style.display = '';
        editBtn.textContent = sub.editor ? '✓ Done editing' : '✏ Edit vertices';
      }
      const menu = $('pop-ctx-menu');
      menu.style.left = e.originalEvent.clientX + 'px';
      menu.style.top  = e.originalEvent.clientY + 'px';
      menu.style.display = 'block';
    });
  };
  if (layer.eachLayer) layer.eachLayer(attach);
  else attach(layer);
}

// Rename a population feature — updates the chip, the map label tooltip and state.
function renamePopFeature(feat, newName) {
  feat.name = newName;
  const chip = document.querySelector(`#pop-bar .location-chip[data-id="${feat._id}"]`);
  if (chip) chip.querySelector('.chip-name').textContent = newName;
  if (feat.layer) {
    feat.layer.unbindTooltip();
    feat.layer.bindTooltip(newName, { permanent: true, direction: 'center', className: 'polygon-label' });
  }
  // Re-render the results panel so the renamed feature shows its new label
  if (feat.population != null) {
    const results = popState.features
      .filter(f => f.population != null)
      .map(f => ({ id: f._id, name: f.name, population: f.population, area_km2: f.area_km2 }));
    const total = results.reduce((s, r) => s + r.population, 0);
    renderPopResults({ results, total });
  }
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
  if (typeof updateCount === 'function') updateCount();
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
  } catch { /* single point */ }
}

function popReset() {
  popState.features.forEach(f => popState.map.removeLayer(f.layer));
  popState.features = [];
  popState.paletteIdx = 0;
  $('pop-bar').innerHTML = '';
  $('pop-bar').classList.remove('visible');
  $('pop-stats').style.display   = 'none';
  $('pop-content').style.display = 'none';
  $('pop-loading').style.display = 'none';
  $('pop-empty').style.display   = '';
  showPopButtons();
  if (typeof updateCount === 'function') updateCount();
  setStatus('idle', 'Cleared.');
}

// ── Estimate ────────────────────────────────────────────────────────────────
async function popEstimate() {
  if (!popState.features.length) return;

  $('pop-empty').style.display   = 'none';
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
    $('pop-empty').style.display   = '';
    $('pop-empty').querySelector('.empty-text').innerHTML =
      `<strong>Estimate failed</strong><br>${err.message}`;
    setStatus('error', `Population estimate failed: ${err.message}`);
    showAlert(err.message, 'Population Estimate Failed');
  } finally {
    $('pop-estimate-btn').disabled = false;
  }
}

function renderPopResults(data) {
  $('pop-loading').style.display  = 'none';
  $('pop-content').style.display  = '';

  $('pop-total').textContent = `Total ≈ ${nf(data.total)} people`;
  $('pop-stats').style.display = '';
  $('pop-stats').innerHTML =
    `<strong>${nf(data.total)}</strong> people · <strong>${data.results.length}</strong> ` +
    `area${data.results.length > 1 ? 's' : ''}`;

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
        <div class="pop-row-stat">${nf(Math.round(r.area_km2))} km²${feat?.buffer_km ? ` · ${feat.buffer_km.toFixed(2)} km buffer` : ''}  ·  ~${nf(density)} people / km²</div>
      </div>
      <div class="pop-row-value">${nf(r.population)}</div>`;
    c.appendChild(row);
  }
}

// ── Downloads ────────────────────────────────────────────────────────────────

function popDownloadGeoJSON() {
  if (!popState.features.length) return;
  const features = popState.features.map(f => ({
    type: 'Feature',
    geometry: f.geometry,
    properties: {
      name:       f.name,
      buffer_km:  f.buffer_km,
      population: f.population,
      area_km2:   f.area_km2,
      density_per_km2: f.area_km2 > 0 && f.population != null
        ? Math.round(f.population / f.area_km2) : null,
    },
  }));
  _triggerDownload(
    JSON.stringify({ type: 'FeatureCollection', features }, null, 2),
    'population-estimate.geojson', 'application/json'
  );
}

function popDownloadCSV() {
  if (!popState.features.length) return;
  const rows = [['name', 'population', 'area_km2', 'density_per_km2', 'buffer_km', 'type']];
  for (const f of popState.features) {
    const density = (f.population != null && f.area_km2 > 0)
      ? Math.round(f.population / f.area_km2) : '';
    rows.push([
      `"${(f.name || '').replace(/"/g, '""')}"`,
      f.population ?? '',
      f.area_km2   ?? '',
      density,
      f.buffer_km  ?? '',
      f.type,
    ]);
  }
  _triggerDownload(
    rows.map(r => r.join(',')).join('\n'),
    'population-estimate.csv', 'text/csv;charset=utf-8;'
  );
}

async function popDownloadSHP() {
  if (!popState.features.length) return;
  const payload = {
    features: popState.features.map(f => ({
      id: f._id, name: f.name, geometry: f.geometry, buffer_km: f.buffer_km,
    })),
    results: popState.features
      .filter(f => f.population != null)
      .map(f => ({ id: f._id, population: f.population, area_km2: f.area_km2 })),
  };
  try {
    setStatus('loading', 'Generating shapefile…');
    const res = await fetch('/api/population/export', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }));
      throw new Error(err.detail || res.statusText);
    }
    const blob = await res.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'population-estimate.zip';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setStatus('idle', 'Shapefile downloaded.');
  } catch (err) {
    setStatus('error', `Shapefile export failed: ${err.message}`);
  }
}

function _triggerDownload(content, filename, mime) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([content], { type: mime }));
  a.download = filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
}
