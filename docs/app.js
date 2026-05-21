'use strict';

// ═══════════════════════════════════════════════════════════════════════════
// AMENITY FILTERS  (mirrors amenity_config.py EXCLUDE — kept for safety
//                   even though the backend already filters)
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
  mode: 'ai',          // 'ai' | 'osm'
  locations: [],       // [{_id, name, country, search_query, osm_id, osm_type,
                       //   display_name, geojson, bbox, selected, status}]
  amenities: [],
  // Dynamic group schema for the current category — set by AI, or default fallback
  groups: [],          // [{name, color, items: [...], description}]
  amenityToGroup: {},  // amenity_type → group_name lookup
  groupColors: {},     // group_name → hex
  map: null,
  boundaryLayers: {},  // _id → L.GeoJSON
  labelMarkers: {},    // _id → L.Marker (polygon label)
};

const NOMINATIM = 'https://nominatim.openstreetmap.org';
const OVERPASS  = 'https://overpass-api.de/api/interpreter';

const BOUNDARY_PALETTE = ['#2563eb','#7c3aed','#059669','#dc2626','#d97706',
                          '#0891b2','#db2777','#65a30d','#ea580c','#6366f1',
                          '#0ea5e9','#f43f5e','#84cc16','#a855f7'];
let _paletteIdx = 0;

// ═══════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════

const sleep = ms => new Promise(r => setTimeout(r, ms));
const $     = id => document.getElementById(id);
const fmt   = s  => s.replace(/_/g,' ').replace(/;/g,'/').replace(/\b\w/g, c => c.toUpperCase());

function hexToPasstel(hex, mix = 0.82) {
  const h = hex.replace('#','');
  let r = parseInt(h.slice(0,2),16), g = parseInt(h.slice(2,4),16), b = parseInt(h.slice(4,6),16);
  r = Math.round(r + (255-r)*mix); g = Math.round(g + (255-g)*mix); b = Math.round(b + (255-b)*mix);
  return `rgb(${r},${g},${b})`;
}

function setStatus(type, msg) {
  $('status-dot').className = `status-dot ${type === 'idle' ? '' : type}`;
  $('status-msg').textContent = msg;
}

function setGroups(groups) {
  state.groups = groups;
  state.amenityToGroup = {};
  state.groupColors = {};
  for (const g of groups) {
    state.groupColors[g.name] = g.color;
    for (const item of g.items) {
      // First group wins if duplicates
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
  loadDefaultGroups();   // ready to go even if AI never runs
  setMode('ai');
});

function initMap() {
  state.map = L.map('map', { center:[25,10], zoom:2, worldCopyJump:true });
  L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
    attribution: '© <a href="https://openstreetmap.org">OSM</a> contributors © <a href="https://carto.com">CARTO</a>',
    subdomains: 'abcd', maxZoom: 19,
  }).addTo(state.map);

  // Resize the SVG when the window resizes
  window.addEventListener('resize', () => {
    state.map.invalidateSize();
    if (state.groups.length && state.amenities.length) redrawBubbleChart();
  });
}

function bindEvents() {
  $('mode-ai').addEventListener('click',  () => setMode('ai'));
  $('mode-osm').addEventListener('click', () => setMode('osm'));

  $('search-btn').addEventListener('click', handleSearch);
  $('search-input').addEventListener('keydown', e => { if (e.key === 'Enter') handleSearch(); });
  $('analyze-btn').addEventListener('click', analyzeAmenities);
}

function setMode(mode) {
  state.mode = mode;
  $('mode-ai').classList.toggle('active',  mode === 'ai');
  $('mode-osm').classList.toggle('active', mode === 'osm');

  const cfg = {
    ai:  ['e.g. boutique design district, mountain ski resort, financial CBD…',
          'AI mode: describe any location type — Gemini suggests benchmark examples + custom amenity groups.'],
    osm: ['e.g. 62149, 5750005, 7444  (comma-separated OSM relation IDs)',
          'OSM ID mode: paste relation IDs from openstreetmap.org. Uses default groups.'],
  }[mode];

  $('search-input').placeholder = cfg[0];
  $('search-hint').textContent  = cfg[1];
  $('num-locations').style.display = mode === 'ai' ? '' : 'none';
}

async function loadDefaultGroups() {
  try {
    const res = await fetch('/api/defaults');
    if (res.ok) setGroups((await res.json()).groups);
  } catch {
    // Frontend may also be served without backend — provide hard-coded fallback
    setGroups([
      { name:'Dining',             color:'#E69F00', items:['restaurant','restaurant;bar','cafe','coffee','fast_food','biergarten','ice_cream'] },
      { name:'Nightlife',          color:'#D55E00', items:['bar','pub','nightclub','casino'] },
      { name:'Food Retail',        color:'#56B4E9', items:['supermarket','convenience','bakery','butcher','cheese','deli','pastry','chocolate','health_food','alcohol','general','confectionery','wine','farm'] },
      { name:'Sport & Ski',        color:'#009E73', items:['sports','outdoor','ski','ski_rental','ski_school','avalanche_transceiver','snow_park','bicycle_rental','water_sports','boat_rental','fitness_equipment','lift_tickets','bicycle'] },
      { name:'Fashion & Beauty',   color:'#CC79A7', items:['clothes','shoes','fashion_accessories','leather','tailor','cosmetics','perfumery','beauty','hairdresser','optician'] },
      { name:'Health & Medical',   color:'#0072B2', items:['pharmacy','clinic','doctors','hospital','dentist','medical_supply','hearing_aids','chemist','veterinary','massage','public_bath'] },
      { name:'Gifts & Speciality', color:'#F0E442', items:['gift','jewelry','second_hand','variety_store','craft','toys','florist','stationery','books','newsagent','kiosk','photo','tobacco'] },
      { name:'Home & Electronics', color:'#999999', items:['furniture','houseware','interior_decoration','hardware','doityourself','electrical','garden_centre','paint','kitchen','wholesale','department_store','mall','electronics','computer','mobile_phone','hifi','camera','bed','studio'] },
      { name:'Culture & Community',color:'#44AA99', items:['bank','cinema','travel_agency','dry_cleaning','laundry','theatre','locksmith','arts_centre','art','music_school','conference_centre','library','place_of_worship','school','kindergarten','childcare','community_centre','social_facility','clubhouse','driving_school'] },
    ]);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// SEARCH
// ═══════════════════════════════════════════════════════════════════════════

async function handleSearch() {
  const q = $('search-input').value.trim();
  if (!q) return;
  if (state.mode === 'ai') await aiSearch(q);
  else                     await addOsmIds(q);
}

async function aiSearch(category) {
  setStatus('loading', `Asking Gemini for "${category}" benchmark locations…`);
  $('search-btn').disabled = true;

  try {
    const numLocations = parseInt($('num-locations').value, 10) || 15;

    const res = await fetch('/api/suggest', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ category, num_locations: numLocations }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }));
      throw new Error(err.detail || res.statusText);
    }

    const data = await res.json();
    setGroups(data.groups);

    const locs = data.locations || [];
    setStatus('loading', `Geocoding ${locs.length} locations…`);

    // Clear any previous run
    resetLocations();

    for (const loc of locs) {
      loc._id = crypto.randomUUID();
      addChip(loc);
    }

    // Sequential geocoding — Nominatim 1 req/sec policy
    for (const loc of locs) {
      await geocodeLoc(loc);
      await sleep(1150);
    }

    setStatus('idle', `${locs.length} locations ready · ${state.groups.length} amenity groups defined. Click Analyse.`);
  } catch (e) {
    setStatus('error', `AI search failed: ${e.message}`);
  } finally {
    $('search-btn').disabled = false;
  }
}

async function addOsmIds(input) {
  const ids = input.split(/[\s,]+/).map(s => s.trim()).filter(Boolean)
                   .map(Number).filter(n => n > 0);
  if (!ids.length) { setStatus('warn', 'No valid relation IDs found.'); return; }

  setStatus('loading', `Looking up ${ids.length} OSM relation(s)…`);
  resetLocations();

  for (const id of ids) {
    const loc = {
      _id: crypto.randomUUID(),
      name: `Relation ${id}`,
      country: '',
      search_query: '',     // we'll look up via the OSM lookup endpoint
      osm_id: id,
      osm_type: 'relation',
    };
    addChip(loc);
    await geocodeLocByOsmId(loc);
    await sleep(1150);
  }
  setStatus('idle', `${ids.length} location(s) ready. Click Analyse.`);
}

// ═══════════════════════════════════════════════════════════════════════════
// CHIPS
// ═══════════════════════════════════════════════════════════════════════════

function resetLocations() {
  state.locations = [];
  Object.values(state.boundaryLayers).forEach(l => state.map.removeLayer(l));
  Object.values(state.labelMarkers).forEach(l => state.map.removeLayer(l));
  state.boundaryLayers = {};
  state.labelMarkers = {};
  $('locations-bar').innerHTML = '';
  $('locations-bar').classList.remove('visible');
  $('analyze-btn').style.display = 'none';
  $('map-stats').style.display = 'none';
  $('diagram-content').style.display = 'none';
  $('diagram-loading').style.display = 'none';
  $('diagram-empty').style.display = '';
  _paletteIdx = 0;
}

function addChip(loc) {
  const bar = $('locations-bar');
  bar.classList.add('visible');

  const chip = document.createElement('div');
  chip.className = 'location-chip selected loading';
  chip.dataset.id = loc._id;
  chip.innerHTML = `
    <span class="chip-spinner"></span>
    <span class="chip-name">${loc.name}</span>
    ${loc.country ? `<span style="color:var(--text-3);font-size:11px">${loc.country}</span>` : ''}
    <span class="chip-remove" title="Remove">×</span>
  `;
  chip.querySelector('.chip-remove').addEventListener('click', e => {
    e.stopPropagation();
    removeLocation(loc._id);
  });
  chip.addEventListener('click', () => toggleLocation(loc._id));
  bar.appendChild(chip);

  state.locations.push({ ...loc, selected: true, status: 'pending' });
  $('analyze-btn').style.display = '';
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

function toggleLocation(id) {
  const loc = state.locations.find(l => l._id === id);
  if (!loc || loc.status !== 'ready') return;
  loc.selected = !loc.selected;
  document.querySelector(`.location-chip[data-id="${id}"]`)?.classList.toggle('selected', loc.selected);
  const layer = state.boundaryLayers[id];
  if (layer) layer.setStyle({ opacity: loc.selected ? 0.85 : 0.25, fillOpacity: loc.selected ? 0.22 : 0.04 });
  const lbl = state.labelMarkers[id];
  if (lbl) lbl.getElement()?.style && (lbl.getElement().style.opacity = loc.selected ? '1' : '0.3');
}

function removeLocation(id) {
  const idx = state.locations.findIndex(l => l._id === id);
  if (idx >= 0) state.locations.splice(idx, 1);
  document.querySelector(`.location-chip[data-id="${id}"]`)?.remove();
  if (state.boundaryLayers[id]) { state.map.removeLayer(state.boundaryLayers[id]); delete state.boundaryLayers[id]; }
  if (state.labelMarkers[id])   { state.map.removeLayer(state.labelMarkers[id]);   delete state.labelMarkers[id]; }
  if (!state.locations.length) {
    $('locations-bar').classList.remove('visible');
    $('analyze-btn').style.display = 'none';
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// GEOCODING  (Nominatim, called directly from browser)
// ═══════════════════════════════════════════════════════════════════════════

async function callNominatim(q, limit = 5) {
  const url = new URL(`${NOMINATIM}/search`);
  url.searchParams.set('q', q);
  url.searchParams.set('format', 'json');
  url.searchParams.set('limit', limit);
  url.searchParams.set('polygon_geojson', '1');
  url.searchParams.set('addressdetails', '1');
  url.searchParams.set('email', 'bench.michin@gmail.com');
  const res = await fetch(url, { headers:{ Accept:'application/json' } });
  if (!res.ok) throw new Error(`Nominatim ${res.status}`);
  return res.json();
}

async function callNominatimLookup(osmType, osmId) {
  // /lookup endpoint - works by OSM type+id directly
  const url = new URL(`${NOMINATIM}/lookup`);
  url.searchParams.set('osm_ids', `${osmType[0].toUpperCase()}${osmId}`);
  url.searchParams.set('format', 'json');
  url.searchParams.set('polygon_geojson', '1');
  url.searchParams.set('email', 'bench.michin@gmail.com');
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
  Object.assign(loc, {
    osm_id: parseInt(r.osm_id),
    osm_type: r.osm_type,
    display_name: r.display_name,
    geojson: ensurePolygon(r.geojson, r.boundingbox),
    bbox: r.boundingbox,
    status: 'ready',
  });
  const entry = state.locations.find(l => l._id === loc._id);
  if (entry) Object.assign(entry, loc);

  updateChip(loc._id, 'ready', shortName);
  if (loc.geojson) showBoundary(loc._id, loc.geojson, loc.name || shortName);
}

// If Nominatim returned only a point (or no geometry), build a polygon from bbox
function ensurePolygon(geojson, bbox) {
  if (geojson && (geojson.type === 'Polygon' || geojson.type === 'MultiPolygon')) {
    return geojson;
  }
  if (bbox && bbox.length === 4) {
    const [minLat, maxLat, minLon, maxLon] = bbox.map(Number);
    return {
      type: 'Polygon',
      coordinates: [[
        [minLon, minLat], [maxLon, minLat],
        [maxLon, maxLat], [minLon, maxLat],
        [minLon, minLat],
      ]],
    };
  }
  return null;
}

// ═══════════════════════════════════════════════════════════════════════════
// MAP — polygons only, with a label per polygon
// ═══════════════════════════════════════════════════════════════════════════

function showBoundary(id, geojson, name) {
  const color = BOUNDARY_PALETTE[_paletteIdx++ % BOUNDARY_PALETTE.length];

  const layer = L.geoJSON(geojson, {
    style: { color, weight: 2, opacity: 0.85, fillColor: color, fillOpacity: 0.22 },
  }).addTo(state.map);
  layer.bindTooltip(name, { sticky:true });
  state.boundaryLayers[id] = layer;

  // Add a label marker at the centroid
  try {
    const bounds = layer.getBounds();
    const center = bounds.getCenter();
    const label = L.marker(center, {
      icon: L.divIcon({
        className: '',
        html: `<div class="polygon-label" style="border-color:${color}">${name}</div>`,
        iconSize: null,
      }),
      interactive: false,
    }).addTo(state.map);
    state.labelMarkers[id] = label;
  } catch {}

  // Fit map to show all boundaries
  const all = Object.values(state.boundaryLayers);
  if (all.length) {
    state.map.fitBounds(L.featureGroup(all).getBounds().pad(0.15), { maxZoom: 13 });
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// OVERPASS  (called directly from browser)
// ═══════════════════════════════════════════════════════════════════════════

async function fetchOverpass(locations) {
  const areaLines = locations.map(loc => {
    const areaId = (loc.osm_type === 'way' ? 2_400_000_000 : 3_600_000_000) + loc.osm_id;
    return `  area(id:${areaId});`;
  }).join('\n');

  const query =
    `[out:json][timeout:120];\n(\n${areaLines}\n)->.s;\n` +
    `(\n  node["amenity"](area.s);\n  way["amenity"](area.s);\n` +
    `  node["shop"](area.s);\n  way["shop"](area.s);\n);\nout center tags;`;

  const res = await fetch(OVERPASS, {
    method: 'POST',
    body: new URLSearchParams({ data: query }),
  });
  if (!res.ok) throw new Error(`Overpass ${res.status}`);
  return res.json();
}

function processOverpass(elements) {
  const amenities = [];
  for (const el of elements) {
    const tags = el.tags || {};
    const type = tags.amenity || tags.shop;
    if (!type || EXCLUDE.has(type)) continue;
    const group = state.amenityToGroup[type];
    if (!group) continue;          // amenity not in any AI group
    const lat = el.type === 'node' ? el.lat : el.center?.lat;
    const lon = el.type === 'node' ? el.lon : el.center?.lon;
    if (lat == null || lon == null) continue;
    amenities.push({ type, group, lat, lon, name: tags.name || '' });
  }
  return amenities;
}

// ═══════════════════════════════════════════════════════════════════════════
// DIAGRAM DATA
// ═══════════════════════════════════════════════════════════════════════════

function buildDiagramData(amenities) {
  const counts = {};
  for (const a of amenities) counts[a.type] = (counts[a.type] || 0) + 1;
  const total = Object.values(counts).reduce((s, n) => s + n, 0);

  const groups = [];
  for (const g of state.groups) {
    const items = [];
    for (const item of g.items) {
      if (counts[item]) items.push({ id:item, count:counts[item], proportion:counts[item]/total });
    }
    if (!items.length) continue;
    items.sort((a,b) => b.proportion - a.proportion);
    groups.push({
      id: g.name,
      color: g.color,
      description: g.description || '',
      total: items.reduce((s,i) => s + i.proportion, 0),
      total_count: items.reduce((s,i) => s + i.count, 0),
      children: items,
    });
  }
  groups.sort((a,b) => b.total - a.total);
  return { groups, total_amenities: total };
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

    $('loading-detail').textContent = `${amenities.length} amenities found. Rendering…`;
    $('map-stats').style.display = '';
    $('map-stats').innerHTML =
      `<strong>${amenities.length.toLocaleString()}</strong> amenities · ` +
      `<strong>${selected.length}</strong> location${selected.length > 1 ? 's' : ''}`;

    redrawBubbleChart();
    setStatus('idle', `Done — ${amenities.length.toLocaleString()} amenities across ${selected.length} location(s).`);
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
  const data = buildDiagramData(state.amenities);
  const selected = state.locations.filter(l => l.selected && l.status === 'ready');
  renderDiagram(data, selected);
}

// ═══════════════════════════════════════════════════════════════════════════
// DIAGRAM RENDER  (D3 v7)
// ═══════════════════════════════════════════════════════════════════════════

function renderDiagram(data, selectedLocs) {
  $('diagram-loading').style.display = 'none';
  $('diagram-content').style.display = '';

  $('diagram-title').textContent = 'Amenity ecosystem — benchmarked average';
  const names = selectedLocs.map(l => (l.display_name || l.name).split(',')[0]).join(', ');
  $('diagram-subtitle').textContent =
    `${data.total_amenities.toLocaleString()} amenities · ${selectedLocs.length} location(s) · ${names}`;

  buildBubbleChart(data.groups);
  buildLegend(data.groups);
}

function buildBubbleChart(groups) {
  const svg = d3.select('#bubble-svg');
  svg.selectAll('*').remove();

  const el = $('bubble-container');
  const W = el.clientWidth;
  const H = el.clientHeight;
  if (W < 50 || H < 50) return;
  svg.attr('viewBox', `0 0 ${W} ${H}`);

  const root = d3.hierarchy({
    name:'root',
    children: groups.map(g => ({
      name: g.id, color: g.color, total_count: g.total_count,
      children: g.children.map(c => ({ name:c.id, color:g.color, value:c.proportion, count:c.count })),
    })),
  })
    .sum(d => d.value || 0)
    .sort((a,b) => b.value - a.value);

  const pad = Math.min(W,H) * 0.014;
  d3.pack().size([W,H]).padding(d => {
    if (d.depth === 0) return pad * 3.5;
    if (d.depth === 1) return pad * 1.8;
    return pad * 0.6;
  })(root);

  const g = svg.append('g');
  const tooltip = d3.select('#tooltip');

  // Halos
  g.selectAll('.halo')
    .data(root.children)
    .join('circle')
    .attr('class','halo')
    .attr('cx', d => d.x).attr('cy', d => d.y).attr('r', d => d.r)
    .attr('fill', d => hexToPasstel(d.data.color, 0.83))
    .attr('stroke','none');

  const leaves = root.leaves();

  // Amenity bubbles
  g.selectAll('.bubble')
    .data(leaves)
    .join('circle')
    .attr('class','bubble')
    .attr('cx', d => d.x).attr('cy', d => d.y).attr('r', d => d.r)
    .attr('fill', d => d.data.color)
    .attr('opacity', 0.9)
    .on('mousemove', (event, d) => {
      tooltip.classed('visible', true)
        .style('left', event.clientX + 14 + 'px')
        .style('top',  event.clientY - 10 + 'px')
        .html(`<div class="tooltip-name">${fmt(d.data.name)}</div>` +
              `<div class="tooltip-detail">${d.data.count} units · ${(d.data.value*100).toFixed(1)}% · ${d.parent.data.name}</div>`);
    })
    .on('mouseleave', () => tooltip.classed('visible', false));

  // Labels
  const MIN_R = Math.min(W,H) * 0.028;
  g.selectAll('.bubble-label')
    .data(leaves.filter(d => d.r >= MIN_R))
    .join('text')
    .attr('class','bubble-label')
    .attr('x', d => d.x).attr('y', d => d.y)
    .style('font-size', d => Math.min(d.r * 0.36, 12) + 'px')
    .text(d => {
      const label = fmt(d.data.name);
      return label.length > 14 && d.r < MIN_R * 2.2 ? label.split(' ')[0] : label;
    });

  // Group name labels
  const MIN_HALO_R = Math.min(W,H) * 0.055;
  g.selectAll('.halo-label')
    .data(root.children.filter(d => d.r >= MIN_HALO_R))
    .join('text')
    .attr('class','bubble-label')
    .attr('x', d => d.x)
    .attr('y', d => {
      const topChild = Math.min(...d.children.map(c => c.y - c.r));
      return Math.min(topChild - 5, d.y - d.r + 13);
    })
    .style('font-size', d => Math.min(d.r * 0.16, 10) + 'px')
    .style('fill', d => d.data.color)
    .style('opacity', 0.8)
    .text(d => d.data.name);
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
         <div class="legend-stat">${pct}% · ~${Math.round(g.total_count)} units</div>
         ${g.description ? `<div class="legend-desc">${g.description}</div>` : ''}
         <div class="legend-types">${topTypes}</div>
       </div>`;
    c.appendChild(item);
  }
}
