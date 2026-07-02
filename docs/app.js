'use strict';

// ═══════════════════════════════════════════════════════════════════════════
// AMENITY FILTERS
// ═══════════════════════════════════════════════════════════════════════════

const EXCLUDE = new Set([
  'parking','parking_entrance','parking_space','motorcycle_parking',
  'bicycle_parking','bus_station','car_rental','taxi','fuel',
  'charging_station','bicycle_repair_station','boat_storage',
  'storage_rental','sanitary_dump_station','weighbridge',
  'vehicle_inspection','car','car_parts','car_repair','motorcycle_repair',
  'recycling','waste_basket','waste_disposal','waste_basket;recycling',
  'bench','fountain','drinking_water','shower','toilets','vending_machine',
  'shelter','lounger','bbq','binoculars','fireplace','kneipp_water_cure',
  'watering_place','lavoir','dressing_room','dog_poop_bags','parcel_locker',
  'public_bookcase',
  'post_box','post_office','police','fire_station','courthouse','townhall',
  'telephone','telecommunication','letter_box',
  'bts','vacant','hunting_stand','animal_shelter','grave_yard','monastery',
  'pet_grooming','pet','funeral_directors','animal_boarding',
  'brothel','cannabis','tattoo',
  'atm','ticket','money_lender','marketplace',
]);

// ═══════════════════════════════════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════════════════════════════════

const state = {
  mode: 'ai',
  locations: [],
  amenities: [],
  groups: [],
  amenityToGroup: {},
  groupColors: {},
  map: null,
  boundaryLayers: {},    // _id → L.geoJSON layer (has permanent tooltip bound to it)
  amenityDotLayers: {},  // _id → L.layerGroup (per-location amenity dots)
  perLocCounts: [],      // [{counts:{type->n}, total:n}] per selected location
};

const NOMINATIM = 'https://nominatim.openstreetmap.org';
const OVERPASS  = 'https://overpass-api.de/api/interpreter';

// ── Tunables ─────────────────────────────────────────────────────────────────
const CONTACT_EMAIL           = 'bench.michin@gmail.com'; // identifies us to Nominatim
const NOMINATIM_DELAY_MS      = 1150;                     // ≥1 req/s per usage policy
const OVERPASS_RETRY_DELAYS_MS = [4000, 10000, 20000];    // back-off after 429s
const FIT_MAX_ZOOM            = 13;                       // cap when fitting to boundaries
const TILE_MAX_ZOOM           = 19;

// Client-side copy of the server's DEFAULT_GROUPS (amenity_config.py) — used
// only when /api/defaults is unreachable so the app still works offline.
const FALLBACK_GROUPS = [
  { name:'Dining',             color:'#E69F00', items:['restaurant','restaurant;bar','cafe','coffee','fast_food','biergarten','ice_cream'] },
  { name:'Nightlife',          color:'#D55E00', items:['bar','pub','nightclub','casino'] },
  { name:'Food Retail',        color:'#56B4E9', items:['supermarket','convenience','bakery','butcher','cheese','deli','pastry','chocolate','health_food','alcohol','general','confectionery','wine','farm'] },
  { name:'Sports & Recreation', color:'#009E73', items:['sports','outdoor','ski','ski_rental','ski_school','avalanche_transceiver','snow_park','bicycle_rental','water_sports','boat_rental','fitness_equipment','lift_tickets','bicycle'] },
  { name:'Fashion & Beauty',   color:'#CC79A7', items:['clothes','shoes','fashion_accessories','leather','tailor','cosmetics','perfumery','beauty','hairdresser','optician'] },
  { name:'Health & Medical',   color:'#0072B2', items:['pharmacy','clinic','doctors','hospital','dentist','medical_supply','hearing_aids','chemist','veterinary','massage','public_bath'] },
  { name:'Gifts & Speciality', color:'#F0E442', items:['gift','jewelry','second_hand','variety_store','craft','toys','florist','stationery','books','newsagent','kiosk','photo','tobacco'] },
  { name:'Home & Electronics', color:'#999999', items:['furniture','houseware','interior_decoration','hardware','doityourself','electrical','garden_centre','paint','kitchen','wholesale','department_store','mall','electronics','computer','mobile_phone','hifi','camera','bed','studio'] },
  { name:'Culture & Community',color:'#44AA99', items:['bank','cinema','travel_agency','dry_cleaning','laundry','theatre','locksmith','arts_centre','art','music_school','conference_centre','library','place_of_worship','school','kindergarten','childcare','community_centre','social_facility','clubhouse','driving_school'] },
];

const BOUNDARY_PALETTE = ['#2563eb','#7c3aed','#059669','#dc2626','#d97706',
                          '#0891b2','#db2777','#65a30d','#ea580c','#6366f1',
                          '#0ea5e9','#f43f5e','#84cc16','#a855f7'];
let _paletteIdx      = 0;
let _ctxTarget       = null;   // { subLayer, layer, id } for the right-click context menu
let _drawingLayer    = null;   // L.Polygon layer while draw mode is active
let _drawCommitHnd   = null;   // editable:drawing:commit handler (stored for removal)

// ═══════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════

const sleep = ms => new Promise(r => setTimeout(r, ms));
const $     = id => document.getElementById(id);
const fmt   = s  => s.replace(/_/g,' ').replace(/;/g,'/').replace(/\b\w/g, c => c.toUpperCase());

function hexToPastel(hex, mix = 0.82) {
  const h = hex.replace('#','');
  let r = parseInt(h.slice(0,2),16), g = parseInt(h.slice(2,4),16), b = parseInt(h.slice(4,6),16);
  r = Math.round(r + (255-r)*mix); g = Math.round(g + (255-g)*mix); b = Math.round(b + (255-b)*mix);
  return `rgb(${r},${g},${b})`;
}

function setStatus(type, msg) {
  $('status-dot').className = `status-dot ${type === 'idle' ? '' : type}`;
  $('status-msg').textContent = msg;
}

// Download `content` (string or Blob) as a file. Shared by every export button.
function triggerDownload(content, filename, mime = 'application/octet-stream') {
  const blob = content instanceof Blob ? content : new Blob([content], { type: mime });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a); URL.revokeObjectURL(url);
}

// Bind (or re-bind) the permanent centre label shown on a map shape.
// Used by both tools so labels look and behave identically everywhere.
function bindShapeLabel(layer, name) {
  if (layer.eachLayer) layer.eachLayer(sub => sub.unbindTooltip && sub.unbindTooltip());
  layer.unbindTooltip();
  layer.bindTooltip(name, { permanent: true, direction: 'center', className: 'polygon-label', sticky: false });
}

// POST an uploaded file to the shapefile parser and return the parsed
// response ({ geojson, geometry_type, feature_count }), throwing a readable
// Error on failure. Shared by both tools' upload buttons.
async function uploadShapefile(file) {
  const fd = new FormData();
  fd.append('file', file);
  const res = await fetch('/api/shapefile', { method: 'POST', body: fd });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || res.statusText);
  }
  return res.json();
}

// Best display name for an uploaded feature: first name-like attribute,
// falling back to "<prefix> <n>". Shared by both tools.
function featureName(props, i, prefix) {
  if (props) {
    for (const k of ['name', 'NAME', 'Name', 'label', 'id', 'ID']) {
      if (props[k] != null && String(props[k]).trim()) return String(props[k]);
    }
  }
  return `${prefix} ${i + 1}`;
}

// Build a location/area chip and append it to `bar`. Both tools share this so
// chips stay visually and behaviourally identical.
function createChip(bar, { id, name, country, loading, dotColor, onRemove, onClick }) {
  const chip = document.createElement('div');
  chip.className = `location-chip selected${loading ? ' loading' : ''}`;
  chip.dataset.id = id;
  chip.innerHTML = `
    ${loading
      ? '<span class="chip-spinner"></span>'
      : `<span class="chip-dot" style="background:${dotColor || 'var(--green)'}"></span>`}
    <span class="chip-name">${name}</span>
    ${country ? `<span style="color:var(--text-3);font-size:11px">${country}</span>` : ''}
    <span class="chip-remove" title="Remove">×</span>
  `;
  chip.querySelector('.chip-remove').addEventListener('click', e => {
    e.stopPropagation();
    onRemove();
  });
  if (onClick) chip.addEventListener('click', onClick);
  bar.appendChild(chip);
  return chip;
}

// ── Shared modal helpers ─────────────────────────────────────────────────────

function showAlert(message, title = 'Error') {
  $('alert-modal-title').textContent = title;
  $('alert-modal-body').textContent  = message;
  $('alert-modal').style.display     = 'flex';
}

function showThinking(detail = '') {
  $('thinking-detail').textContent   = detail;
  $('thinking-modal').style.display  = 'flex';
}

function hideThinking() {
  $('thinking-modal').style.display  = 'none';
}

// Generic name-input modal — one DOM modal serves all three flows (naming a
// drawn amenity boundary, naming a population area, renaming any shape).
// onConfirm receives the trimmed name (may be empty — callers apply defaults).
let _nameModalCbs = null;

function promptForName({ overline, title, confirmLabel, placeholder, defaultValue = '', onConfirm, onCancel }) {
  _nameModalCbs = { onConfirm, onCancel };
  $('name-modal-overline').textContent = overline;
  $('name-modal-title').textContent    = title;
  $('name-modal-confirm').textContent  = confirmLabel;
  const input = $('name-modal-input');
  input.placeholder = placeholder || 'e.g. Area 1';
  input.value = defaultValue;
  $('name-modal').style.display = 'flex';
  setTimeout(() => { input.focus(); input.select(); }, 50);
}

// Rename flow on top of the generic modal — ignores empty submissions.
function openRenameModal(currentName, onConfirm) {
  promptForName({
    overline: 'Rename', title: 'Rename this shape', confirmLabel: 'Save name',
    defaultValue: currentName || '',
    onConfirm: name => { if (name) onConfirm(name); },
  });
}

function bindNameModal() {
  const finish = which => {
    const cbs = _nameModalCbs;
    _nameModalCbs = null;
    const name = $('name-modal-input').value.trim();
    $('name-modal').style.display = 'none';
    if (cbs?.[which]) cbs[which](name);
  };
  $('name-modal-confirm').addEventListener('click', () => finish('onConfirm'));
  $('name-modal-cancel').addEventListener('click',  () => finish('onCancel'));
  $('name-modal-input').addEventListener('keydown', e => {
    if (e.key === 'Enter')  finish('onConfirm');
    if (e.key === 'Escape') finish('onCancel');
  });
}

function setGroups(groups) {
  state.groups = groups;
  state.amenityToGroup = {};
  state.groupColors = {};
  for (const g of groups) {
    state.groupColors[g.name] = g.color;
    for (const item of g.items) {
      if (!state.amenityToGroup[item]) state.amenityToGroup[item] = g.name;
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════════════════════════

window.addEventListener('DOMContentLoaded', () => {
  initMap();
  bindEvents();
  bindNameModal();
  loadDefaultGroups();
  setMode('ai');
  updateCount();

  // Alert modal OK
  $('alert-modal-ok').addEventListener('click', () => {
    $('alert-modal').style.display = 'none';
  });
  $('alert-modal').addEventListener('click', e => {
    if (e.target === $('alert-modal')) $('alert-modal').style.display = 'none';
  });
});

function fitWorldView(map) {
  map.invalidateSize();
  const w = map.getSize().x;
  if (!w) { setTimeout(() => fitWorldView(map), 60); return; }
  const zoom = Math.round(Math.log2(w / 256));   // nearest integer zoom that fits world width
  map.setView([25, 0], zoom, { animate: false });
}

function initMap() {
  state.map = L.map('map', { worldCopyJump: true, minZoom: 1, wheelPxPerZoomLevel: 40, editable: true });
  L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
    attribution: '© <a href="https://openstreetmap.org">OSM</a> © <a href="https://carto.com">CARTO</a>',
    subdomains: 'abcd', maxZoom: TILE_MAX_ZOOM,
  }).addTo(state.map);

  // Wait one frame so the flex container has its final pixel dimensions before
  // fitting — prevents the grey-at-top bug on large / HiDPI displays.
  requestAnimationFrame(() => fitWorldView(state.map));

  window.addEventListener('resize', () => {
    state.map.invalidateSize();
    if (state.groups.length && state.amenities.length) redrawBubbleChart();
  });
}

function bindEvents() {
  $('mode-ai').addEventListener('click',   () => setMode('ai'));
  $('mode-osm').addEventListener('click',  () => setMode('osm'));
  $('mode-draw').addEventListener('click', () => setMode('draw'));

  $('search-btn').addEventListener('click', handleAiSearch);
  $('search-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') { if (state.mode === 'ai') handleAiSearch(); }
  });
  $('add-relations-btn').addEventListener('click', () => handleOsmAdd('relation'));
  $('add-ways-btn').addEventListener('click',      () => handleOsmAdd('way'));
  $('draw-polygon-btn').addEventListener('click',  handleDrawPolygon);
  $('draw-cancel-btn').addEventListener('click',   cancelDraw);
  $('amenity-upload-btn').addEventListener('click', () => $('amenity-file-input').click());
  $('amenity-file-input').addEventListener('change', onAmenityFileChosen);

  $('analyze-btn').addEventListener('click', analyzeAmenities);
  $('reset-btn').addEventListener('click',   resetAll);
  $('download-svg-btn').addEventListener('click', downloadSVG);
  $('download-geojson-btn').addEventListener('click', downloadAmenitiesGeoJSON);

  $('ctx-rename-btn').addEventListener('click', () => {
    if (!_ctxTarget) return;
    const { id } = _ctxTarget;
    $('map-ctx-menu').style.display = 'none';
    _ctxTarget = null;
    const loc = state.locations.find(l => l._id === id);
    if (!loc) return;
    openRenameModal(loc.name, newName => renameLocation(id, newName));
  });

  $('ctx-edit-btn').addEventListener('click', () => {
    if (!_ctxTarget) return;
    const { subLayer, layer, id } = _ctxTarget;
    if (subLayer.editor) {
      subLayer.disableEdit();
    } else if (subLayer.enableEdit) {
      subLayer.enableEdit();
      subLayer.on('editable:vertex:dragend', () => {
        const loc = state.locations.find(l => l._id === id);
        if (!loc) return;
        const b = layer.getBounds();
        loc.bbox   = [b.getSouth(), b.getNorth(), b.getWest(), b.getEast()];
        loc.geojson = subLayer.toGeoJSON().geometry;
        loc.edited  = true;
      });
    }
    $('map-ctx-menu').style.display = 'none';
    _ctxTarget = null;
  });

  document.addEventListener('click', e => {
    if (!e.target.closest('#map-ctx-menu')) $('map-ctx-menu').style.display = 'none';
  });
}

function setMode(mode) {
  // Cancel any active drawing when leaving draw mode
  if (state.mode === 'draw' && mode !== 'draw') cancelDraw();

  state.mode = mode;
  $('mode-ai').classList.toggle('active',   mode === 'ai');
  $('mode-osm').classList.toggle('active',  mode === 'osm');
  $('mode-draw').classList.toggle('active', mode === 'draw');

  // Search pill is used for AI prompts + OSM IDs; hidden only in draw mode
  $('search-pill').style.display      = mode === 'draw' ? 'none' : 'flex';
  $('ai-controls').style.display      = mode === 'ai'   ? 'flex' : 'none';
  $('osm-controls').style.display     = mode === 'osm'  ? 'flex' : 'none';
  $('draw-controls').style.display    = mode === 'draw' ? 'flex' : 'none';
  $('draw-cancel-btn').style.display  = 'none';  // only appears while actively drawing
  $('search-tag').textContent         = mode === 'osm' ? 'OSM' : 'AI';

  const hints = {
    ai:   ['e.g. boutique design district, mountain ski resort, financial CBD…',
           'Gemini suggests benchmark examples worldwide and defines context-specific amenity groups.'],
    osm:  ['e.g. 62149, 5750005, 7444  (comma-separated IDs)',
           'Paste OpenStreetMap relation or way IDs, then click + Relations or + Ways.'],
    draw: ['',
           'Click “Draw polygon” to sketch a boundary (double-click to finish), or upload a zipped shapefile of polygons.'],
  };
  if (mode !== 'draw') $('search-input').placeholder = hints[mode][0];
  $('search-hint').textContent = hints[mode][1];
}

// Header count badge — reflects the active tool's item count
function updateCount() {
  const badge = $('count-badge');
  if (!badge) return;
  const tab = (typeof _activeTab !== 'undefined') ? _activeTab : 'amenity';
  if (tab === 'population') {
    const n = (typeof popState !== 'undefined') ? popState.features.length : 0;
    badge.textContent = `${n} area${n === 1 ? '' : 's'}`;
  } else {
    const n = state.locations.length;
    badge.textContent = `${n} location${n === 1 ? '' : 's'}`;
  }
}

async function loadDefaultGroups() {
  try {
    const res = await fetch('/api/defaults');
    if (res.ok) setGroups((await res.json()).groups);
  } catch {
    setGroups(FALLBACK_GROUPS);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// DRAW MODE
// ═══════════════════════════════════════════════════════════════════════════

function handleDrawPolygon() {
  $('draw-polygon-btn').disabled = true;
  $('draw-cancel-btn').style.display = '';
  setStatus('loading', 'Click the map to place vertices — double-click to finish.');

  _drawCommitHnd = e => {
    _drawingLayer = e.layer;
    promptForName({
      overline: 'New area', title: 'Name this area', confirmLabel: 'Add location',
      placeholder: 'e.g. Custom District, My Polygon…',
      onConfirm: name => {
        if (_drawingLayer) addDrawnPolygon(_drawingLayer, name || 'Custom Area');
      },
      onCancel: () => {
        if (_drawingLayer) { state.map.removeLayer(_drawingLayer); _drawingLayer = null; }
        $('draw-polygon-btn').disabled = false;
        $('draw-cancel-btn').style.display = 'none';
        setStatus('idle', 'Draw cancelled.');
      },
    });
  };
  state.map.once('editable:drawing:commit', _drawCommitHnd);
  state.map.editTools.startPolygon();
}

function cancelDraw() {
  if (_drawCommitHnd) {
    state.map.off('editable:drawing:commit', _drawCommitHnd);
    _drawCommitHnd = null;
  }
  if (state.map.editTools) state.map.editTools.stopDrawing();
  if (_drawingLayer) {
    state.map.removeLayer(_drawingLayer);
    _drawingLayer = null;
  }
  $('draw-polygon-btn').disabled = false;
  $('draw-cancel-btn').style.display = 'none';
  setStatus('idle', 'Draw cancelled.');
}

function addDrawnPolygon(layer, name) {
  // Replace the raw drawing layer with a properly styled boundary
  state.map.removeLayer(layer);

  const geojson = layer.toGeoJSON().geometry;
  const bounds  = layer.getBounds();
  const bbox    = [bounds.getSouth(), bounds.getNorth(), bounds.getWest(), bounds.getEast()];

  const loc = {
    _id:          crypto.randomUUID(),
    name,
    display_name: name,
    country:      '',
    osm_id:       null,
    osm_type:     null,
    geojson,
    bbox,
    edited:       true,   // tells fetchOverpass to use poly: filter
    status:       'ready',
    selected:     true,
  };

  // Chip is born ready — no geocoding needed for hand-drawn boundaries
  addChip(loc, 'ready');
  showBoundary(loc._id, geojson, name);

  _drawingLayer  = null;
  _drawCommitHnd = null;
  $('draw-polygon-btn').disabled     = false;
  $('draw-cancel-btn').style.display = 'none';
  setStatus('idle', `"${name}" added — click Analyse to fetch amenities.`);
}

// ═══════════════════════════════════════════════════════════════════════════
// SHAPEFILE UPLOAD — boundary polygons become locations, ready to Analyse
// ═══════════════════════════════════════════════════════════════════════════

async function onAmenityFileChosen(e) {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;

  setStatus('loading', `Parsing ${file.name}…`);
  try {
    const data = await uploadShapefile(file);
    if (data.geometry_type === 'point') {
      throw new Error(
        'This layer contains point features. The Amenity Ecosystem tool needs polygon ' +
        'boundaries — use the Population Estimate tool to buffer points into areas.'
      );
    }
    const added = addUploadedBoundaries(data.geojson);
    if (!added) throw new Error('No polygon features found in this file.');
    setStatus('idle', `${added} boundar${added === 1 ? 'y' : 'ies'} added — click Analyse to fetch amenities.`);
  } catch (err) {
    setStatus('error', `Shapefile error: ${err.message}`);
    showAlert(err.message, 'Shapefile Upload Error');
  }
}

// Turn each uploaded polygon into a ready location (same shape as a hand-drawn
// boundary — Overpass queries it with a poly: filter). Returns the count added.
function addUploadedBoundaries(geojson) {
  const feats = (geojson.features || []).filter(f =>
    f.geometry && (f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon'));

  feats.forEach((f, i) => {
    const b    = L.geoJSON(f.geometry).getBounds();
    const name = featureName(f.properties, i, 'Area');
    const loc = {
      _id:          crypto.randomUUID(),
      name,
      display_name: name,
      country:      '',
      osm_id:       null,
      osm_type:     null,
      geojson:      f.geometry,
      bbox:         [b.getSouth(), b.getNorth(), b.getWest(), b.getEast()],
      edited:       true,   // tells fetchOverpass to use poly: filter
      status:       'ready',
      selected:     true,
    };
    addChip(loc, 'ready');
    showBoundary(loc._id, loc.geojson, name);
  });

  return feats.length;
}

// ═══════════════════════════════════════════════════════════════════════════
// SEARCH — AI resets; OSM appends
// ═══════════════════════════════════════════════════════════════════════════

async function handleAiSearch() {
  const q = $('search-input').value.trim();
  if (!q) return;
  await aiSearch(q);
}

async function handleOsmAdd(osmType) {
  const q = $('search-input').value.trim();
  if (!q) return;
  await addOsmLocations(q, osmType);
}

// Pure data fetch: POST the category to /api/suggest and return the parsed
// response, throwing a readable Error on any failure. No DOM access.
async function fetchSuggestions(category, numLocations) {
  const res = await fetch('/api/suggest', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({ category, num_locations: numLocations }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    const detail = Array.isArray(err.detail)
      ? err.detail.map(e => e.msg || JSON.stringify(e)).join('; ')
      : (err.detail || res.statusText);
    throw new Error(detail);
  }
  return res.json();
}

// Geocode each location in sequence, pausing between requests to respect
// Nominatim's rate limit.
async function geocodeAll(locs) {
  for (const loc of locs) {
    await geocodeLoc(loc);
    await sleep(NOMINATIM_DELAY_MS);
  }
}

async function aiSearch(category) {
  const numLocations = parseInt($('num-locations').value, 10) || 15;
  setStatus('loading', `Asking Gemini for "${category}" benchmark locations…`);
  showThinking(`Suggesting ${numLocations} benchmark locations for "${category}"…`);
  $('search-btn').disabled = true;

  try {
    const data = await fetchSuggestions(category, numLocations);
    hideThinking();
    setGroups(data.groups);

    const locs = data.locations || [];
    setStatus('loading', `Geocoding ${locs.length} locations…`);

    // AI search resets everything for a fresh benchmark set
    resetLocations();
    for (const loc of locs) {
      loc._id = crypto.randomUUID();
      addChip(loc);
    }
    await geocodeAll(locs);
    setStatus('idle', `${locs.length} locations ready · ${state.groups.length} amenity groups. Click Analyse.`);
  } catch (e) {
    hideThinking();
    setStatus('error', `AI search failed: ${e.message}`);
    showAlert(e.message, 'AI Search Failed');
  } finally {
    $('search-btn').disabled = false;
  }
}

// Appends OSM relation or way IDs to the existing location list without resetting
async function addOsmLocations(input, osmType) {
  const ids = input.split(/[\s,]+/).map(s => s.trim()).filter(Boolean)
                   .map(Number).filter(n => n > 0);
  if (!ids.length) { setStatus('warn', 'No valid IDs found.'); return; }

  const typeLabel = osmType === 'relation' ? 'relation' : 'way';
  setStatus('loading', `Looking up ${ids.length} OSM ${typeLabel}(s)…`);

  const btn = osmType === 'relation' ? $('add-relations-btn') : $('add-ways-btn');
  btn.disabled = true;

  for (const id of ids) {
    const loc = {
      _id: crypto.randomUUID(),
      name: `${osmType === 'relation' ? 'Relation' : 'Way'} ${id}`,
      country: '', search_query: '',
      osm_id: id, osm_type: osmType,
    };
    addChip(loc);
    await geocodeLocByOsmId(loc);
    await sleep(NOMINATIM_DELAY_MS);
  }
  setStatus('idle', `${ids.length} ${typeLabel}(s) added. Click Analyse to update.`);
  btn.disabled = false;
  $('search-input').value = '';
}

// ═══════════════════════════════════════════════════════════════════════════
// CHIPS
// ═══════════════════════════════════════════════════════════════════════════

function resetLocations() {
  state.locations = [];
  Object.values(state.boundaryLayers).forEach(l => state.map.removeLayer(l));
  Object.values(state.amenityDotLayers).forEach(l => state.map.removeLayer(l));
  state.boundaryLayers = {};
  state.amenityDotLayers = {};
  state.perLocCounts = [];
  $('locations-bar').innerHTML = '';
  $('locations-bar').classList.remove('visible');
  $('analyze-btn').style.display = 'none';
  $('reset-btn').style.display = 'none';
  $('map-stats').style.display = 'none';
  $('diagram-content').style.display = 'none';
  $('diagram-loading').style.display = 'none';
  $('diagram-empty').style.display = '';
  _paletteIdx = 0;
  updateCount();
}

function resetAll() {
  resetLocations();
  $('search-input').value = '';
}

function addChip(loc, status = 'pending') {
  const bar = $('locations-bar');
  bar.classList.add('visible');

  createChip(bar, {
    id:      loc._id,
    name:    loc.name,
    country: loc.country,
    loading: status === 'pending',
    onRemove: () => removeLocation(loc._id),
    onClick:  () => toggleLocation(loc._id),
  });

  state.locations.push({ ...loc, selected: true, status });
  $('analyze-btn').style.display = '';
  $('reset-btn').style.display = '';
  updateCount();
}

function updateChip(id, status, displayName) {
  const chip = document.querySelector(`.location-chip[data-id="${id}"]`);
  if (!chip) return;
  chip.classList.remove('loading','error');
  chip.querySelector('.chip-spinner')?.remove();

  let dot = chip.querySelector('.chip-dot');
  if (!dot) {
    dot = document.createElement('span');
    dot.className = 'chip-dot';
    chip.insertBefore(dot, chip.querySelector('.chip-name'));
  }
  dot.style.background = status === 'ready' ? 'var(--green)' : 'var(--danger)';
  if (status === 'error') chip.classList.add('error');
  if (displayName) chip.querySelector('.chip-name').textContent = displayName;

  const entry = state.locations.find(l => l._id === id);
  if (entry) entry.status = status;
}

function renameLocation(id, newName) {
  const loc = state.locations.find(l => l._id === id);
  if (!loc) return;
  loc.name = newName;
  loc.display_name = newName;

  // Update the chip label
  const chip = document.querySelector(`.location-chip[data-id="${id}"]`);
  if (chip) chip.querySelector('.chip-name').textContent = newName;

  // Update the polygon's permanent tooltip label
  const layer = state.boundaryLayers[id];
  if (layer) bindShapeLabel(layer, newName);
}

function toggleLocation(id) {
  const loc = state.locations.find(l => l._id === id);
  if (!loc || loc.status !== 'ready') return;
  loc.selected = !loc.selected;
  document.querySelector(`.location-chip[data-id="${id}"]`)?.classList.toggle('selected', loc.selected);

  // Toggle polygon fill + border opacity
  const layer = state.boundaryLayers[id];
  if (layer) {
    layer.setStyle({ opacity: loc.selected ? 0.85 : 0.25, fillOpacity: loc.selected ? 0.18 : 0.03 });
    // Toggle the permanent label tooltip
    const tt = layer.getTooltip();
    if (tt?.getElement()) tt.getElement().style.opacity = loc.selected ? '1' : '0.25';
  }

  // Show or hide this location's amenity dots
  const dotLayer = state.amenityDotLayers[id];
  if (dotLayer) {
    if (loc.selected) dotLayer.addTo(state.map);
    else              state.map.removeLayer(dotLayer);
  }
}

function removeLocation(id) {
  const idx = state.locations.findIndex(l => l._id === id);
  if (idx >= 0) state.locations.splice(idx, 1);
  document.querySelector(`.location-chip[data-id="${id}"]`)?.remove();
  if (state.boundaryLayers[id])   { state.map.removeLayer(state.boundaryLayers[id]);   delete state.boundaryLayers[id]; }
  if (state.amenityDotLayers[id]) { state.map.removeLayer(state.amenityDotLayers[id]); delete state.amenityDotLayers[id]; }

  if (!state.locations.length) {
    $('locations-bar').classList.remove('visible');
    $('analyze-btn').style.display = 'none';
    $('reset-btn').style.display = 'none';
  }
  updateCount();
}

// ═══════════════════════════════════════════════════════════════════════════
// GEOCODING
// ═══════════════════════════════════════════════════════════════════════════

async function callNominatim(q, limit = 5) {
  const url = new URL(`${NOMINATIM}/search`);
  url.searchParams.set('q', q);
  url.searchParams.set('format', 'json');
  url.searchParams.set('limit', limit);
  url.searchParams.set('polygon_geojson', '1');
  url.searchParams.set('addressdetails', '1');
  url.searchParams.set('email', CONTACT_EMAIL);
  const res = await fetch(url, { headers:{ Accept:'application/json' } });
  if (!res.ok) throw new Error(`Nominatim ${res.status}`);
  return res.json();
}

async function callNominatimLookup(osmType, osmId) {
  const url = new URL(`${NOMINATIM}/lookup`);
  url.searchParams.set('osm_ids', `${osmType[0].toUpperCase()}${osmId}`);
  url.searchParams.set('format', 'json');
  url.searchParams.set('polygon_geojson', '1');
  url.searchParams.set('email', CONTACT_EMAIL);
  const res = await fetch(url, { headers:{ Accept:'application/json' } });
  if (!res.ok) throw new Error(`Nominatim ${res.status}`);
  return res.json();
}

async function geocodeLoc(loc) {
  try {
    const results = await callNominatim(loc.search_query, 5);
    const r = results.find(x => x.osm_type === 'relation') || results[0];
    if (!r) throw new Error('Not found');
    applyGeocodeResult(loc, r);
  } catch {
    updateChip(loc._id, 'error');
  }
}

async function geocodeLocByOsmId(loc) {
  try {
    const results = await callNominatimLookup(loc.osm_type, loc.osm_id);
    if (!results.length) throw new Error('Not found');
    applyGeocodeResult(loc, results[0]);
  } catch {
    updateChip(loc._id, 'error');
  }
}

function applyGeocodeResult(loc, r) {
  const shortName = r.display_name.split(',').slice(0,2).join(',').trim();
  const realGeoJSON = r.geojson && (r.geojson.type === 'Polygon' || r.geojson.type === 'MultiPolygon');
  Object.assign(loc, {
    osm_id: parseInt(r.osm_id),
    osm_type: r.osm_type,
    display_name: r.display_name,
    geojson: ensurePolygon(r.geojson, r.boundingbox),
    bbox: r.boundingbox,   // [minLat, maxLat, minLon, maxLon]
    status: 'ready',
    synthetic_bbox: !realGeoJSON,  // true when Nominatim had no polygon → we drew a bbox rectangle
  });
  const entry = state.locations.find(l => l._id === loc._id);
  if (entry) Object.assign(entry, loc);
  updateChip(loc._id, 'ready', shortName);
  if (loc.geojson) showBoundary(loc._id, loc.geojson, loc.name || shortName);
}

function ensurePolygon(geojson, bbox) {
  if (geojson && (geojson.type === 'Polygon' || geojson.type === 'MultiPolygon')) return geojson;
  if (bbox && bbox.length === 4) {
    const [minLat, maxLat, minLon, maxLon] = bbox.map(Number);
    return { type:'Polygon', coordinates:[[
      [minLon,minLat],[maxLon,minLat],[maxLon,maxLat],[minLon,maxLat],[minLon,minLat],
    ]]};
  }
  return null;
}

// ═══════════════════════════════════════════════════════════════════════════
// MAP — polygons with permanent tooltip labels + per-location amenity dots
// ═══════════════════════════════════════════════════════════════════════════

function showBoundary(id, geojson, name) {
  const color = BOUNDARY_PALETTE[_paletteIdx++ % BOUNDARY_PALETTE.length];

  const layer = L.geoJSON(geojson, {
    style: { color, weight: 2, opacity: 0.85, fillColor: color, fillOpacity: 0.18 },
  }).addTo(state.map);

  // Permanent tooltip acts as the polygon label — rendered in Leaflet's tooltip
  // pane (overflow:visible) so it never gets clipped at the map panel edge
  bindShapeLabel(layer, name);

  state.boundaryLayers[id] = layer;

  // Right-click any polygon to get an "Edit vertices" / "Done editing" option.
  // Editing is never enabled automatically — only on explicit user request.
  layer.eachLayer(subLayer => {
    subLayer.on('contextmenu', e => {
      L.DomEvent.stop(e);
      _ctxTarget = { subLayer, layer, id };
      const menu = $('map-ctx-menu');
      const editing = !!subLayer.editor;
      menu.querySelector('#ctx-edit-btn').textContent = editing ? '✓ Done editing' : '✏ Edit vertices';
      menu.style.left = e.originalEvent.clientX + 'px';
      menu.style.top  = e.originalEvent.clientY + 'px';
      menu.style.display = 'block';
    });
  });

  const all = Object.values(state.boundaryLayers);
  if (all.length) {
    state.map.fitBounds(L.featureGroup(all).getBounds().pad(0.15), { maxZoom: FIT_MAX_ZOOM });
  }
}

// Find which selected location's bbox contains this amenity. Returns the
// location index or -1. Shared by the dot layers and the per-location counts.
function matchAmenityToLocation(a, selected) {
  for (let i = 0; i < selected.length; i++) {
    const bbox = selected[i].bbox;
    if (!bbox) continue;
    const [minLat, maxLat, minLon, maxLon] = bbox.map(Number);
    if (a.lat >= minLat && a.lat <= maxLat && a.lon >= minLon && a.lon <= maxLon) return i;
  }
  return -1;
}

// Create a separate Leaflet LayerGroup of amenity dots per location so we can
// show/hide them individually when a location is toggled or removed.
function showAmenityDotsPerLocation(amenities, selected) {
  // Clear existing dot layers
  Object.values(state.amenityDotLayers).forEach(l => state.map.removeLayer(l));
  state.amenityDotLayers = {};

  // Assign each amenity to a location by bbox containment
  const perLocAmenities = selected.map(() => []);
  for (const a of amenities) {
    const i = matchAmenityToLocation(a, selected);
    if (i < 0) continue;
    a.benchmark_location = selected[i].display_name?.split(',')[0] || selected[i].name;
    perLocAmenities[i].push(a);
  }

  for (let i = 0; i < selected.length; i++) {
    const locId = selected[i]._id;
    const markers = perLocAmenities[i].map(a => {
      const color = state.groupColors[a.group] || '#999999';
      return L.circleMarker([a.lat, a.lon], {
        radius: 4, color: 'transparent',
        fillColor: color, fillOpacity: 0.72, weight: 0,
      }).bindTooltip(
        `<strong>${fmt(a.type)}</strong>${a.name ? '<br>' + a.name : ''}`,
        { sticky: true }
      );
    });
    const group = L.layerGroup(markers);
    state.amenityDotLayers[locId] = group;
    // Only add to map if the location is currently selected
    if (selected[i].selected) group.addTo(state.map);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// OVERPASS
// ═══════════════════════════════════════════════════════════════════════════

// Convert a GeoJSON Polygon/MultiPolygon geometry to Overpass poly: strings
// ("lat lon lat lon …" — outer rings only, closing points stripped).
// A MultiPolygon yields one string per part so no part is silently dropped.
function geojsonToPolys(geojson) {
  if (!geojson) return [];
  const ringToStr = ring => ring.slice(0, -1).map(([lon, lat]) => `${lat} ${lon}`).join(' ');
  if (geojson.type === 'Polygon')      return [ringToStr(geojson.coordinates[0])];
  if (geojson.type === 'MultiPolygon') return geojson.coordinates.map(part => ringToStr(part[0]));
  return [];
}

// Build the Overpass QL query string for a set of locations. Pure — no network.
function buildOverpassQuery(locations) {
  // Relations reliably get area objects in Overpass; ways do not always, so use poly: for them
  const areaLocs = locations.filter(l => !l.edited && l.osm_type === 'relation');
  const polyLocs = locations.filter(l => (l.edited || l.osm_type !== 'relation') && l.geojson);

  let query = '[out:json][timeout:120];\n';

  // Named area set for unedited OSM locations
  if (areaLocs.length) {
    const areaLines = areaLocs.map(loc => {
      const areaId = (loc.osm_type === 'way' ? 2_400_000_000 : 3_600_000_000) + loc.osm_id;
      return `  area(id:${areaId});`;
    }).join('\n');
    query += `(\n${areaLines}\n)->.s;\n`;
  }

  // Union: area.s for originals + poly: for each edited polygon
  const parts = [];
  if (areaLocs.length) {
    parts.push(
      '  node["amenity"](area.s)', '  way["amenity"](area.s)',
      '  node["shop"](area.s)',    '  way["shop"](area.s)',
    );
  }
  for (const loc of polyLocs) {
    for (const poly of geojsonToPolys(loc.geojson)) {
      parts.push(
        `  node["amenity"](poly:"${poly}")`, `  way["amenity"](poly:"${poly}")`,
        `  node["shop"](poly:"${poly}")`,    `  way["shop"](poly:"${poly}")`,
      );
    }
  }
  query += `(\n${parts.join(';\n')};\n);\nout center tags;`;
  return query;
}

// POST a query to Overpass, retrying on 429 rate-limits with back-off.
async function postOverpassWithRetry(query) {
  const delays = OVERPASS_RETRY_DELAYS_MS;
  for (let attempt = 0; attempt <= delays.length; attempt++) {
    const res = await fetch(OVERPASS, {
      method: 'POST',
      body: new URLSearchParams({ data: query }),
    });
    if (res.ok) return res.json();
    if (res.status === 429 && attempt < delays.length) {
      const wait = delays[attempt];
      setStatus('loading', `Overpass rate-limited — retrying in ${wait / 1000}s… (attempt ${attempt + 2}/${delays.length + 1})`);
      await sleep(wait);
      continue;
    }
    throw new Error(
      res.status === 429
        ? 'Overpass API is rate-limiting this IP — please wait 30 s and try again.'
        : `Overpass error ${res.status}`
    );
  }
}

async function fetchOverpass(locations) {
  return postOverpassWithRetry(buildOverpassQuery(locations));
}

function processOverpass(elements) {
  const amenities = [];
  for (const el of elements) {
    const tags = el.tags || {};
    const type = tags.amenity || tags.shop;
    if (!type || EXCLUDE.has(type)) continue;
    const group = state.amenityToGroup[type];
    if (!group) continue;
    const lat = el.type === 'node' ? el.lat : el.center?.lat;
    const lon = el.type === 'node' ? el.lon : el.center?.lon;
    if (lat == null || lon == null) continue;
    amenities.push({ type, group, lat, lon, name: tags.name || '', osm_id: el.id, osm_type: el.type, tags: { ...tags } });
  }
  return amenities;
}

function assignToLocations(amenities, selected) {
  const perLoc = selected.map(() => ({ counts: {}, total: 0 }));
  for (const a of amenities) {
    const i = matchAmenityToLocation(a, selected);
    if (i < 0) continue;
    perLoc[i].counts[a.type] = (perLoc[i].counts[a.type] || 0) + 1;
    perLoc[i].total++;
  }
  return perLoc;
}

// ═══════════════════════════════════════════════════════════════════════════
// NORMALISED DIAGRAM DATA
// ═══════════════════════════════════════════════════════════════════════════

function buildNormalizedDiagramData() {
  const perLoc = state.perLocCounts;
  const activeLocs = perLoc.filter(l => l.total > 0);
  const N = activeLocs.length || 1;

  // Average share of each amenity type across locations — every location
  // weighs equally regardless of how many amenities it contains.
  const avgProp = {};
  for (const loc of activeLocs) {
    for (const [type, count] of Object.entries(loc.counts)) {
      avgProp[type] = (avgProp[type] || 0) + count / loc.total;
    }
  }
  for (const t of Object.keys(avgProp)) avgProp[t] /= N;

  const totalProp = Object.values(avgProp).reduce((s, v) => s + v, 0) || 1;

  // Average amenities per location. The "avg ~N" counts shown everywhere are
  // derived from the normalised shares (proportion × avgTotal) so percentages
  // and counts always agree exactly.
  const avgTotal = activeLocs.reduce((s, l) => s + l.total, 0) / N;

  const groups = [];
  for (const g of state.groups) {
    const items = [];
    for (const item of g.items) {
      if (avgProp[item]) {
        const proportion = avgProp[item] / totalProp;
        items.push({ id: item, count: proportion * avgTotal, proportion });
      }
    }
    if (!items.length) continue;
    items.sort((a, b) => b.proportion - a.proportion);
    groups.push({
      id: g.name, color: g.color, description: g.description || '',
      total: items.reduce((s, i) => s + i.proportion, 0),
      total_count: items.reduce((s, i) => s + i.count, 0),
      children: items,
    });
  }
  groups.sort((a, b) => b.total - a.total);

  return { groups, total_amenities: avgTotal };
}

// ═══════════════════════════════════════════════════════════════════════════
// ANALYSE
// ═══════════════════════════════════════════════════════════════════════════

async function analyzeAmenities() {
  const selected = state.locations.filter(l => l.selected && l.status === 'ready');
  if (!selected.length) { setStatus('warn', 'No ready locations selected.'); return; }

  $('diagram-empty').style.display = 'none';
  $('diagram-content').style.display = 'none';
  $('diagram-loading').style.display = '';
  $('loading-detail').textContent = `Querying OpenStreetMap for ${selected.length} area(s)…`;
  $('analyze-btn').disabled = true;
  setStatus('loading', 'Fetching amenities from Overpass…');

  try {
    const data = await fetchOverpass(selected);
    const amenities = processOverpass(data.elements || []);
    state.amenities = amenities;

    if (!amenities.length) throw new Error('No matching amenities found in these areas.');

    state.perLocCounts = assignToLocations(amenities, selected);
    showAmenityDotsPerLocation(amenities, selected);

    const diagData = buildNormalizedDiagramData();
    const avgTotal = Math.round(diagData.total_amenities);

    $('loading-detail').textContent = `${amenities.length} amenities found. Rendering…`;
    $('map-stats').style.display = '';
    $('map-stats').innerHTML =
      `<strong>${amenities.length.toLocaleString()}</strong> total · ` +
      `<strong>avg ~${avgTotal}</strong> per location · ` +
      `<strong>${selected.length}</strong> area${selected.length > 1 ? 's' : ''}`;

    redrawBubbleChart();
    setStatus('idle', `Done — ${amenities.length.toLocaleString()} amenities · avg ~${avgTotal} per location.`);
  } catch (e) {
    $('diagram-loading').style.display = 'none';
    $('diagram-empty').style.display = '';
    $('diagram-empty').querySelector('.empty-text').textContent = e.message;
    setStatus('error', `Error: ${e.message}`);
  } finally {
    $('analyze-btn').disabled = false;
  }
}

function redrawBubbleChart() {
  if (!state.amenities.length) return;
  const data = buildNormalizedDiagramData();
  const selected = state.locations.filter(l => l.selected && l.status === 'ready');
  renderDiagram(data, selected);
}

// ═══════════════════════════════════════════════════════════════════════════
// DIAGRAM RENDER  (D3 v7)
// ═══════════════════════════════════════════════════════════════════════════

function renderDiagram(data, selectedLocs) {
  $('diagram-loading').style.display = 'none';
  $('diagram-content').style.display = '';

  $('diagram-title').textContent = 'Amenity ecosystem — normalised average';
  const names = selectedLocs.map(l => (l.display_name || l.name).split(',')[0]).join(', ');
  $('diagram-subtitle').textContent =
    `avg ~${Math.round(data.total_amenities)} amenities per location · ${selectedLocs.length} location(s) · ${names}`;

  buildBubbleChart(data.groups);
  buildLegend(data.groups);
}

// Fit label text inside a circle of radius r.
// Returns font-size used, or 0 if too small to show.
// Tries single-line first; if wrapping to 2 lines gives ≥20% bigger font, wraps.
function applyBubbleLabel(textEl, name, r) {
  const label = fmt(name);
  const words = label.split(' ');

  // Character width ≈ 0.55 × fontSize; effective chord width ≈ 1.7 × r
  // Always produce at least 1.5 px so the label is in the DOM and appears on zoom-in
  const fitFs = (chars) => Math.max(1.5, Math.min(r * 0.40, (r * 1.7) / (chars * 0.55), 13));

  const fs1 = fitFs(label.length);

  if (words.length > 1 && r >= 12) {
    const mid   = Math.ceil(words.length / 2);
    const line1 = words.slice(0, mid).join(' ');
    const line2 = words.slice(mid).join(' ');
    const fs2   = fitFs(Math.max(line1.length, line2.length));

    if (fs2 >= fs1 * 1.15) {
      textEl.style('font-size', fs2 + 'px').text('');
      textEl.append('tspan')
        .attr('x', textEl.attr('x')).attr('dy', '-0.62em').text(line1);
      textEl.append('tspan')
        .attr('x', textEl.attr('x')).attr('dy', '1.25em').text(line2);
      return fs2;
    }
  }

  textEl.style('font-size', fs1 + 'px').text(label);
  return fs1;
}

// Run d3.pack over the groups and return the laid-out hierarchy root.
function createPackLayout(groups, W, H) {
  const root = d3.hierarchy({
    name: 'root',
    children: groups.map(g => ({
      name: g.id, color: g.color, total_count: g.total_count,
      children: g.children.map(c => ({ name:c.id, color:g.color, value:c.proportion, count:c.count })),
    })),
  })
    .sum(d => d.value || 0)
    .sort((a, b) => b.value - a.value);

  const pad = Math.min(W, H) * 0.014;
  d3.pack().size([W, H]).padding(d => {
    if (d.depth === 0) return pad * 3.5;
    if (d.depth === 1) return pad * 1.8;
    return pad * 0.6;
  })(root);

  return root;
}

// Wire pan/zoom onto the svg. Returns { toggle(event, d) } used by halo clicks
// to zoom into / out of a group. Clicking empty space resets the view.
function attachBubbleZoom(svg, g, W, H) {
  let zoomedGroup = null;

  const zoom = d3.zoom()
    .scaleExtent([0.9, 12])
    .on('zoom', ev => {
      g.attr('transform', ev.transform);
      const k = ev.transform.k;
      g.selectAll('.leaf-label')
        .attr('opacity', function() { return +d3.select(this).attr('data-r') * k >= 8 ? 1 : 0; });
    });

  svg.call(zoom).on('dblclick.zoom', null);

  const reset = () => {
    zoomedGroup = null;
    svg.style('cursor', 'default');
    svg.transition().duration(500).call(zoom.transform, d3.zoomIdentity);
  };
  svg.on('click', reset);

  return {
    toggle(event, d) {
      event.stopPropagation();
      if (zoomedGroup === d) { reset(); return; }
      zoomedGroup = d;
      svg.style('cursor', 'zoom-out');
      const k = Math.min(W, H) / (d.r * 2.4);
      svg.transition().duration(600).call(
        zoom.transform,
        d3.zoomIdentity.translate(W / 2 - k * d.x, H / 2 - k * d.y).scale(k)
      );
    },
  };
}

// Pastel group halos — clicking one zooms into that group.
function drawHalos(g, root, zoomCtl) {
  g.selectAll('.halo')
    .data(root.children)
    .join('circle')
    .attr('class', 'halo')
    .attr('cx', d => d.x).attr('cy', d => d.y).attr('r', d => d.r)
    .attr('fill', d => hexToPastel(d.data.color, 0.83))
    .attr('stroke', 'none')
    .style('cursor', 'zoom-in')
    .on('click', (event, d) => zoomCtl.toggle(event, d));
}

// Per-amenity bubbles with hover tooltip.
function drawLeafBubbles(g, root) {
  const tooltip = d3.select('#tooltip');
  g.selectAll('.bubble')
    .data(root.leaves())
    .join('circle')
    .attr('class', 'bubble')
    .attr('cx', d => d.x).attr('cy', d => d.y).attr('r', d => d.r)
    .attr('fill', d => d.data.color)
    .attr('opacity', 0.9)
    .on('mousemove', (event, d) => {
      tooltip.classed('visible', true)
        .style('left', event.clientX + 14 + 'px')
        .style('top',  event.clientY - 10 + 'px')
        .html(`<div class="tooltip-name">${fmt(d.data.name)}</div>` +
              `<div class="tooltip-detail">avg ${d.data.count.toFixed(1)} · ${(d.data.value*100).toFixed(1)}% · ${d.parent.data.name}</div>`);
    })
    .on('mouseleave', () => tooltip.classed('visible', false));
}

// Auto-sized amenity labels (hidden until the bubble is big enough on screen).
function drawLeafLabels(g, root) {
  g.selectAll('.leaf-label')
    .data(root.leaves())
    .join('text')
    .attr('class', 'bubble-label leaf-label')
    .attr('x', d => d.x).attr('y', d => d.y)
    .attr('data-r', d => d.r)  // used by zoom handler
    .attr('opacity', d => d.r >= 8 ? 1 : 0)
    .each(function(d) {
      applyBubbleLabel(d3.select(this), d.data.name, d.r);
    });
}

// Group names above each halo (only when the halo is large enough).
function drawGroupLabels(g, root, W, H) {
  const MIN_HALO_R = Math.min(W, H) * 0.055;
  g.selectAll('.halo-label')
    .data(root.children.filter(d => d.r >= MIN_HALO_R))
    .join('text')
    .attr('class', 'bubble-label')
    .attr('x', d => d.x)
    .attr('y', d => {
      const topChild = Math.min(...d.children.map(c => c.y - c.r));
      return Math.min(topChild - 5, d.y - d.r + 13);
    })
    .style('font-size', d => Math.min(d.r * 0.16, 11) + 'px')
    .style('fill', d => d.data.color)
    .style('opacity', 0.85)
    .text(d => d.data.name);
}

function buildBubbleChart(groups) {
  const svg = d3.select('#bubble-svg');
  svg.selectAll('*').remove();

  const el = $('bubble-container');
  const W = el.clientWidth, H = el.clientHeight;
  if (W < 50 || H < 50) return;
  svg.attr('viewBox', `0 0 ${W} ${H}`);

  const root    = createPackLayout(groups, W, H);
  const g       = svg.append('g');
  const zoomCtl = attachBubbleZoom(svg, g, W, H);

  drawHalos(g, root, zoomCtl);
  drawLeafBubbles(g, root);
  drawLeafLabels(g, root);
  drawGroupLabels(g, root, W, H);
}

function buildLegend(groups) {
  const c = $('legend-container');
  c.innerHTML = '';
  for (const g of groups) {
    const pct      = (g.total * 100).toFixed(1);
    const topTypes = g.children.slice(0,4).map(x => fmt(x.id)).join(', ') + (g.children.length > 4 ? '…' : '');
    const item = document.createElement('div');
    item.className = 'legend-item';
    item.innerHTML =
      `<div><div class="legend-swatch" style="background:${g.color}"></div></div>
       <div style="flex:1; min-width:0">
         <div class="legend-name">${g.id}</div>
         <div class="legend-stat">${pct}% · avg ~${Math.round(g.total_count)} per location</div>
         ${g.description ? `<div class="legend-desc">${g.description}</div>` : ''}
         <div class="legend-types">${topTypes}</div>
       </div>`;
    c.appendChild(item);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// SVG DOWNLOAD — bubble chart + legend in one standalone SVG
// ═══════════════════════════════════════════════════════════════════════════

// Layout constants for the exported legend panel
const SVG_LEGEND = { pad: 24, rowH: 22, titleH: 30, cols: 2 };

// Build the legend <g> element appended below the exported chart.
// Returns { legendG, legendH }.
function buildLegendSvg(groups, W) {
  const { pad, rowH, titleH, cols } = SVG_LEGEND;
  const rows    = Math.ceil(groups.length / cols);
  const legendH = titleH + rows * rowH + pad;
  const ns      = 'http://www.w3.org/2000/svg';

  const legG = document.createElementNS(ns, 'g');

  const legBg = document.createElementNS(ns, 'rect');
  legBg.setAttribute('width', W); legBg.setAttribute('height', legendH);
  legBg.setAttribute('fill', 'rgba(255,255,255,0.76)');
  legG.appendChild(legBg);

  const sep = document.createElementNS(ns, 'line');
  sep.setAttribute('x1', 0); sep.setAttribute('x2', W);
  sep.setAttribute('y1', 0); sep.setAttribute('y2', 0);
  sep.setAttribute('stroke', 'rgba(0,0,0,0.07)'); sep.setAttribute('stroke-width', '1');
  legG.appendChild(sep);

  const title = document.createElementNS(ns, 'text');
  title.setAttribute('x', pad); title.setAttribute('y', 18);
  title.setAttribute('font-size', '9'); title.setAttribute('font-weight', '700');
  title.setAttribute('letter-spacing', '0.12em'); title.setAttribute('fill', '#999');
  title.textContent = 'AMENITY GROUPS';
  legG.appendChild(title);

  const colW = W / cols;
  groups.forEach((g, i) => {
    const x = (i % cols) * colW + pad;
    const y = titleH + Math.floor(i / cols) * rowH;

    const swatch = document.createElementNS(ns, 'rect');
    swatch.setAttribute('x', x); swatch.setAttribute('y', y - 7);
    swatch.setAttribute('width', 9); swatch.setAttribute('height', 9);
    swatch.setAttribute('rx', 2); swatch.setAttribute('fill', g.color);
    legG.appendChild(swatch);

    const rowText = document.createElementNS(ns, 'text');
    rowText.setAttribute('x', x + 14); rowText.setAttribute('y', y + 1);
    rowText.setAttribute('font-size', '11.5');

    const name = document.createElementNS(ns, 'tspan');
    name.setAttribute('font-weight', '700'); name.setAttribute('fill', '#1a1a1a');
    name.textContent = g.id;
    rowText.appendChild(name);

    const stat = document.createElementNS(ns, 'tspan');
    stat.setAttribute('font-weight', '400'); stat.setAttribute('fill', '#666');
    stat.textContent = `  ${(g.total * 100).toFixed(1)}%  ·  avg ~${Math.round(g.total_count)}`;
    rowText.appendChild(stat);

    legG.appendChild(rowText);
  });

  return { legendG: legG, legendH };
}

function downloadSVG() {
  const svgEl = document.getElementById('bubble-svg');
  if (!svgEl || !svgEl.children.length) return;

  const data = buildNormalizedDiagramData();
  if (!data.groups.length) return;

  const vb      = svgEl.viewBox.baseVal;
  const W       = vb?.width  || svgEl.clientWidth  || 960;
  const CHART_H = vb?.height || svgEl.clientHeight || 580;

  const { legendG, legendH } = buildLegendSvg(data.groups, W);
  const TOTAL_H = CHART_H + legendH;

  const ns  = 'http://www.w3.org/2000/svg';
  const out = document.createElementNS(ns, 'svg');
  out.setAttribute('xmlns', ns);
  out.setAttribute('width',   W);
  out.setAttribute('height',  TOTAL_H);
  out.setAttribute('viewBox', `0 0 ${W} ${TOTAL_H}`);

  // Standalone font + label styling so the file renders correctly outside the app
  const style = document.createElementNS(ns, 'style');
  style.textContent =
    "@import url('https://fonts.googleapis.com/css2?family=Open+Sans:wght@400;600;700&display=swap');" +
    'text{font-family:"Open Sans",system-ui,sans-serif;}' +
    '.bubble-label{font-weight:600;text-anchor:middle;dominant-baseline:middle;fill:white;pointer-events:none;}';
  out.appendChild(style);

  const bg = document.createElementNS(ns, 'rect');
  bg.setAttribute('width', W); bg.setAttribute('height', TOTAL_H);
  bg.setAttribute('fill', '#f6f7f8');
  out.appendChild(bg);

  // Bubble chart — clone live SVG contents, reset any zoom transform
  const chartClone = svgEl.cloneNode(true);
  const outerG = chartClone.querySelector('g');
  if (outerG) outerG.removeAttribute('transform');
  Array.from(chartClone.childNodes).forEach(n => out.appendChild(n.cloneNode(true)));

  legendG.setAttribute('transform', `translate(0,${CHART_H})`);
  out.appendChild(legendG);

  triggerDownload(
    new XMLSerializer().serializeToString(out),
    'amenity-ecosystem.svg', 'image/svg+xml;charset=utf-8'
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// GEOJSON DOWNLOAD
// ═══════════════════════════════════════════════════════════════════════════

function downloadAmenitiesGeoJSON() {
  if (!state.amenities.length) return;

  const features = state.amenities.filter(a => a.lat != null).map(a => ({
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [a.lon, a.lat] },
    properties: {
      osm_id:             a.osm_id   || null,
      osm_type:           a.osm_type || null,
      amenity_type:       a.type,
      name:               a.name     || null,
      group:              a.group,
      benchmark_location: a.benchmark_location || null,
      ...(a.tags || {}),
    },
  }));

  triggerDownload(
    JSON.stringify({ type: 'FeatureCollection', features }, null, 2),
    'amenities.geojson', 'application/json'
  );
}
