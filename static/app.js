/* ═══════════════════════════════════════════════════════════════════════════
   Amenity Benchmark — frontend
   ═══════════════════════════════════════════════════════════════════════════ */

'use strict';

// ── State ──────────────────────────────────────────────────────────────────

const state = {
  mode: 'ai',
  // Each entry: {id, name, country, description, search_query,
  //              osm_id, osm_type, display_name, geojson, bbox,
  //              selected, status: 'pending'|'loading'|'ready'|'error'}
  locations: [],
  amenities: [],
  diagData: null,
  map: null,
  boundaryLayers: {},   // id → L.GeoJSON
  amenityLayer: null,   // L.layerGroup
  hiddenGroups: new Set(),
};

// ── Group colours (must match amenity_config.py) ───────────────────────────

const GROUP_COLORS = {
  'Dining':             '#E69F00',
  'Nightlife':          '#D55E00',
  'Food Retail':        '#56B4E9',
  'Sport & Ski':        '#009E73',
  'Fashion & Beauty':   '#CC79A7',
  'Health & Medical':   '#0072B2',
  'Gifts & Speciality': '#F0E442',
  'Home & Electronics': '#999999',
  'Culture & Community':'#44AA99',
};

// ── Helpers ────────────────────────────────────────────────────────────────

const sleep = ms => new Promise(r => setTimeout(r, ms));

const $ = id => document.getElementById(id);

function setStatus(type, msg) {
  // type: 'idle' | 'loading' | 'error' | 'warn'
  $('status-dot').className = `status-dot ${type === 'idle' ? '' : type}`;
  $('status-msg').textContent = msg;
}

function hexToPasstel(hex, mix = 0.80) {
  const h = hex.replace('#', '');
  let r = parseInt(h.slice(0,2),16);
  let g = parseInt(h.slice(2,4),16);
  let b = parseInt(h.slice(4,6),16);
  r = Math.round(r + (255 - r) * mix);
  g = Math.round(g + (255 - g) * mix);
  b = Math.round(b + (255 - b) * mix);
  return `rgb(${r},${g},${b})`;
}

function formatAmenityName(s) {
  return s.replace(/_/g, ' ')
          .replace(/;/g, '/')
          .replace(/\b\w/g, c => c.toUpperCase());
}

// ── Initialise ────────────────────────────────────────────────────────────

window.addEventListener('DOMContentLoaded', () => {
  initMap();
  bindEvents();
  setMode('ai');
});

function initMap() {
  state.map = L.map('map', {
    center: [20, 10],
    zoom: 2,
    zoomControl: true,
    attributionControl: true,
  });

  L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
    attribution: '© <a href="https://openstreetmap.org">OSM</a> contributors, © <a href="https://carto.com">CARTO</a>',
    subdomains: 'abcd',
    maxZoom: 19,
  }).addTo(state.map);

  state.amenityLayer = L.layerGroup().addTo(state.map);
}

function bindEvents() {
  $('mode-ai').addEventListener('click', () => setMode('ai'));
  $('mode-osm').addEventListener('click', () => setMode('osm'));

  $('search-btn').addEventListener('click', handleSearch);
  $('search-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') handleSearch();
  });

  $('analyze-btn').addEventListener('click', analyzeAmenities);
}

function setMode(mode) {
  state.mode = mode;
  $('mode-ai').classList.toggle('active', mode === 'ai');
  $('mode-osm').classList.toggle('active', mode === 'osm');

  if (mode === 'ai') {
    $('search-input').placeholder = 'e.g. CBD, ski resort town, historic city centre…';
    $('search-hint').textContent = 'AI mode: describe a location type and we\'ll suggest benchmark examples worldwide.';
  } else {
    $('search-input').placeholder = 'e.g. 62149, 5750005, 7444 (OSM relation IDs, comma-separated)';
    $('search-hint').textContent = 'OSM ID mode: enter comma-separated relation IDs from openstreetmap.org.';
  }
}

// ── Search ─────────────────────────────────────────────────────────────────

async function handleSearch() {
  const q = $('search-input').value.trim();
  if (!q) return;

  if (state.mode === 'ai') {
    await suggestLocations(q);
  } else {
    await addOsmIds(q);
  }
}

async function suggestLocations(query) {
  setStatus('loading', `Asking AI for "${query}" locations…`);
  $('search-btn').disabled = true;

  try {
    const res = await fetch('/api/suggest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }));
      throw new Error(err.detail || res.statusText);
    }

    const data = await res.json();
    const locs = data.locations;

    setStatus('loading', `Geocoding ${locs.length} locations…`);

    // Add all chips at once (pending state), then geocode sequentially
    // to respect Nominatim's 1-req/sec rate limit
    for (const loc of locs) {
      loc._id = crypto.randomUUID();
      addChip(loc);
    }

    for (const loc of locs) {
      await geocodeLoc(loc);
      await sleep(1100);
    }

    setStatus('idle', `${locs.length} locations ready. Deselect any you don't want, then click Analyse.`);
  } catch (e) {
    setStatus('error', `Error: ${e.message}`);
  } finally {
    $('search-btn').disabled = false;
  }
}

async function addOsmIds(input) {
  const ids = input.split(/[\s,]+/).map(s => s.trim()).filter(Boolean);
  const numIds = ids.map(Number).filter(n => n > 0);

  if (!numIds.length) {
    setStatus('warn', 'No valid relation IDs found. Enter numbers like: 62149, 5750005');
    return;
  }

  setStatus('loading', `Looking up ${numIds.length} OSM relation(s)…`);

  for (const id of numIds) {
    const loc = {
      _id: crypto.randomUUID(),
      name: `Relation ${id}`,
      country: '',
      search_query: `relation/${id}`,
      osm_id: id,
      osm_type: 'relation',
    };
    addChip(loc);
    await fetchBoundary(loc);
    await sleep(1100);
  }

  setStatus('idle', 'Locations added. Click Analyse amenities.');
}

// ── Chips ──────────────────────────────────────────────────────────────────

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

  chip.classList.remove('loading', 'error');

  if (status === 'ready') {
    chip.querySelector('.chip-spinner')?.remove();

    const dot = document.createElement('span');
    dot.className = 'chip-dot';
    dot.style.background = 'var(--green)';
    chip.insertBefore(dot, chip.querySelector('.chip-name'));

    if (displayName) {
      chip.querySelector('.chip-name').textContent = displayName;
    }
  } else if (status === 'error') {
    chip.classList.add('error');
    chip.querySelector('.chip-spinner')?.remove();
    const dot = document.createElement('span');
    dot.className = 'chip-dot';
    dot.style.background = 'var(--danger)';
    chip.insertBefore(dot, chip.querySelector('.chip-name'));
  }

  const loc = state.locations.find(l => l._id === id);
  if (loc) loc.status = status;
}

function toggleLocation(id) {
  const loc = state.locations.find(l => l._id === id);
  if (!loc || loc.status !== 'ready') return;

  loc.selected = !loc.selected;
  const chip = document.querySelector(`.location-chip[data-id="${id}"]`);
  if (chip) chip.classList.toggle('selected', loc.selected);

  const layer = state.boundaryLayers[id];
  if (layer) layer.setStyle({ opacity: loc.selected ? 0.7 : 0.2, fillOpacity: loc.selected ? 0.08 : 0.02 });
}

function removeLocation(id) {
  const idx = state.locations.findIndex(l => l._id === id);
  if (idx >= 0) state.locations.splice(idx, 1);

  document.querySelector(`.location-chip[data-id="${id}"]`)?.remove();

  if (state.boundaryLayers[id]) {
    state.map.removeLayer(state.boundaryLayers[id]);
    delete state.boundaryLayers[id];
  }

  if (!state.locations.length) {
    $('locations-bar').classList.remove('visible');
    $('analyze-btn').style.display = 'none';
  }
}

// ── Geocoding ──────────────────────────────────────────────────────────────

async function geocodeLoc(loc) {
  try {
    const res = await fetch('/api/geocode', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ search_query: loc.search_query, name: loc.name }),
    });

    if (!res.ok) throw new Error('Not found');

    const geo = await res.json();
    Object.assign(loc, geo);

    // Update state entry
    const entry = state.locations.find(l => l._id === loc._id);
    if (entry) Object.assign(entry, geo, { status: 'ready' });

    // Short display name: first 2 parts of Nominatim response
    const shortName = geo.display_name?.split(', ').slice(0, 2).join(', ') || loc.name;
    updateChip(loc._id, 'ready', shortName);

    if (geo.geojson) showBoundary(loc._id, geo.geojson, shortName);
  } catch {
    updateChip(loc._id, 'error');
  }
}

async function fetchBoundary(loc) {
  // For OSM ID mode: fetch boundary via Nominatim lookup by relation ID
  try {
    const res = await fetch('/api/geocode', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        search_query: `${loc.name}`,
        name: loc.name,
      }),
    });

    if (!res.ok) throw new Error('Not found');

    const geo = await res.json();
    const entry = state.locations.find(l => l._id === loc._id);
    if (entry) Object.assign(entry, geo, { status: 'ready' });

    const shortName = geo.display_name?.split(', ').slice(0, 2).join(', ') || loc.name;
    updateChip(loc._id, 'ready', shortName);
    if (geo.geojson) showBoundary(loc._id, geo.geojson, shortName);
  } catch {
    // Still mark as ready with the ID we have
    const entry = state.locations.find(l => l._id === loc._id);
    if (entry) entry.status = 'ready';
    updateChip(loc._id, 'ready', loc.name);
  }
}

// ── Map ────────────────────────────────────────────────────────────────────

const BOUNDARY_PALETTE = [
  '#2563eb','#7c3aed','#059669','#dc2626','#d97706',
  '#0891b2','#db2777','#65a30d','#ea580c','#6366f1',
];
let _paletteIdx = 0;

function showBoundary(id, geojson, name) {
  const color = BOUNDARY_PALETTE[_paletteIdx++ % BOUNDARY_PALETTE.length];

  const layer = L.geoJSON(geojson, {
    style: {
      color,
      weight: 2,
      opacity: 0.7,
      fillColor: color,
      fillOpacity: 0.08,
      dashArray: '4 3',
    },
  }).addTo(state.map);

  layer.bindTooltip(name, { sticky: true, className: 'map-tooltip' });
  state.boundaryLayers[id] = layer;

  // Fit map to all current boundaries
  const all = Object.values(state.boundaryLayers);
  if (all.length) {
    const group = L.featureGroup(all);
    state.map.fitBounds(group.getBounds().pad(0.15), { maxZoom: 13 });
  }
}

// ── Analyse ────────────────────────────────────────────────────────────────

async function analyzeAmenities() {
  const selected = state.locations.filter(l => l.selected && l.status === 'ready');
  if (!selected.length) {
    setStatus('warn', 'No ready locations selected. Wait for geocoding to finish.');
    return;
  }

  // Show loading state in diagram panel
  $('diagram-empty').style.display = 'none';
  $('diagram-content').style.display = 'none';
  $('diagram-loading').style.display = '';
  $('loading-detail').textContent = `Querying OpenStreetMap for ${selected.length} area(s)…`;

  $('analyze-btn').disabled = true;
  setStatus('loading', 'Fetching amenities from OpenStreetMap…');

  // Clear previous amenity markers
  state.amenityLayer.clearLayers();

  try {
    const locPayload = selected.map(l => ({
      osm_id: l.osm_id,
      osm_type: l.osm_type || 'relation',
      name: l.name,
    }));

    const amenRes = await fetch('/api/amenities', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ locations: locPayload }),
    });

    if (!amenRes.ok) {
      const err = await amenRes.json().catch(() => ({ detail: amenRes.statusText }));
      throw new Error(err.detail || amenRes.statusText);
    }

    const { amenities, total } = await amenRes.json();
    state.amenities = amenities;

    setStatus('loading', `Building diagram for ${total} amenities…`);
    $('loading-detail').textContent = `${total} amenities found. Building diagram…`;

    plotAmenitiesOnMap(amenities);
    showMapLegend();
    updateMapStats(total, selected.length);

    const diagRes = await fetch('/api/diagram', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amenities }),
    });

    if (!diagRes.ok) throw new Error('Diagram build failed');

    const diagData = await diagRes.json();
    state.diagData = diagData;

    renderDiagram(diagData, selected);
    setStatus('idle', `Done — ${total} amenities across ${selected.length} location(s).`);
  } catch (e) {
    $('diagram-loading').style.display = 'none';
    $('diagram-empty').style.display = '';
    setStatus('error', `Error: ${e.message}`);
  } finally {
    $('analyze-btn').disabled = false;
  }
}

// ── Map: amenity markers ───────────────────────────────────────────────────

function plotAmenitiesOnMap(amenities) {
  state.amenityLayer.clearLayers();

  // Sample if too many (>5000) for performance
  let data = amenities;
  const MAX_MARKERS = 5000;
  if (data.length > MAX_MARKERS) {
    const step = Math.ceil(data.length / MAX_MARKERS);
    data = data.filter((_, i) => i % step === 0);
  }

  for (const a of data) {
    if (state.hiddenGroups.has(a.group)) continue;

    const color = GROUP_COLORS[a.group] || '#888';
    const circle = L.circleMarker([a.lat, a.lon], {
      radius: 4,
      fillColor: color,
      color: 'rgba(0,0,0,0.2)',
      weight: 0.5,
      fillOpacity: 0.8,
    });

    if (a.name) {
      circle.bindTooltip(`<strong>${a.name}</strong><br>${formatAmenityName(a.type)}`, {
        direction: 'top',
        offset: [0, -4],
      });
    }

    state.amenityLayer.addLayer(circle);
  }
}

function showMapLegend() {
  const legend = $('map-legend');
  const items = $('map-legend-items');
  items.innerHTML = '';
  legend.style.display = '';

  for (const [group, color] of Object.entries(GROUP_COLORS)) {
    const item = document.createElement('div');
    item.className = `map-legend-item${state.hiddenGroups.has(group) ? ' hidden' : ''}`;
    item.dataset.group = group;
    item.innerHTML = `<span class="legend-color" style="background:${color}"></span><span>${group}</span>`;
    item.addEventListener('click', () => toggleMapGroup(group));
    items.appendChild(item);
  }
}

function toggleMapGroup(group) {
  if (state.hiddenGroups.has(group)) {
    state.hiddenGroups.delete(group);
  } else {
    state.hiddenGroups.add(group);
  }
  document.querySelector(`.map-legend-item[data-group="${group}"]`)
    ?.classList.toggle('hidden', state.hiddenGroups.has(group));

  plotAmenitiesOnMap(state.amenities);
}

function updateMapStats(total, nLoc) {
  const el = $('map-stats');
  el.style.display = '';
  el.innerHTML = `
    <strong>${total.toLocaleString()}</strong> amenities &nbsp;·&nbsp;
    <strong>${nLoc}</strong> location${nLoc > 1 ? 's' : ''}
  `;
}

// ── Diagram ────────────────────────────────────────────────────────────────

function renderDiagram(data, selectedLocs) {
  $('diagram-loading').style.display = 'none';

  const { groups, total_amenities } = data;

  if (!groups || groups.length === 0) {
    $('diagram-empty').style.display = '';
    return;
  }

  // Title
  $('diagram-title').textContent = 'Amenity ecosystem — benchmarked average';
  const names = selectedLocs.map(l => l.name || l.display_name?.split(', ')[0]).join(', ');
  $('diagram-subtitle').textContent =
    `${total_amenities.toLocaleString()} amenities · ${selectedLocs.length} location(s) · ${names}`;

  $('diagram-content').style.display = '';

  buildBubbleChart(groups, total_amenities);
  buildLegend(groups);
}

// ── D3 Bubble Chart ────────────────────────────────────────────────────────

function buildBubbleChart(groups, totalAmenities) {
  const svg = d3.select('#bubble-svg');
  svg.selectAll('*').remove();

  const container = $('bubble-container');
  const W = container.clientWidth;
  const H = container.clientHeight;

  svg.attr('viewBox', `0 0 ${W} ${H}`);

  if (!groups.length) return;

  // Build D3 hierarchy: root → groups → amenity types
  const root = d3.hierarchy({
    name: 'root',
    children: groups.map(g => ({
      name: g.id,
      color: g.color,
      total: g.total,
      total_count: g.total_count,
      children: g.children.map(c => ({
        name: c.id,
        color: g.color,
        value: c.proportion,
        count: c.count,
      })),
    })),
  })
    .sum(d => d.value || 0)
    .sort((a, b) => b.value - a.value);

  const pad = Math.min(W, H) * 0.015;

  d3.pack()
    .size([W, H])
    .padding(d => {
      if (d.depth === 0) return pad * 3;
      if (d.depth === 1) return pad * 1.5;
      return pad * 0.5;
    })(root);

  const g = svg.append('g');

  // ── Group halos (depth 1) ────────────────────────────────────────────────
  g.selectAll('.halo')
    .data(root.children)
    .join('circle')
    .attr('class', 'halo')
    .attr('cx', d => d.x)
    .attr('cy', d => d.y)
    .attr('r', d => d.r)
    .attr('fill', d => hexToPasstel(d.data.color, 0.83))
    .attr('stroke', 'none');

  // ── Amenity circles (depth 2 / leaves) ──────────────────────────────────
  const leaves = root.leaves();

  const tooltip = d3.select('#tooltip');

  g.selectAll('.bubble')
    .data(leaves)
    .join('circle')
    .attr('class', 'bubble')
    .attr('cx', d => d.x)
    .attr('cy', d => d.y)
    .attr('r', d => d.r)
    .attr('fill', d => d.data.color)
    .attr('opacity', 0.9)
    .style('cursor', 'default')
    .on('mousemove', (event, d) => {
      const pct = (d.data.value * 100).toFixed(1);
      tooltip
        .classed('visible', true)
        .style('left', event.clientX + 14 + 'px')
        .style('top', event.clientY - 10 + 'px')
        .html(
          `<div class="tooltip-name">${formatAmenityName(d.data.name)}</div>` +
          `<div class="tooltip-detail">${d.data.count} units · ${pct}% · ${d.parent.data.name}</div>`
        );
    })
    .on('mouseleave', () => tooltip.classed('visible', false));

  // ── Labels ───────────────────────────────────────────────────────────────
  // Only draw label if radius is large enough
  const MIN_R = Math.min(W, H) * 0.032;

  g.selectAll('.bubble-label')
    .data(leaves.filter(d => d.r >= MIN_R))
    .join('text')
    .attr('class', 'bubble-label')
    .attr('x', d => d.x)
    .attr('y', d => d.y)
    .style('font-size', d => Math.min(d.r * 0.38, 11) + 'px')
    .text(d => {
      const label = formatAmenityName(d.data.name);
      // If the label won't fit, try shortened form
      if (label.length > 12 && d.r < MIN_R * 1.8) return label.split(' ')[0];
      return label;
    });

  // ── Group name labels (centre of each halo) ──────────────────────────────
  const MIN_HALO_R = Math.min(W, H) * 0.06;

  g.selectAll('.halo-label')
    .data(root.children.filter(d => d.r >= MIN_HALO_R))
    .join('text')
    .attr('class', 'bubble-label')
    .attr('x', d => d.x)
    .attr('y', d => {
      // Place label at top of halo, above child circles
      const topChild = Math.min(...d.children.map(c => c.y - c.r));
      return Math.min(topChild - 4, d.y - d.r + 12);
    })
    .style('font-size', d => Math.min(d.r * 0.18, 10) + 'px')
    .style('fill', d => d.data.color)
    .style('opacity', 0.8)
    .text(d => d.data.name);
}

// ── Legend ─────────────────────────────────────────────────────────────────

function buildLegend(groups) {
  const container = $('legend-container');
  container.innerHTML = '';

  for (const g of groups) {
    const pct = (g.total * 100).toFixed(1);
    const count = Math.round(g.total_count);
    const topTypes = g.children.slice(0, 4)
      .map(c => formatAmenityName(c.id))
      .join(', ') + (g.children.length > 4 ? '…' : '');

    const item = document.createElement('div');
    item.className = 'legend-item';
    item.innerHTML = `
      <div>
        <div class="legend-swatch" style="background:${g.color}"></div>
      </div>
      <div>
        <div class="legend-name">${g.id}</div>
        <div class="legend-stat">${pct}% · ~${count} units</div>
        <div class="legend-types">${topTypes}</div>
      </div>
    `;
    container.appendChild(item);
  }
}
