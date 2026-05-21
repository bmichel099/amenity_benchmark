'use strict';

// ═══════════════════════════════════════════════════════════════════════════
// AMENITY TAXONOMY  (mirrors amenity_config.py)
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

const GROUPS = {
  'Dining':             { color:'#E69F00', items:new Set(['restaurant','restaurant;bar','cafe','coffee','fast_food','biergarten','ice_cream']) },
  'Nightlife':          { color:'#D55E00', items:new Set(['bar','pub','nightclub','casino']) },
  'Food Retail':        { color:'#56B4E9', items:new Set(['supermarket','convenience','bakery','butcher','cheese','deli','pastry','chocolate','health_food','alcohol','general','confectionery','wine','farm']) },
  'Sport & Ski':        { color:'#009E73', items:new Set(['sports','outdoor','ski','ski_rental','ski_school','avalanche_transceiver','snow_park','bicycle_rental','water_sports','boat_rental','fitness_equipment','lift_tickets','bicycle']) },
  'Fashion & Beauty':   { color:'#CC79A7', items:new Set(['clothes','shoes','fashion_accessories','leather','tailor','cosmetics','perfumery','beauty','hairdresser','optician']) },
  'Health & Medical':   { color:'#0072B2', items:new Set(['pharmacy','clinic','doctors','hospital','dentist','medical_supply','hearing_aids','chemist','veterinary','massage','public_bath']) },
  'Gifts & Speciality': { color:'#F0E442', items:new Set(['gift','jewelry','second_hand','variety_store','craft','toys','florist','stationery','books','newsagent','kiosk','photo','tobacco']) },
  'Home & Electronics': { color:'#999999', items:new Set(['furniture','houseware','interior_decoration','hardware','doityourself','electrical','garden_centre','paint','kitchen','wholesale','department_store','mall','electronics','computer','mobile_phone','hifi','camera','bed','studio']) },
  'Culture & Community':{ color:'#44AA99', items:new Set(['bank','cinema','travel_agency','dry_cleaning','laundry','theatre','locksmith','arts_centre','art','music_school','conference_centre','library','place_of_worship','school','kindergarten','childcare','community_centre','social_facility','clubhouse','driving_school']) },
};

const AMENITY_TO_GROUP = {};
for (const [gname, gd] of Object.entries(GROUPS)) {
  for (const item of gd.items) AMENITY_TO_GROUP[item] = gname;
}

// ═══════════════════════════════════════════════════════════════════════════
// LOCATION PRESETS  (replaces Claude AI — no API key required)
// ═══════════════════════════════════════════════════════════════════════════

const LOCATION_PRESETS = {
  'CBD / Financial District': [
    { name:'City of London',      country:'UK',          description:'The historic Square Mile',             search_query:'City of London, Greater London' },
    { name:'Manhattan Midtown',   country:'USA',         description:'New York\'s high-density core',        search_query:'Midtown Manhattan, New York City' },
    { name:'Sydney CBD',          country:'Australia',   description:'Australia\'s premier business district', search_query:'Sydney Central Business District' },
    { name:'Singapore CBD',       country:'Singapore',   description:'Marina Bay and downtown core',          search_query:'Downtown Core Planning Area, Singapore' },
    { name:'Hong Kong Central',   country:'HK',          description:'Compact vertical mixed-use CBD',        search_query:'Central, Central and Western District, Hong Kong' },
    { name:'La Défense',          country:'France',      description:'Europe\'s largest purpose-built CBD',   search_query:'La Défense, Puteaux, Hauts-de-Seine, France' },
    { name:'Canary Wharf',        country:'UK',          description:'London\'s secondary financial district', search_query:'Canary Wharf, Tower Hamlets, London' },
    { name:'Melbourne CBD',       country:'Australia',   description:'Victorian-era grid with laneways',      search_query:'Melbourne Central Business District' },
  ],
  'Ski Resort Town': [
    { name:'Verbier',       country:'Switzerland', description:'Upmarket 4 Vallées resort',               search_query:'Verbier, Bagnes, Valais, Switzerland' },
    { name:'Zermatt',       country:'Switzerland', description:'Car-free resort below the Matterhorn',    search_query:'Zermatt, Visp, Valais, Switzerland' },
    { name:'Saas-Fee',      country:'Switzerland', description:'Traditional car-free Valais village',     search_query:'Saas-Fee, Visp, Valais, Switzerland' },
    { name:'Chamonix',      country:'France',      description:'Freeride capital at Mont Blanc',          search_query:'Chamonix-Mont-Blanc, Haute-Savoie, France' },
    { name:'Courchevel',    country:'France',      description:'Luxury Trois Vallées resort',             search_query:'Courchevel, Savoie, France' },
    { name:'Méribel',       country:'France',      description:'Central hub of the Trois Vallées',        search_query:'Méribel, Savoie, France' },
    { name:'St Anton',      country:'Austria',     description:'Arlberg — birthplace of alpine skiing',   search_query:'St. Anton am Arlberg, Landeck, Tyrol, Austria' },
    { name:"Val d'Isère",   country:'France',      description:'High-altitude resort above Tignes',       search_query:"Val-d'Isère, Savoie, France" },
  ],
  'Historic City Centre': [
    { name:'Vienna Innere Stadt', country:'Austria',   description:'UNESCO imperial city core',            search_query:'Innere Stadt, Vienna, Austria' },
    { name:'Prague Staré Město',  country:'Czechia',   description:'Gothic and baroque Bohemian heart',    search_query:'Staré Město, Prague 1, Czech Republic' },
    { name:'Amsterdam Centrum',   country:'NL',        description:'Golden Age canal ring',                search_query:'Centrum, Amsterdam, Netherlands' },
    { name:'Barcelona Eixample',  country:'Spain',     description:'Modernista grid, dense amenity mix',   search_query:'Eixample, Barcelona, Catalonia, Spain' },
    { name:'Edinburgh Old Town',  country:'UK',        description:'Medieval Royal Mile and closes',       search_query:'Old Town, Edinburgh, Scotland' },
    { name:'Florence Centro',     country:'Italy',     description:'Renaissance historic core',             search_query:'Centro storico, Florence, Tuscany, Italy' },
    { name:'Bruges Centrum',      country:'Belgium',   description:'Best-preserved medieval Flemish city', search_query:'Brugge, West Flanders, Belgium' },
    { name:'Tallinn Old Town',    country:'Estonia',   description:'Best-preserved medieval Baltic city',  search_query:'Vanalinn, Tallinn, Estonia' },
  ],
  'Beach Resort': [
    { name:'Mykonos Town',  country:'Greece',     description:'Cycladic whitewashed lanes',            search_query:'Mykonos, South Aegean, Greece' },
    { name:'Cannes',        country:'France',     description:'Riviera glamour and festival city',     search_query:'Cannes, Alpes-Maritimes, France' },
    { name:'Saint-Tropez',  country:'France',     description:'Fishing village turned luxury hotspot', search_query:'Saint-Tropez, Var, Provence, France' },
    { name:'Positano',      country:'Italy',      description:'Vertical Amalfi village on the cliff',  search_query:'Positano, Salerno, Campania, Italy' },
    { name:'Dubrovnik Grad',country:'Croatia',    description:'Walled Adriatic city',                  search_query:'Grad, Dubrovnik, Croatia' },
    { name:'Porto Cervo',   country:'Italy',      description:'Costa Smeralda luxury marina resort',   search_query:'Porto Cervo, Arzachena, Sassari, Sardinia' },
    { name:'Tulum',         country:'Mexico',     description:'Bohemian Caribbean eco-resort',         search_query:'Tulum, Quintana Roo, Mexico' },
    { name:'Seminyak',      country:'Indonesia',  description:'Bali\'s upmarket beach strip',          search_query:'Seminyak, Kuta, Badung, Bali, Indonesia' },
  ],
  'Mixed-Use Neighbourhood': [
    { name:'Shoreditch',       country:'UK',        description:'East London creative quarter',          search_query:'Shoreditch, London Borough of Hackney, London' },
    { name:'Le Marais',        country:'France',    description:'Paris\'s historic right-bank village',  search_query:'Le Marais, 4th arrondissement, Paris' },
    { name:'Prenzlauer Berg',  country:'Germany',   description:'Post-wall Berlin bohemian district',    search_query:'Prenzlauer Berg, Pankow, Berlin, Germany' },
    { name:'Williamsburg',     country:'USA',       description:'Brooklyn\'s gentrified creative hub',   search_query:'Williamsburg, Brooklyn, New York City' },
    { name:'Fitzroy',          country:'Australia', description:'Melbourne\'s bar and café suburb',      search_query:'Fitzroy, Melbourne, Victoria, Australia' },
    { name:'Palermo Soho',     country:'Argentina', description:'BA\'s trendy design and dining strip',  search_query:'Palermo Soho, Buenos Aires, Argentina' },
    { name:'Nakameguro',       country:'Japan',     description:'Tokyo canalside café and boutique strip',search_query:'Nakameguro, Meguro, Tokyo, Japan' },
    { name:'Peckham',          country:'UK',        description:'South London\'s emerging cultural scene',search_query:'Peckham, London Borough of Southwark, London' },
  ],
  'Town Centre / High Street': [
    { name:'Oxford Street',       country:'UK',        description:'UK\'s busiest retail street',           search_query:'Oxford Street, City of Westminster, London' },
    { name:'Champs-Élysées',      country:'France',    description:'Paris\'s grand retail and leisure axis', search_query:"Champs-Élysées, 8th arrondissement, Paris" },
    { name:'Ginza',               country:'Japan',     description:'Tokyo\'s upscale flagship retail district', search_query:'Ginza, Chuo, Tokyo, Japan' },
    { name:'Orchard Road',        country:'Singapore', description:'Singapore\'s main shopping boulevard',  search_query:'Orchard Road, Orchard, Singapore' },
    { name:'Via Montenapoleone',  country:'Italy',     description:'Milan\'s luxury fashion quadrilateral', search_query:'Quadrilatero della moda, Milan, Italy' },
    { name:'Strøget',             country:'Denmark',   description:'Copenhagen\'s pedestrianised main street', search_query:'Strøget, Copenhagen, Denmark' },
    { name:'Ermou Street',        country:'Greece',    description:'Athens\'s main pedestrian shopping axis', search_query:'Ermou, Syntagma, Athens, Greece' },
    { name:'Nevsky District',     country:'Russia',    description:'St. Petersburg\'s grand commercial avenue', search_query:'Nevsky District, Saint Petersburg, Russia' },
  ],
};

// Keyword → preset key
const PRESET_KEYWORDS = [
  [['cbd','financial district','downtown','business district','office district'],  'CBD / Financial District'],
  [['ski','snow','mountain resort','alpine','winter resort'],                       'Ski Resort Town'],
  [['historic','heritage','medieval','old town','city centre','city center'],       'Historic City Centre'],
  [['beach','coastal','riviera','seaside','sea resort'],                            'Beach Resort'],
  [['mixed use','neighbourhood','neighborhood','creative quarter','bohemian'],      'Mixed-Use Neighbourhood'],
  [['high street','shopping','retail district','town centre','town center','commercial street'], 'Town Centre / High Street'],
];

function findPresetKey(query) {
  const q = query.toLowerCase().trim();
  for (const [keywords, presetKey] of PRESET_KEYWORDS) {
    if (keywords.some(kw => q.includes(kw) || kw.startsWith(q))) return presetKey;
  }
  // Fall back: check against preset keys directly
  for (const key of Object.keys(LOCATION_PRESETS)) {
    if (key.toLowerCase().includes(q)) return key;
  }
  return null;
}

// ═══════════════════════════════════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════════════════════════════════

const state = {
  mode: 'preset',
  locations: [],       // [{_id, name, country, description, search_query, osm_id, osm_type, display_name, geojson, selected, status}]
  amenities: [],
  map: null,
  boundaryLayers: {},  // _id → L.GeoJSON
  amenityLayer: null,
  hiddenGroups: new Set(),
};

const NOMINATIM = 'https://nominatim.openstreetmap.org';
const OVERPASS  = 'https://overpass-api.de/api/interpreter';

const BOUNDARY_PALETTE = ['#2563eb','#7c3aed','#059669','#dc2626','#d97706','#0891b2','#db2777','#65a30d','#ea580c','#6366f1'];
let _paletteIdx = 0;

// ═══════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════

const sleep   = ms => new Promise(r => setTimeout(r, ms));
const $       = id  => document.getElementById(id);
const fmt     = s   => s.replace(/_/g,' ').replace(/;/g,'/').replace(/\b\w/g, c => c.toUpperCase());

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

// ═══════════════════════════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════════════════════════

window.addEventListener('DOMContentLoaded', () => {
  initMap();
  bindEvents();
  setMode('preset');
});

function initMap() {
  state.map = L.map('map', { center:[20,10], zoom:2 });
  L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
    attribution: '© <a href="https://openstreetmap.org">OSM</a> contributors © <a href="https://carto.com">CARTO</a>',
    subdomains: 'abcd', maxZoom: 19,
  }).addTo(state.map);
  state.amenityLayer = L.layerGroup().addTo(state.map);
}

function bindEvents() {
  $('mode-preset').addEventListener('click',    () => setMode('preset'));
  $('mode-nominatim').addEventListener('click', () => setMode('nominatim'));
  $('mode-osm').addEventListener('click',       () => setMode('osm'));

  $('search-btn').addEventListener('click', handleSearch);
  $('search-input').addEventListener('keydown', e => { if (e.key === 'Enter') handleSearch(); });
  $('search-input').addEventListener('input',   onSearchInput);
  $('search-input').addEventListener('focus',   onSearchFocus);

  $('analyze-btn').addEventListener('click', analyzeAmenities);

  // Close dropdown on outside click
  document.addEventListener('click', e => {
    if (!e.target.closest('.search-row')) closeDropdown();
  });
}

function setMode(mode) {
  state.mode = mode;
  ['preset','nominatim','osm'].forEach(m =>
    $(` mode-${m}`.trim()) && $(`mode-${m}`).classList.toggle('active', m === mode)
  );
  closeDropdown();

  const hints = {
    preset:    ['e.g. CBD, ski resort town, beach resort, mixed-use neighbourhood…',
                'Preset mode: type a location type to instantly load curated benchmark examples.'],
    nominatim: ['e.g. Shoreditch London, Marais Paris, Tokyo Ginza…',
                'Place search: find any neighbourhood or district by name via OpenStreetMap.'],
    osm:       ['e.g. 62149, 5750005, 7444  (comma-separated OSM relation IDs)',
                'OSM ID mode: enter relation IDs directly from openstreetmap.org.'],
  };
  $('search-input').placeholder = hints[mode][0];
  $('search-hint').textContent  = hints[mode][1];
}

// ═══════════════════════════════════════════════════════════════════════════
// SEARCH
// ═══════════════════════════════════════════════════════════════════════════

async function handleSearch() {
  const q = $('search-input').value.trim();
  if (!q) return;
  closeDropdown();

  if (state.mode === 'preset') {
    loadPreset(q);
  } else if (state.mode === 'nominatim') {
    await searchNominatim(q, true);  // addAll = true
  } else {
    await addOsmIds(q);
  }
}

// ── Dropdown on input ──────────────────────────────────────────────────────

function onSearchFocus() {
  if (state.mode === 'preset') showPresetDropdown($('search-input').value);
}

function onSearchInput() {
  const q = $('search-input').value.trim();
  if (state.mode === 'preset') {
    showPresetDropdown(q);
  } else if (state.mode === 'nominatim' && q.length >= 3) {
    debouncedNominatimDropdown(q);
  } else {
    closeDropdown();
  }
}

function showPresetDropdown(query) {
  const dropdown = $('search-dropdown');
  const q = query.toLowerCase();

  // Filter preset categories
  const matches = Object.entries(LOCATION_PRESETS).filter(([key]) =>
    !q || key.toLowerCase().includes(q) ||
    findPresetKey(q) === key
  );

  if (!matches.length) { closeDropdown(); return; }

  dropdown.innerHTML = '<div class="dropdown-section-title">Location types</div>' +
    matches.map(([key, locs]) =>
      `<div class="dropdown-item" data-preset="${key}">
        <div class="dropdown-item-name">${key}</div>
        <div class="dropdown-item-detail">${locs.length} benchmark examples</div>
      </div>`
    ).join('');

  dropdown.querySelectorAll('.dropdown-item').forEach(el => {
    el.addEventListener('click', () => {
      loadPreset(el.dataset.preset, true);
      closeDropdown();
    });
  });

  dropdown.style.display = '';
}

// Simple debounce for Nominatim live search
let _nominatimTimer = null;
function debouncedNominatimDropdown(q) {
  clearTimeout(_nominatimTimer);
  _nominatimTimer = setTimeout(() => nominatimDropdown(q), 400);
}

async function nominatimDropdown(q) {
  const results = await callNominatim(q, 5);
  if (!results.length) { closeDropdown(); return; }

  const dropdown = $('search-dropdown');
  dropdown.innerHTML = '<div class="dropdown-section-title">Places found</div>' +
    results.map((r, i) =>
      `<div class="dropdown-item" data-idx="${i}">
        <div class="dropdown-item-name">${r.display_name.split(',')[0]}</div>
        <div class="dropdown-item-detail">${r.display_name.split(',').slice(1,3).join(',').trim()}</div>
      </div>`
    ).join('');

  dropdown.querySelectorAll('.dropdown-item').forEach(el => {
    el.addEventListener('click', () => {
      const r = results[+el.dataset.idx];
      addGeoResult(r);
      closeDropdown();
    });
  });

  dropdown.style.display = '';
}

function closeDropdown() {
  $('search-dropdown').style.display = 'none';
}

// ── Preset loading ─────────────────────────────────────────────────────────

function loadPreset(query, exactKey = false) {
  const key = exactKey ? query : findPresetKey(query);
  if (!key || !LOCATION_PRESETS[key]) {
    setStatus('warn', `No preset for "${query}". Try: CBD, ski resort, beach resort, historic city centre…`);
    return;
  }

  const locs = LOCATION_PRESETS[key];
  setStatus('loading', `Loading ${locs.length} ${key} examples…`);

  locs.forEach(loc => {
    loc._id = crypto.randomUUID();
    addChip(loc);
  });

  // Geocode sequentially to respect Nominatim's 1-req/sec policy
  (async () => {
    for (const loc of locs) {
      await geocodeLoc(loc);
      await sleep(1150);
    }
    setStatus('idle', `${locs.length} locations loaded. Deselect any you don't want, then click Analyse.`);
  })();
}

// ── Nominatim search (add-all mode) ───────────────────────────────────────

async function searchNominatim(q, addAll = false) {
  setStatus('loading', `Searching for "${q}"…`);
  const results = await callNominatim(q, addAll ? 1 : 5);
  if (!results.length) { setStatus('warn', `Nothing found for "${q}"`); return; }
  if (addAll) {
    addGeoResult(results[0]);
  }
  setStatus('idle', 'Location added. Click Analyse amenities when ready.');
}

function addGeoResult(r) {
  const loc = {
    _id: crypto.randomUUID(),
    name: r.display_name.split(',')[0],
    country: r.display_name.split(',').slice(-1)[0].trim(),
    search_query: r.display_name,
    osm_id: parseInt(r.osm_id),
    osm_type: r.osm_type,
    display_name: r.display_name,
    geojson: r.geojson,
    bbox: r.boundingbox,
    status: 'ready',
    selected: true,
  };
  state.locations.push(loc);
  addChip(loc, true);  // skip geocoding — already have coords
  if (loc.geojson) showBoundary(loc._id, loc.geojson, loc.name);
  $('analyze-btn').style.display = '';
  $('locations-bar').classList.add('visible');
}

// ── OSM ID mode ────────────────────────────────────────────────────────────

async function addOsmIds(input) {
  const ids = input.split(/[\s,]+/).map(s => s.trim()).filter(Boolean)
                   .map(Number).filter(n => n > 0);
  if (!ids.length) { setStatus('warn', 'No valid relation IDs found.'); return; }

  setStatus('loading', `Looking up ${ids.length} OSM relation(s)…`);

  for (const id of ids) {
    const loc = {
      _id: crypto.randomUUID(),
      name: `Relation ${id}`,
      country: '',
      search_query: `relation/${id}`,
      osm_id: id,
      osm_type: 'relation',
    };
    addChip(loc);
    await geocodeLoc(loc);
    await sleep(1150);
  }

  setStatus('idle', 'Locations added. Click Analyse amenities.');
}

// ═══════════════════════════════════════════════════════════════════════════
// CHIPS
// ═══════════════════════════════════════════════════════════════════════════

function addChip(loc, alreadyReady = false) {
  const bar = $('locations-bar');
  bar.classList.add('visible');

  const chip = document.createElement('div');
  chip.className = 'location-chip selected' + (alreadyReady ? '' : ' loading');
  chip.dataset.id = loc._id;
  chip.innerHTML = alreadyReady
    ? `<span class="chip-dot" style="background:var(--green)"></span>
       <span class="chip-name">${loc.name}</span>
       ${loc.country ? `<span style="color:var(--text-3);font-size:11px">${loc.country}</span>` : ''}
       <span class="chip-remove" title="Remove">×</span>`
    : `<span class="chip-spinner"></span>
       <span class="chip-name">${loc.name}</span>
       ${loc.country ? `<span style="color:var(--text-3);font-size:11px">${loc.country}</span>` : ''}
       <span class="chip-remove" title="Remove">×</span>`;

  chip.querySelector('.chip-remove').addEventListener('click', e => {
    e.stopPropagation();
    removeLocation(loc._id);
  });
  chip.addEventListener('click', () => toggleLocation(loc._id));
  bar.appendChild(chip);

  if (!state.locations.find(l => l._id === loc._id)) {
    state.locations.push({ ...loc, selected: true, status: alreadyReady ? 'ready' : 'pending' });
  }
  $('analyze-btn').style.display = '';
}

function updateChip(id, status, displayName) {
  const chip = document.querySelector(`.location-chip[data-id="${id}"]`);
  if (!chip) return;
  chip.classList.remove('loading','error');
  chip.querySelector('.chip-spinner')?.remove();

  const dot = document.createElement('span');
  dot.className = 'chip-dot';
  dot.style.background = status === 'ready' ? 'var(--green)' : 'var(--danger)';
  chip.insertBefore(dot, chip.querySelector('.chip-name'));

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

// ═══════════════════════════════════════════════════════════════════════════
// NOMINATIM  (called directly from browser — public CORS API)
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
  if (!res.ok) throw new Error(`Nominatim error ${res.status}`);
  return res.json();
}

async function geocodeLoc(loc) {
  try {
    const results = await callNominatim(loc.search_query, 5);
    // Prefer relation type for clean polygon
    const r = results.find(x => x.osm_type === 'relation') || results[0];
    if (!r) throw new Error('Not found');

    const shortName = r.display_name.split(',').slice(0,2).join(',').trim();
    Object.assign(loc, {
      osm_id: parseInt(r.osm_id),
      osm_type: r.osm_type,
      display_name: r.display_name,
      geojson: r.geojson,
      bbox: r.boundingbox,
      status: 'ready',
    });
    const entry = state.locations.find(l => l._id === loc._id);
    if (entry) Object.assign(entry, loc);

    updateChip(loc._id, 'ready', shortName);
    if (r.geojson) showBoundary(loc._id, r.geojson, shortName);
  } catch {
    updateChip(loc._id, 'error');
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// MAP
// ═══════════════════════════════════════════════════════════════════════════

function showBoundary(id, geojson, name) {
  const color = BOUNDARY_PALETTE[_paletteIdx++ % BOUNDARY_PALETTE.length];
  const layer = L.geoJSON(geojson, {
    style: { color, weight:2, opacity:0.7, fillColor:color, fillOpacity:0.08, dashArray:'4 3' },
  }).addTo(state.map);
  layer.bindTooltip(name, { sticky:true });
  state.boundaryLayers[id] = layer;

  const all = Object.values(state.boundaryLayers);
  if (all.length) {
    state.map.fitBounds(L.featureGroup(all).getBounds().pad(0.15), { maxZoom:13 });
  }
}

function plotAmenitiesOnMap(amenities) {
  state.amenityLayer.clearLayers();
  let data = amenities;
  if (data.length > 5000) {
    const step = Math.ceil(data.length / 5000);
    data = data.filter((_, i) => i % step === 0);
  }
  for (const a of data) {
    if (state.hiddenGroups.has(a.group)) continue;
    const circle = L.circleMarker([a.lat, a.lon], {
      radius:4, fillColor: GROUPS[a.group]?.color || '#888',
      color:'rgba(0,0,0,0.15)', weight:0.5, fillOpacity:0.82,
    });
    if (a.name) circle.bindTooltip(`<strong>${a.name}</strong><br>${fmt(a.type)}`, { direction:'top', offset:[0,-4] });
    state.amenityLayer.addLayer(circle);
  }
}

function showMapLegend() {
  const items = $('map-legend-items');
  items.innerHTML = '';
  for (const [group, gd] of Object.entries(GROUPS)) {
    const item = document.createElement('div');
    item.className = `map-legend-item${state.hiddenGroups.has(group) ? ' hidden' : ''}`;
    item.dataset.group = group;
    item.innerHTML = `<span class="legend-color" style="background:${gd.color}"></span><span>${group}</span>`;
    item.addEventListener('click', () => {
      state.hiddenGroups.has(group) ? state.hiddenGroups.delete(group) : state.hiddenGroups.add(group);
      item.classList.toggle('hidden', state.hiddenGroups.has(group));
      plotAmenitiesOnMap(state.amenities);
    });
    items.appendChild(item);
  }
  $('map-legend').style.display = '';
}

// ═══════════════════════════════════════════════════════════════════════════
// OVERPASS  (called directly from browser — public CORS API)
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
  if (!res.ok) throw new Error(`Overpass error ${res.status}`);
  return res.json();
}

function processOverpassElements(elements) {
  const amenities = [];
  for (const el of elements) {
    const tags = el.tags || {};
    const type = tags.amenity || tags.shop;
    if (!type || EXCLUDE.has(type) || !AMENITY_TO_GROUP[type]) continue;
    const lat = el.type === 'node' ? el.lat : el.center?.lat;
    const lon = el.type === 'node' ? el.lon : el.center?.lon;
    if (lat == null || lon == null) continue;
    amenities.push({ type, group: AMENITY_TO_GROUP[type], lat, lon, name: tags.name || '' });
  }
  return amenities;
}

// ═══════════════════════════════════════════════════════════════════════════
// DIAGRAM DATA  (processed locally — no backend needed)
// ═══════════════════════════════════════════════════════════════════════════

function buildDiagramData(amenities) {
  const counts = {};
  for (const a of amenities) counts[a.type] = (counts[a.type] || 0) + 1;
  const total = Object.values(counts).reduce((s, n) => s + n, 0);

  const groups = [];
  for (const [gname, gd] of Object.entries(GROUPS)) {
    const items = [];
    for (const item of gd.items) {
      if (counts[item]) items.push({ id:item, count:counts[item], proportion:counts[item]/total });
    }
    if (!items.length) continue;
    items.sort((a,b) => b.proportion - a.proportion);
    groups.push({
      id: gname, color: gd.color,
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

  $('diagram-empty').style.display   = 'none';
  $('diagram-content').style.display = 'none';
  $('diagram-loading').style.display = '';
  $('loading-detail').textContent = `Querying OpenStreetMap for ${selected.length} area(s)…`;
  $('analyze-btn').disabled = true;
  setStatus('loading', 'Fetching amenities from Overpass…');

  state.amenityLayer.clearLayers();

  try {
    const overpassData = await fetchOverpass(selected);
    const amenities    = processOverpassElements(overpassData.elements || []);
    state.amenities    = amenities;

    if (!amenities.length) {
      throw new Error('No matching amenities found in these areas. The boundaries may be too small or the data sparse.');
    }

    $('loading-detail').textContent = `${amenities.length} amenities found. Rendering…`;
    plotAmenitiesOnMap(amenities);
    showMapLegend();

    $('map-stats').style.display = '';
    $('map-stats').innerHTML =
      `<strong>${amenities.length.toLocaleString()}</strong> amenities &nbsp;·&nbsp; ` +
      `<strong>${selected.length}</strong> location${selected.length > 1 ? 's' : ''}`;

    const diagData = buildDiagramData(amenities);
    renderDiagram(diagData, selected);
    setStatus('idle', `Done — ${amenities.length.toLocaleString()} amenities across ${selected.length} location(s).`);
  } catch (e) {
    $('diagram-loading').style.display = 'none';
    $('diagram-empty').style.display   = '';
    $('diagram-empty').querySelector('.empty-text').textContent = e.message;
    setStatus('error', `Error: ${e.message}`);
  } finally {
    $('analyze-btn').disabled = false;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// DIAGRAM RENDER  (D3 v7)
// ═══════════════════════════════════════════════════════════════════════════

function renderDiagram(data, selectedLocs) {
  $('diagram-loading').style.display = 'none';
  const { groups, total_amenities } = data;

  $('diagram-title').textContent = 'Amenity ecosystem — benchmarked average';
  const names = selectedLocs.map(l => (l.display_name || l.name).split(',')[0]).join(', ');
  $('diagram-subtitle').textContent =
    `${total_amenities.toLocaleString()} amenities · ${selectedLocs.length} location(s) · ${names}`;

  $('diagram-content').style.display = '';
  buildBubbleChart(groups);
  buildLegend(groups);
}

function buildBubbleChart(groups) {
  const svg  = d3.select('#bubble-svg');
  svg.selectAll('*').remove();

  const el = $('bubble-container');
  const W  = el.clientWidth;
  const H  = el.clientHeight;
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

  // Group halos
  g.selectAll('.halo')
    .data(root.children)
    .join('circle')
    .attr('class','halo')
    .attr('cx', d => d.x).attr('cy', d => d.y).attr('r', d => d.r)
    .attr('fill', d => hexToPasstel(d.data.color, 0.83))
    .attr('stroke','none');

  // Amenity bubbles
  const leaves = root.leaves();

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

  // Bubble labels
  const MIN_R = Math.min(W,H) * 0.030;

  g.selectAll('.bubble-label')
    .data(leaves.filter(d => d.r >= MIN_R))
    .join('text')
    .attr('class','bubble-label')
    .attr('x', d => d.x).attr('y', d => d.y)
    .style('font-size', d => Math.min(d.r * 0.38, 11) + 'px')
    .text(d => {
      const label = fmt(d.data.name);
      return label.length > 12 && d.r < MIN_R * 1.9 ? label.split(' ')[0] : label;
    });

  // Group name labels (top of each halo)
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
    .style('font-size', d => Math.min(d.r * 0.17, 9.5) + 'px')
    .style('fill', d => d.data.color)
    .style('opacity', 0.75)
    .text(d => d.data.name);
}

function buildLegend(groups) {
  const container = $('legend-container');
  container.innerHTML = '';
  for (const g of groups) {
    const pct      = (g.total * 100).toFixed(1);
    const topTypes = g.children.slice(0,4).map(c => fmt(c.id)).join(', ') + (g.children.length > 4 ? '…' : '');
    const item = document.createElement('div');
    item.className = 'legend-item';
    item.innerHTML =
      `<div><div class="legend-swatch" style="background:${g.color}"></div></div>
       <div>
         <div class="legend-name">${g.id}</div>
         <div class="legend-stat">${pct}% · ~${Math.round(g.total_count)} units</div>
         <div class="legend-types">${topTypes}</div>
       </div>`;
    container.appendChild(item);
  }
}
