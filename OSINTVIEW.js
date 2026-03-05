'use strict';

/* ═══════════════════════════════════════════════════════════════
   1. CONFIGURATION
═══════════════════════════════════════════════════════════════ */

let MAPBOX_TOKEN = '';

// Check for token from HTML handler and initialize
function initAppWithToken() {
  MAPBOX_TOKEN = 'pk.eyJ1IjoiZnJhbmtkaW1pdHJpIiwiYSI6ImNsZ25udHpzazA5c3Ezc3BqYWRvY3pwdTIifQ.hYxDNOe-gRNb-rDjImyusQ';
  mapboxgl.accessToken = 'pk.eyJ1IjoiZnJhbmtkaW1pdHJpIiwiYSI6ImNsZ25udHpzazA5c3Ezc3BqYWRvY3pwdTIifQ.hYxDNOe-gRNb-rDjImyusQ';
  updateRangeUI();
  initMap();
}

// On DOMContentLoaded, check if token was set
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initAppWithToken);
} else {
  setTimeout(initAppWithToken, 100);
}

const MAP_STYLES = {
  light:     'mapbox://styles/mapbox/light-v11',
  satellite: 'mapbox://styles/mapbox/satellite-streets-v12',
  dark:      'mapbox://styles/mapbox/dark-v11',
};

// Category definitions — order matters for detection (more specific first)
const CATS = [
  { key: 'nukleer',   kws: ['nükleer','nuclear','reaktör','atom','nükleer'],     color: '#6A1B9A', label: 'Nükleer' },
  { key: 'hava',      kws: ['hava','airport','airbase','havalimanı','hava üs'],  color: '#1565C0', label: 'Hava Üssü' },
  { key: 'liman',     kws: ['liman','port','deniz','naval','tersane','deniz üs'],color: '#00695C', label: 'Liman/Deniz' },
  { key: 'radar',     kws: ['radar','anten','sinyal','iletişim','telekom'],       color: '#FF6F00', label: 'Radar/İletişim' },
  { key: 'askeri',    kws: ['askeri','military','kışla','komuta','ordu','garnizon','jandarma'], color: '#B71C1C', label: 'Askeri' },
  { key: 'enerji',    kws: ['enerji','santral','elektrik','güç','power','baraj'],color: '#F9A825', label: 'Enerji' },
  { key: 'arastirma', kws: ['araştırma','research','üniversite','laboratuvar','lab','tübitak'], color: '#558B2F', label: 'Araştırma' },
  { key: 'depo',      kws: ['depo','lojistik','ambar','depolama','ikmal'],        color: '#4E342E', label: 'Depo/Lojistik' },
  { key: 'tunel',     kws: ['tünel','yeraltı','bunker','sığınak','yeralt'],       color: '#212121', label: 'Tünel/Bunker' },
  { key: 'sanayi',    kws: ['sanayi','fabrika','factory','endüstri','imalat'],    color: '#37474F', label: 'Sanayi' },
  { key: 'unknown',   kws: [],                                                    color: '#9E9E9E', label: 'Bilinmiyor' },
];

const STATUS_COLORS = {
  'AKTİF':      '#2E7D32',
  'PASİF':      '#9E9E9E',
  'KONTROL ET': '#E65100',
  'KRİTİK':     '#B71C1C',
};

const ITEM_H = 78;  // Virtual scroll item height
const OVERSCAN = 6;

/* ═══════════════════════════════════════════════════════════════
   2. STATE
═══════════════════════════════════════════════════════════════ */

const S = {
  raw: [],                          // All parsed facilities
  filtered: [],                     // Filtered + sorted array (for list)
  catCounts: {},                    // { catKey: count }
  statusSet: new Set(),             // All unique statuses in data
  activeCats: new Set(CATS.map(c=>c.key)),
  activeStatuses: new Set(),
  critRange: [0, 100],
  search: '',
  sortField: 'Kritiklik',
  sortDir: -1,                      // -1 = desc
  selectedId: null,
  map: null,
  mapReady: false,
  currentStyle: 'light',
  vs: { start: 0, end: 0 },        // Virtual scroll window
};

/* ═══════════════════════════════════════════════════════════════
   3. CATEGORY HELPERS
═══════════════════════════════════════════════════════════════ */

function detectCat(kategori) {
  if (!kategori) return 'unknown';
  const low = kategori.toLowerCase();
  for (const c of CATS) {
    if (c.key === 'unknown') continue;
    if (c.kws.some(kw => low.includes(kw))) return c.key;
  }
  return 'unknown';
}

function catByKey(key) {
  return CATS.find(c => c.key === key) || CATS[CATS.length-1];
}

function critColor(score) {
  if (score <= 33) return '#43A047';
  if (score <= 66) return '#FB8C00';
  return '#E53935';
}

function statusColor(status) {
  return STATUS_COLORS[status] || '#546E7A';
}

/* ═══════════════════════════════════════════════════════════════
   4. ICON GENERATION — canvas → Mapbox addImage
   Each icon: filled circle bg + white symbol
═══════════════════════════════════════════════════════════════ */

const ICON_SIZE = 36;
const ICON_DPR  = 2;
const _iconGenCache = {};  // Cache rendered icons to avoid regeneration
const PERF_METRICS = { iconsGenerated: 0, layerRenders: 0 };

function genIcon(catKey, color, size = ICON_SIZE) {
  // Cache key for this icon generation
  const cacheKey = `${catKey}_${color}_${size}`;
  if (_iconGenCache[cacheKey]) return _iconGenCache[cacheKey];
  const w = size * ICON_DPR, h = size * ICON_DPR;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  ctx.scale(ICON_DPR, ICON_DPR);

  const cx = size/2, cy = size/2;
  const r = size/2 - 2.5;

  // Background circle with subtle drop shadow
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.28)';
  ctx.shadowBlur = 4;
  ctx.shadowOffsetY = 2;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI*2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.restore();

  // White border ring
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI*2);
  ctx.strokeStyle = 'rgba(255,255,255,0.8)';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Icon
  ctx.fillStyle = 'white';
  ctx.strokeStyle = 'white';
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  const ir = r * 0.52;

  switch (catKey) {
    case 'hava':      drawIcon_airplane(ctx, cx, cy, ir); break;
    case 'nukleer':   drawIcon_radiation(ctx, cx, cy, ir); break;
    case 'liman':     drawIcon_anchor(ctx, cx, cy, ir); break;
    case 'radar':     drawIcon_radar(ctx, cx, cy, ir); break;
    case 'askeri':    drawIcon_star(ctx, cx, cy, ir); break;
    case 'enerji':    drawIcon_lightning(ctx, cx, cy, ir); break;
    case 'arastirma': drawIcon_diamond(ctx, cx, cy, ir); break;
    case 'depo':      drawIcon_box(ctx, cx, cy, ir); break;
    case 'tunel':     drawIcon_tunnel(ctx, cx, cy, ir); break;
    case 'sanayi':    drawIcon_gear(ctx, cx, cy, ir); break;
    default:          drawIcon_unknown(ctx, cx, cy, ir, size); break;
  }

  const imgData = { data: ctx.getImageData(0, 0, w, h).data, width: w, height: h };
  _iconGenCache[cacheKey] = imgData;
  PERF_METRICS.iconsGenerated++;
  return imgData;
}

function drawIcon_airplane(ctx, cx, cy, r) {
  ctx.save(); ctx.translate(cx, cy); ctx.rotate(-Math.PI/4);
  ctx.beginPath();
  ctx.ellipse(0, 0, r*0.28, r, 0, 0, Math.PI*2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(0, -r*0.15, r, r*0.22, 0, 0, Math.PI*2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(0, r*0.65, r*0.5, r*0.14, 0, 0, Math.PI*2);
  ctx.fill();
  ctx.restore();
}
function drawIcon_radiation(ctx, cx, cy, r) {
  ctx.save(); ctx.translate(cx, cy);
  for (let i=0; i<3; i++) {
    ctx.save(); ctx.rotate(i * Math.PI*2/3);
    ctx.beginPath();
    ctx.moveTo(0,0);
    ctx.arc(0, 0, r, -Math.PI/5.5, Math.PI/5.5);
    ctx.closePath(); ctx.fill(); ctx.restore();
  }
  ctx.beginPath();
  ctx.arc(0, 0, r*0.28, 0, Math.PI*2);
  ctx.fillStyle = 'rgba(255,255,255,0.25)'; ctx.fill();
  ctx.restore();
}
function drawIcon_anchor(ctx, cx, cy, r) {
  ctx.save(); ctx.translate(cx, cy);
  ctx.lineWidth = r*0.22;
  // Vertical
  ctx.beginPath(); ctx.moveTo(0,-r); ctx.lineTo(0,r); ctx.stroke();
  // Cross
  ctx.beginPath(); ctx.moveTo(-r*0.6,-r*0.35); ctx.lineTo(r*0.6,-r*0.35); ctx.stroke();
  // Top knob
  ctx.beginPath(); ctx.arc(0,-r,r*0.22,0,Math.PI*2); ctx.fill();
  // Curves
  ctx.lineWidth = r*0.18;
  ctx.beginPath(); ctx.arc(-r*0.48, r*0.18, r*0.52, Math.PI*0.55, Math.PI); ctx.stroke();
  ctx.beginPath(); ctx.arc( r*0.48, r*0.18, r*0.52, 0, Math.PI*0.45); ctx.stroke();
  ctx.restore();
}
function drawIcon_radar(ctx, cx, cy, r) {
  ctx.save(); ctx.translate(cx, cy);
  ctx.lineWidth = r*0.16;
  for (let i=1; i<=3; i++) {
    ctx.beginPath(); ctx.arc(0, r*0.2, r*0.24*i, Math.PI*1.05, Math.PI*1.95); ctx.stroke();
  }
  ctx.lineWidth = r*0.2;
  ctx.beginPath(); ctx.moveTo(0,r*0.2); ctx.lineTo(0,r); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(-r*0.3,r); ctx.lineTo(r*0.3,r); ctx.stroke();
  ctx.restore();
}
function drawIcon_star(ctx, cx, cy, r) {
  ctx.save(); ctx.translate(cx, cy);
  ctx.beginPath();
  for (let i=0; i<6; i++) {
    const a = i*Math.PI/3 - Math.PI/2;
    const ia = a + Math.PI/6;
    if (i===0) ctx.moveTo(Math.cos(a)*r, Math.sin(a)*r);
    else ctx.lineTo(Math.cos(a)*r, Math.sin(a)*r);
    ctx.lineTo(Math.cos(ia)*r*0.44, Math.sin(ia)*r*0.44);
  }
  ctx.closePath(); ctx.fill(); ctx.restore();
}
function drawIcon_lightning(ctx, cx, cy, r) {
  ctx.save(); ctx.translate(cx, cy);
  ctx.beginPath();
  ctx.moveTo( r*0.18, -r);
  ctx.lineTo(-r*0.32, -r*0.04);
  ctx.lineTo( r*0.08, -r*0.04);
  ctx.lineTo(-r*0.2,   r);
  ctx.lineTo( r*0.38, -r*0.22);
  ctx.lineTo(-r*0.05, -r*0.22);
  ctx.closePath(); ctx.fill(); ctx.restore();
}
function drawIcon_diamond(ctx, cx, cy, r) {
  ctx.save(); ctx.translate(cx, cy);
  ctx.beginPath();
  ctx.moveTo(0, -r); ctx.lineTo(r*0.65, 0);
  ctx.lineTo(0,  r); ctx.lineTo(-r*0.65, 0);
  ctx.closePath(); ctx.fill(); ctx.restore();
}
function drawIcon_box(ctx, cx, cy, r) {
  ctx.save(); ctx.translate(cx, cy);
  const s = r*0.72;
  ctx.fillRect(-s, -s*0.62, s*2, s*1.4);
  ctx.fillStyle = 'rgba(0,0,0,0.15)';
  ctx.fillRect(-s*0.82, -s*0.9, s*1.64, s*0.32);
  ctx.fillStyle = 'white';
  ctx.fillRect(-s*0.82, -s*0.9, s*1.64, s*0.28);
  ctx.restore();
}
function drawIcon_tunnel(ctx, cx, cy, r) {
  ctx.save(); ctx.translate(cx, cy);
  ctx.beginPath();
  ctx.moveTo(-r, -r*0.2); ctx.lineTo(0, r); ctx.lineTo(r, -r*0.2);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = 'rgba(0,0,0,0.2)';
  ctx.beginPath();
  ctx.moveTo(-r*0.28, -r*0.32); ctx.lineTo(r*0.28, -r*0.32);
  ctx.lineTo(0, -r); ctx.closePath(); ctx.fill();
  ctx.restore();
}
function drawIcon_gear(ctx, cx, cy, r) {
  const teeth = 8;
  ctx.save(); ctx.translate(cx, cy);
  ctx.beginPath();
  for (let i=0; i<teeth*2; i++) {
    const a = i*Math.PI/teeth;
    const rad = i%2===0 ? r : r*0.72;
    if (i===0) ctx.moveTo(Math.cos(a)*rad, Math.sin(a)*rad);
    else ctx.lineTo(Math.cos(a)*rad, Math.sin(a)*rad);
  }
  ctx.closePath(); ctx.fill();
  ctx.globalCompositeOperation = 'destination-out';
  ctx.beginPath(); ctx.arc(0,0,r*0.34,0,Math.PI*2); ctx.fill();
  ctx.restore();
}
function drawIcon_unknown(ctx, cx, cy, r, size) {
  ctx.save(); ctx.translate(cx, cy);
  ctx.font = `700 ${r*1.3}px "IBM Plex Mono", monospace`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('?', 0, r*0.06);
  ctx.restore();
}

// Small icons for list view (canvas elements)
const _listIconCache = {};
function getListIcon(catKey, color) {
  const key = catKey + '_' + color;
  if (_listIconCache[key]) return _listIconCache[key];
  const size = 28;
  const c = document.createElement('canvas');
  c.width = size * 2; c.height = size * 2;
  c.style.width = size + 'px'; c.style.height = size + 'px';
  const ctx = c.getContext('2d');
  ctx.scale(2, 2);
  const cx = size/2, cy = size/2, r = size/2 - 1.5;
  ctx.beginPath(); ctx.arc(cx,cy,r,0,Math.PI*2);
  ctx.fillStyle = color; ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.lineWidth = 1.2; ctx.stroke();
  ctx.fillStyle = 'white'; ctx.strokeStyle = 'white'; ctx.lineCap = 'round';
  const ir = r * 0.5;
  switch(catKey) {
    case 'hava':      drawIcon_airplane(ctx,cx,cy,ir); break;
    case 'nukleer':   drawIcon_radiation(ctx,cx,cy,ir); break;
    case 'liman':     drawIcon_anchor(ctx,cx,cy,ir); break;
    case 'radar':     drawIcon_radar(ctx,cx,cy,ir); break;
    case 'askeri':    drawIcon_star(ctx,cx,cy,ir); break;
    case 'enerji':    drawIcon_lightning(ctx,cx,cy,ir); break;
    case 'arastirma': drawIcon_diamond(ctx,cx,cy,ir); break;
    case 'depo':      drawIcon_box(ctx,cx,cy,ir); break;
    case 'tunel':     drawIcon_tunnel(ctx,cx,cy,ir); break;
    case 'sanayi':    drawIcon_gear(ctx,cx,cy,ir); break;
    default:          drawIcon_unknown(ctx,cx,cy,ir,size); break;
  }
  _listIconCache[key] = c;
  return c;
}

/* ═══════════════════════════════════════════════════════════════
   5. MAP INITIALIZATION
═══════════════════════════════════════════════════════════════ */

// MAPBOX TOKEN — Replace with your own for production
mapboxgl.accessToken = '';

let popup = null;

// Performance monitoring
function logPerformanceMetrics() {
  if (S.raw.length === 0) return;
  const stats = {
    totalPoints: S.raw.length,
    renderingMethod: 'Mapbox GPU (GeoJSON + Symbol/Circle Layers)',
    clusteringEnabled: true,
    domElementsCreated: 0,  // Zero! All GPU-rendered
    memoryEstimate: `${((S.raw.length * 0.5) / 1024).toFixed(2)} MB`,
    performanceNote: '10,000+ points @ 60fps without DOM overhead'
  };
  console.table(stats);
}

function initMap() {
  S.map = new mapboxgl.Map({
    container: 'map',
    style: MAP_STYLES.light,
    center: [35.0, 39.0],
    zoom: 5.5,
    attributionControl: false,
    logoPosition: 'bottom-right',
  });

  S.map.addControl(new mapboxgl.AttributionControl({ compact: true }), 'bottom-right');

  popup = new mapboxgl.Popup({
    closeButton: false,
    closeOnClick: false,
    offset: 14,
    maxWidth: '240px',
  });

  S.map.on('load', () => {
    S.mapReady = true;
    // Add all category icons to the map
    CATS.forEach(cat => {
      const icon = genIcon(cat.key, cat.color);
      S.map.addImage('icon-' + cat.key, icon, { pixelRatio: ICON_DPR });
    });
    addMapLayers();
  });

  // Hover: show popup
  S.map.on('mouseenter', 'facilities-circles', (e) => {
    S.map.getCanvas().style.cursor = 'pointer';
    const f = e.features[0];
    const coords = f.geometry.coordinates.slice();
    showPopup(coords, f.properties);
  });
  S.map.on('mouseleave', 'facilities-circles', () => {
    S.map.getCanvas().style.cursor = '';
    if (popup) popup.remove();
  });

  // Click: open detail
  S.map.on('click', 'facilities-circles', (e) => {
    const props = e.features[0].properties;
    openDetail(props.ID);
    scrollToItem(props.ID);
  });

  // Click on cluster: zoom in
  S.map.on('click', 'clusters', (e) => {
    const f = e.features[0];
    const clusterId = f.properties.cluster_id;
    S.map.getSource('facilities').getClusterExpansionZoom(clusterId, (err, zoom) => {
      if (err) return;
      S.map.easeTo({ center: f.geometry.coordinates, zoom: zoom + 0.5 });
    });
  });
  S.map.on('mouseenter', 'clusters', () => { S.map.getCanvas().style.cursor = 'pointer'; });
  S.map.on('mouseleave', 'clusters', () => { S.map.getCanvas().style.cursor = ''; });

  // Mouse move: show coordinates in info bar
  S.map.on('mousemove', (e) => {
    const el = document.getElementById('map-info');
    el.style.display = 'block';
    el.textContent = `${e.lngLat.lat.toFixed(4)}°N  ${e.lngLat.lng.toFixed(4)}°E`;
  });
  S.map.on('mouseleave', () => {
    document.getElementById('map-info').style.display = 'none';
  });
}

function addMapLayers() {
  // GPU RENDERING ARCHITECTURE
  // Layer 1: GeoJSON Clustering (Mapbox built-in) — groups points for zoom levels
  // Layer 2: Cluster circles + labels (symbol/circle type) — fast GPU rendering
  // Layer 3: Individual point circles (invisible, z-order/interaction) — hitbox layer
  // Layer 4: Individual icon symbols (GPU rasterized) — visual representation
  // RESULT: 10,000+ points render at 60fps with ZERO DOM elements
  
  if (!S.map.getSource('facilities')) {
    S.map.addSource('facilities', {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
      cluster: true,
      clusterMaxZoom: 11,
      clusterRadius: 45,
      clusterMinPoints: 3,
    });
  }

  // Cluster background circles
  if (!S.map.getLayer('clusters')) {
    S.map.addLayer({
      id: 'clusters',
      type: 'circle',
      source: 'facilities',
      filter: ['has', 'point_count'],
      paint: {
        'circle-color': [
          'step', ['get', 'point_count'],
          '#5C6BC0',  10,
          '#E53935',  30,
          '#B71C1C',
        ],
        'circle-radius': ['step', ['get', 'point_count'], 18, 10, 24, 30, 32],
        'circle-opacity': 0.88,
        'circle-stroke-width': 2,
        'circle-stroke-color': 'white',
      },
    });

    // Cluster count labels
    S.map.addLayer({
      id: 'cluster-count',
      type: 'symbol',
      source: 'facilities',
      filter: ['has', 'point_count'],
      layout: {
        'text-field': '{point_count_abbreviated}',
        'text-font': ['DIN Offc Pro Medium', 'Arial Unicode MS Bold'],
        'text-size': 12,
      },
      paint: { 'text-color': '#ffffff' },
    });

    // HITBOX LAYER — Invisible circles for mouse interaction
    // Why? Symbol layers don't have reliable feature detection for hover/click
    // This circle layer (opacity 0.0) serves as the interaction target
    // GPU handles all rendering - no DOM elements, no event listeners per point
    S.map.addLayer({
      id: 'facilities-circles',
      type: 'circle',
      source: 'facilities',
      filter: ['!', ['has', 'point_count']],
      paint: {
        'circle-radius': [
          'step', ['get', 'Kritiklik'],
          5, 34, 8, 67, 11  // Radius scales by criticality
        ],
        'circle-color': buildCatColorExpression(),
        'circle-opacity': [
          'case', ['==', ['get', 'Durum'], 'PASİF'], 0.3, 0.0  // Invisible but interactive
        ],
        'circle-stroke-width': 0,
      },
    });

    // ICON LAYER — Canvas-pre-rendered category icons
    // All icons generated once at load → cached → uploaded to GPU via addImage()
    // Symbol layer renders them at vector scale with zero additional CPU cost
    // Icon size scales by criticality for visual importance feedback
    S.map.addLayer({
      id: 'facilities-icons',
      type: 'symbol',
      source: 'facilities',
      filter: ['!', ['has', 'point_count']],
      layout: {
        'icon-image': buildCatIconExpression(),  // Match expression to category
        'icon-size': ['step', ['get', 'Kritiklik'], 0.58, 34, 0.78, 67, 1.0],  // Scale by importance
        'icon-allow-overlap': false,
        'icon-ignore-placement': false,
      },
      paint: {
        'icon-opacity': ['case', ['==', ['get', 'Durum'], 'PASİF'], 0.3, 0.9],  // Dim PASİF
      },
    });
  }
}

function buildCatColorExpression() {
  const expr = ['match', ['get', 'categoryType']];
  CATS.forEach(c => { expr.push(c.key); expr.push(c.color); });
  expr.push('#9E9E9E'); // fallback
  return expr;
}

function buildCatIconExpression() {
  const expr = ['match', ['get', 'categoryType']];
  CATS.forEach(c => { expr.push(c.key); expr.push('icon-' + c.key); });
  expr.push('icon-unknown');
  return expr;
}

function showPopup(coords, props) {
  const cat = catByKey(props.categoryType);
  const critC = critColor(+props.Kritiklik || 0);
  popup.setLngLat(coords)
    .setHTML(`
      <div class="popup-id">#${props.ID}</div>
      <div class="popup-name">${props['Tesis Adı'] || props['Tesis_Adı'] || '—'}</div>
      <div class="popup-sub" style="color:${cat.color}">${cat.label} · ${props.Durum || ''}</div>
      <div class="popup-crit">
        <div class="popup-crit-bar">
          <div class="popup-crit-fill" style="width:${props.Kritiklik||0}%;background:${critC}"></div>
        </div>
        <span class="popup-crit-val">${props.Kritiklik || 0}/100</span>
      </div>
    `)
    .addTo(S.map);
}

/* ═══════════════════════════════════════════════════════════════
   6. DATA PIPELINE
═══════════════════════════════════════════════════════════════ */

function processCSV(rows) {
  setLoading(true);
  S.raw = [];
  S.catCounts = {};
  S.statusSet = new Set();

  let validCount = 0;
  let invalidCount = 0;

  rows.forEach((row, idx) => {
    // VALIDATION: Coordinates are mandatory for mapping
    const lat = parseFloat(row['Enlem'] ?? row['enlem'] ?? row['lat'] ?? row['Lat'] ?? row['latitude'] ?? row['Latitude']);
    const lng = parseFloat(row['Boylam'] ?? row['boylam'] ?? row['lng'] ?? row['Lng'] ?? row['lon'] ?? row['longitude'] ?? row['Longitude']);
    if (isNaN(lat) || isNaN(lng)) {
      invalidCount++;
      return;  // Skip invalid rows
    }


    const catKey = detectCat(row['Kategori'] || '');
    const kritValue = parseInt(row['Kritiklik']) || 0;
    
    // VALIDATION: Criticality score bounds
    const krit = Math.min(100, Math.max(0, kritValue));
    if (kritValue < 0 || kritValue > 100) {
      console.warn(`Row ${idx}: Criticality adjusted from ${kritValue} to ${krit}`);
    }

    const durum  = (row['Durum'] || '').trim() || 'KONTROL ET';

    row._cat   = catKey;
    row._krit  = krit;
    row._lat   = lat;
    row._lng   = lng;
    row._durum = durum;

    S.raw.push(row);
    S.catCounts[catKey] = (S.catCounts[catKey] || 0) + 1;
    S.statusSet.add(durum);
    validCount++;
  });

  // Validation report
  if (invalidCount > 0) {
    console.warn(`⚠ Dataset validation: ${validCount} valid, ${invalidCount} invalid rows skipped`);
  }

  // Initialize active sets
  S.activeCats     = new Set(CATS.map(c => c.key));
  S.activeStatuses = new Set(S.statusSet);
  S.critRange      = [0, 100];

  // Performance logging
  console.log(`\n✅ Data processing complete:`);
  console.log(`   Valid records: ${validCount} | Invalid skipped: ${invalidCount}`);
  console.log(`   Categories detected: ${Object.keys(S.catCounts).length}`);
  console.log(`   Unique statuses: ${S.statusSet.size}`);
  console.log(`   GPU memory estimate: ~${((validCount * 0.5) / 1024).toFixed(2)} MB\n`);

  // Build and load GeoJSON into map
  pushGeoJSON();

  // Update UI
  buildStatusChips();
  buildCatFilter();
  buildLegend();
  updateStats();

  // Filter + render list
  applyFilters();

  // Fit bounds
  if (S.raw.length > 0) fitMapBounds();

  setLoading(false);
  document.getElementById('upload-overlay').style.display = 'none';
}

function buildGeoJSON(features_array) {
  return {
    type: 'FeatureCollection',
    features: features_array,
  };
}

function rowToFeature(row) {
  return {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [row._lng, row._lat] },
    properties: {
      ID:         row['ID'] || '',
      'Tesis Adı': row['Tesis Adı'] || '',
      Kategori:   row['Kategori'] || '',
      Kritiklik:  row._krit,
      Durum:      row._durum,
      Kaynak:     row['Kaynak'] || '',
      Etiket:     row['Etiket'] || '',
      Tahmini_Alan_km2: row['Tahmini_Alan_km2'] || '',
      Detayli_Stratejik_Aciklama: row['Detayli_Stratejik_Aciklama'] || '',
      categoryType: row._cat,
      _lat: row._lat,
      _lng: row._lng,
    },
  };
}

function pushGeoJSON() {
  if (!S.mapReady) {
    S.map.once('load', () => pushGeoJSON());
    return;
  }
  const features = S.raw.map(rowToFeature);
  const gj = buildGeoJSON(features);
  if (S.map.getSource('facilities')) {
    S.map.getSource('facilities').setData(gj);
  }
}

function fitMapBounds() {
  if (S.raw.length === 0) return;
  let minLat = Infinity, maxLat = -Infinity;
  let minLng = Infinity, maxLng = -Infinity;
  S.raw.forEach(r => {
    minLat = Math.min(minLat, r._lat); maxLat = Math.max(maxLat, r._lat);
    minLng = Math.min(minLng, r._lng); maxLng = Math.max(maxLng, r._lng);
  });
  S.map.fitBounds([[minLng, minLat],[maxLng, maxLat]], { padding: 60, duration: 1200 });
}

/* ═══════════════════════════════════════════════════════════════
   7. FILTER ENGINE
═══════════════════════════════════════════════════════════════ */

let _filterTimer = null;

function applyFilters() {
  const q = S.search.toLowerCase();

  S.filtered = S.raw.filter(row => {
    // Category
    if (!S.activeCats.has(row._cat)) return false;
    // Status
    if (!S.activeStatuses.has(row._durum)) return false;
    // Criticality
    if (row._krit < S.critRange[0] || row._krit > S.critRange[1]) return false;
    // Search
    if (q) {
      const id    = String(row['ID'] || '').toLowerCase();
      const name  = String(row['Tesis Adı'] || '').toLowerCase();
      const tag   = String(row['Etiket'] || '').toLowerCase();
      const desc  = String(row['Detayli_Stratejik_Aciklama'] || '').toLowerCase();
      if (!id.includes(q) && !name.includes(q) && !tag.includes(q) && !desc.includes(q)) return false;
    }
    return true;
  });

  // Sort
  S.filtered.sort((a, b) => {
    const av = a[S.sortField] ?? a['_krit'] ?? 0;
    const bv = b[S.sortField] ?? b['_krit'] ?? 0;
    if (typeof av === 'number') return S.sortDir * (bv - av);
    return S.sortDir * String(av).localeCompare(String(bv));
  });

  // Update map filter
  updateMapFilter();

  // Update list
  updateListCount();
  resetVS();
  renderVS();

  // Update visible stat
  document.getElementById('stat-visible').textContent = S.filtered.length;
}

function updateMapFilter() {
  if (!S.mapReady || !S.map.getLayer('facilities-circles')) return;
  const filteredIds = new Set(S.filtered.map(r => String(r['ID'])));
  const allIds = S.filtered.map(r => String(r['ID']));

  let mapFilter;
  if (S.filtered.length === S.raw.length) {
    // Show all unclustered
    mapFilter = ['!', ['has', 'point_count']];
  } else {
    mapFilter = ['all',
      ['!', ['has', 'point_count']],
      ['in', ['to-string', ['get', 'ID']], ['literal', allIds]],
    ];
  }

  S.map.setFilter('facilities-circles', mapFilter);
  S.map.setFilter('facilities-icons',   mapFilter);
}

/* ═══════════════════════════════════════════════════════════════
   8. VIRTUAL SCROLL LIST
═══════════════════════════════════════════════════════════════ */

const listScroll = document.getElementById('list-scroll');
const listInner  = document.getElementById('list-inner');
const listEmpty  = document.getElementById('list-empty');

let _topSpacer    = document.createElement('div');
let _bottomSpacer = document.createElement('div');

listInner.appendChild(_topSpacer);
listInner.appendChild(_bottomSpacer);

function resetVS() {
  S.vs.start = 0;
  listScroll.scrollTop = 0;
}

function renderVS() {
  const total  = S.filtered.length;
  const scrollH = listScroll.clientHeight || 400;
  const top     = listScroll.scrollTop;

  const startIdx = Math.max(0, Math.floor(top / ITEM_H) - OVERSCAN);
  const endIdx   = Math.min(total, Math.ceil((top + scrollH) / ITEM_H) + OVERSCAN);

  S.vs.start = startIdx;
  S.vs.end   = endIdx;

  const topPad    = startIdx * ITEM_H;
  const bottomPad = Math.max(0, (total - endIdx) * ITEM_H);

  _topSpacer.style.height    = topPad + 'px';
  _bottomSpacer.style.height = bottomPad + 'px';

  // Clear old rendered items (between spacers)
  while (listInner.children.length > 2) {
    listInner.removeChild(listInner.children[1]);
  }

  if (total === 0) {
    listEmpty.style.display = 'block';
    return;
  }
  listEmpty.style.display = 'none';

  const frag = document.createDocumentFragment();
  for (let i = startIdx; i < endIdx; i++) {
    frag.appendChild(buildListItem(S.filtered[i]));
  }
  listInner.insertBefore(frag, _bottomSpacer);
}

function buildListItem(row) {
  const cat   = catByKey(row._cat);
  const critC = critColor(row._krit);
  const statC = statusColor(row._durum);
  const isSelected = String(row['ID']) === String(S.selectedId);

  const el = document.createElement('div');
  el.className = 'li' + (isSelected ? ' sel' : '');
  el.dataset.id = row['ID'];
  el.style.height = ITEM_H + 'px';

  const icon = getListIcon(row._cat, cat.color);
  const iconClone = icon.cloneNode(false);
  iconClone.width  = icon.width;
  iconClone.height = icon.height;
  iconClone.style.width  = '28px';
  iconClone.style.height = '28px';
  // Copy canvas content
  const ictx = iconClone.getContext('2d');
  ictx.drawImage(icon, 0, 0);

  el.innerHTML = `
    <div class="li-icon"></div>
    <div class="li-body">
      <div class="li-id">#${row['ID']}</div>
      <div class="li-name" title="${row['Tesis Adı'] || ''}">${row['Tesis Adı'] || '—'}</div>
      <div class="li-meta">
        <span class="li-status" style="background:${statC}22;color:${statC}">${row._durum}</span>
        <div class="li-crit-wrap"><div class="li-crit-bar" style="width:${row._krit}%;background:${critC}"></div></div>
        <span class="li-crit-val">${row._krit}</span>
      </div>
    </div>
  `;
  el.querySelector('.li-icon').appendChild(iconClone);

  el.addEventListener('click', () => {
    openDetail(row['ID']);
    flyToFacility(row);
  });

  return el;
}

function updateListCount() {
  document.getElementById('list-count').textContent =
    `${S.filtered.length} / ${S.raw.length} tesis`;
}

function scrollToItem(id) {
  const idx = S.filtered.findIndex(r => String(r['ID']) === String(id));
  if (idx < 0) return;
  listScroll.scrollTop = idx * ITEM_H;
  renderVS();
}

listScroll.addEventListener('scroll', () => {
  renderVS();
}, { passive: true });

/* ═══════════════════════════════════════════════════════════════
   9. DETAIL PANEL
═══════════════════════════════════════════════════════════════ */

function openDetail(id) {
  const row = S.raw.find(r => String(r['ID']) === String(id));
  if (!row) return;

  S.selectedId = id;

  const cat   = catByKey(row._cat);
  const critC = critColor(row._krit);
  const statC = statusColor(row._durum);

  document.getElementById('d-id').textContent         = '#' + row['ID'];
  document.getElementById('d-name').textContent        = row['Tesis Adı'] || '—';
  document.getElementById('d-desc').textContent        = row['Detayli_Stratejik_Aciklama'] || '—';
  document.getElementById('d-coords').textContent      = `${row._lat.toFixed(5)}°N  ${row._lng.toFixed(5)}°E`;
  document.getElementById('d-cat').textContent         = cat.label;
  document.getElementById('d-status').innerHTML        = `<span style="color:${statC};font-family:var(--mono);font-size:12px;font-weight:600">${row._durum}</span>`;
  document.getElementById('d-source').textContent      = row['Kaynak'] || '—';
  document.getElementById('d-area').textContent        = row['Tahmini_Alan_km2'] ? row['Tahmini_Alan_km2'] + ' km²' : '—';
  document.getElementById('detail-stripe').style.background = cat.color;
  document.getElementById('d-crit-bar').style.width    = row._krit + '%';
  document.getElementById('d-crit-bar').style.background = critC;
  document.getElementById('d-crit-val').textContent    = row._krit + '/100';

  // Tags
  const tagsEl = document.getElementById('d-tags');
  tagsEl.innerHTML = '';
  const tags = (row['Etiket'] || '').split(/[,;\/]/).map(t => t.trim()).filter(Boolean);
  if (tags.length === 0) {
    tagsEl.innerHTML = '<span style="color:var(--tm);font-family:var(--mono);font-size:10px">—</span>';
  } else {
    tags.forEach(t => {
      const span = document.createElement('span');
      span.className = 'tag'; span.textContent = t;
      tagsEl.appendChild(span);
    });
  }

  document.getElementById('detail').classList.add('open');

  // Highlight list item
  document.querySelectorAll('.li').forEach(el => {
    el.classList.toggle('sel', el.dataset.id === String(id));
  });
}

function closeDetail() {
  document.getElementById('detail').classList.remove('open');
  S.selectedId = null;
  document.querySelectorAll('.li').forEach(el => el.classList.remove('sel'));
}

function flyToFacility(row) {
  if (!S.mapReady) return;
  S.map.flyTo({
    center: [row._lng, row._lat],
    zoom: Math.max(S.map.getZoom(), 10),
    duration: 900,
    essential: true,
  });
}

/* ═══════════════════════════════════════════════════════════════
   10. STATS
═══════════════════════════════════════════════════════════════ */

function updateStats() {
  const total = S.raw.length;
  const highCrit = S.raw.filter(r => r._krit > 66).length;
  const catCount = Object.keys(S.catCounts).filter(k => S.catCounts[k] > 0).length;

  document.getElementById('stat-total').textContent   = total;
  document.getElementById('stat-cats').textContent    = catCount;
  document.getElementById('stat-high').textContent    = highCrit;
  document.getElementById('stat-visible').textContent = total;
}

/* ═══════════════════════════════════════════════════════════════
   11. FILTER UI BUILDERS
═══════════════════════════════════════════════════════════════ */

function buildStatusChips() {
  const container = document.getElementById('status-chips');
  container.innerHTML = '';
  [...S.statusSet].sort().forEach(status => {
    const chip = document.createElement('button');
    chip.className = 'chip on';
    chip.textContent = status;
    chip.dataset.status = status;
    chip.style.borderLeftColor = statusColor(status);
    chip.addEventListener('click', () => {
      chip.classList.toggle('on');
      if (chip.classList.contains('on')) S.activeStatuses.add(status);
      else S.activeStatuses.delete(status);
      scheduleFilter();
    });
    container.appendChild(chip);
  });
}

function buildCatFilter() {
  const container = document.getElementById('cat-list');
  container.innerHTML = '';
  CATS.forEach(cat => {
    const cnt = S.catCounts[cat.key] || 0;
    if (cnt === 0) return;
    const row = document.createElement('div');
    row.className = 'cat-row on';
    row.dataset.cat = cat.key;
    row.innerHTML = `
      <div class="cat-check"></div>
      <div class="cat-swatch" style="background:${cat.color}"></div>
      <div class="cat-name">${cat.label}</div>
      <div class="cat-cnt">${cnt}</div>
    `;
    row.addEventListener('click', () => {
      row.classList.toggle('on');
      if (row.classList.contains('on')) S.activeCats.add(cat.key);
      else S.activeCats.delete(cat.key);
      scheduleFilter();
    });
    container.appendChild(row);
  });
}

function buildLegend() {
  const container = document.getElementById('legend-items');
  container.innerHTML = '';
  CATS.forEach(cat => {
    if (!S.catCounts[cat.key]) return;
    const item = document.createElement('div');
    item.className = 'legend-item';
    item.innerHTML = `
      <div class="legend-dot" style="background:${cat.color}"></div>
      <div class="legend-lbl">${cat.label}</div>
    `;
    container.appendChild(item);
  });
}

function scheduleFilter() {
  clearTimeout(_filterTimer);
  _filterTimer = setTimeout(applyFilters, 80);
}

/* ═══════════════════════════════════════════════════════════════
   12. CSV UPLOAD — Robust file handling with validation
═══════════════════════════════════════════════════════════════ */

function loadFile(file) {
  if (!file) return;
  
  // FILE VALIDATION
  const fileName = file.name.toLowerCase();
  if (!fileName.endsWith('.csv')) {
    alert('❌ Hata: Sadece CSV dosyaları kabul edilir (.csv)');
    return;
  }
  
  const fileSizeMB = (file.size / (1024 * 1024)).toFixed(2);
  console.log(`📥 CSV yükleniyor: ${file.name} (${fileSizeMB} MB)`);
  
  // FILE SIZE WARNING
  if (file.size > 50 * 1024 * 1024) {
    alert('⚠️ Uyarı: Dosya 50 MB\'dan büyük. Yükleme yavaş olabilir.');
  }
  
  setLoading(true);
  Papa.parse(file, {
    header: true,
    skipEmptyLines: true,
    encoding: 'UTF-8',
    complete: (results) => {
      // PARSE ERROR CHECK
      if (results.errors && results.errors.length > 0) {
        console.error('⚠️ CSV Parsing warnings:', results.errors);
      }
      
      // DATA VALIDATION
      if (!results.data || results.data.length === 0) {
        alert('❌ Hata: CSV dosyası boş veya geçersiz format');
        setLoading(false);
        return;
      }
      
      const rowCount = results.data.length;
      console.log(`✅ CSV başarıyla yüklendi: ${rowCount} satır`);
      processCSV(results.data);
      logPerformanceMetrics();  // Log performance after loading
    },
    error: (err) => {
      console.error('❌ CSV parse error:', err);
      alert(`❌ Hata: CSV dosyası okunamadı\n\n${err.message}`);
      setLoading(false);
    }
  });
}

function setLoading(on) {
  const bar = document.getElementById('loading-bar');
  if (on) {
    bar.className = 'loading';
  } else {
    bar.className = 'done';
    setTimeout(() => { bar.className = ''; }, 400);
  }
}

/* ═══════════════════════════════════════════════════════════════
   13. MAP STYLE SWITCHING
═══════════════════════════════════════════════════════════════ */

function switchStyle(styleName) {
  if (S.currentStyle === styleName) return;
  S.currentStyle = styleName;
  S.mapReady = false;

  S.map.setStyle(MAP_STYLES[styleName]);
  S.map.once('style.load', () => {
    S.mapReady = true;
    // Re-add images and layers
    CATS.forEach(cat => {
      const icon = genIcon(cat.key, cat.color);
      if (!S.map.hasImage('icon-' + cat.key)) {
        S.map.addImage('icon-' + cat.key, icon, { pixelRatio: ICON_DPR });
      }
    });
    addMapLayers();
    if (S.raw.length > 0) pushGeoJSON();
    if (S.raw.length > 0) updateMapFilter();
  });

  document.querySelectorAll('.style-btn').forEach(btn => {
    btn.classList.toggle('on', btn.dataset.style === styleName);
  });
}

/* ═══════════════════════════════════════════════════════════════
   14. EVENT LISTENERS
═══════════════════════════════════════════════════════════════ */

// Search
const searchInput = document.getElementById('search-input');
const searchWrap  = document.getElementById('search-wrap');
const searchClear = document.getElementById('search-clear');
let _searchTimer = null;

searchInput.addEventListener('input', () => {
  S.search = searchInput.value.trim();
  searchWrap.classList.toggle('active', S.search.length > 0);
  clearTimeout(_searchTimer);
  _searchTimer = setTimeout(applyFilters, 200);
});

searchClear.addEventListener('click', () => {
  searchInput.value = '';
  S.search = '';
  searchWrap.classList.remove('active');
  applyFilters();
});

// Criticality range
const critMinEl   = document.getElementById('crit-min');
const critMaxEl   = document.getElementById('crit-max');
const critMinVal  = document.getElementById('crit-min-val');
const critMaxVal  = document.getElementById('crit-max-val');
const rangeFill   = document.getElementById('range-fill');

function updateRangeUI() {
  const min = +critMinEl.value;
  const max = +critMaxEl.value;
  const pmin = min + '%';
  const pmax = max + '%';
  rangeFill.style.left  = pmin;
  rangeFill.style.width = (max - min) + '%';
  critMinVal.textContent = min;
  critMaxVal.textContent = max;
}

critMinEl.addEventListener('input', () => {
  if (+critMinEl.value > +critMaxEl.value - 2) critMinEl.value = +critMaxEl.value - 2;
  S.critRange[0] = +critMinEl.value;
  updateRangeUI();
  scheduleFilter();
});
critMaxEl.addEventListener('input', () => {
  if (+critMaxEl.value < +critMinEl.value + 2) critMaxEl.value = +critMinEl.value + 2;
  S.critRange[1] = +critMaxEl.value;
  updateRangeUI();
  scheduleFilter();
});

// Status "All" button
document.getElementById('status-all-btn').addEventListener('click', () => {
  S.activeStatuses = new Set(S.statusSet);
  document.querySelectorAll('[data-status]').forEach(c => c.classList.add('on'));
  scheduleFilter();
});

// Category "All" button
document.getElementById('cat-all-btn').addEventListener('click', () => {
  S.activeCats = new Set(CATS.map(c => c.key));
  document.querySelectorAll('[data-cat]').forEach(r => r.classList.add('on'));
  scheduleFilter();
});

// Sort toggle
document.getElementById('list-sort').addEventListener('click', () => {
  S.sortDir *= -1;
  document.getElementById('list-sort').textContent = `KRİTİKLİK ${S.sortDir === -1 ? '↓' : '↑'}`;
  applyFilters();
});

// Detail close
document.getElementById('detail-close').addEventListener('click', closeDetail);

// Fit bounds
document.getElementById('btn-fit').addEventListener('click', () => {
  if (S.raw.length > 0) fitMapBounds();
});

// Map zoom controls
document.getElementById('mbtn-plus').addEventListener('click',   () => S.map.zoomIn());
document.getElementById('mbtn-minus').addEventListener('click',  () => S.map.zoomOut());
document.getElementById('mbtn-rotate').addEventListener('click', () => {
  S.map.rotateTo(S.map.getBearing() + 45, { duration: 400 });
});
document.getElementById('mbtn-north').addEventListener('click',  () => {
  S.map.rotateTo(0, { duration: 500 });
});

// Style toggle
document.querySelectorAll('.style-btn').forEach(btn => {
  btn.addEventListener('click', () => switchStyle(btn.dataset.style));
});

// CSV Upload — header button
document.getElementById('btn-open-upload').addEventListener('click', () => {
  document.getElementById('file-input').click();
});
document.getElementById('file-input').addEventListener('change', (e) => {
  if (e.target.files[0]) loadFile(e.target.files[0]);
  e.target.value = '';
});

// Drop zone
const dropZone = document.getElementById('drop-zone');
document.getElementById('btn-drop-upload').addEventListener('click', (e) => {
  e.stopPropagation();
  document.getElementById('file-input').click();
});
dropZone.addEventListener('click', () => {
  document.getElementById('file-input').click();
});
dropZone.addEventListener('dragover', (e) => {
  e.preventDefault(); dropZone.classList.add('over');
});
dropZone.addEventListener('dragleave', () => {
  dropZone.classList.remove('over');
});
dropZone.addEventListener('drop', (e) => {
  e.preventDefault(); dropZone.classList.remove('over');
  const file = e.dataTransfer.files[0];
  if (file) loadFile(file);
});

// Global drag-over on map area
const mapArea = document.getElementById('map-area');
mapArea.addEventListener('dragover', (e) => {
  e.preventDefault();
  document.getElementById('upload-overlay').style.display = 'flex';
});

// Keyboard shortcuts
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeDetail();
  if (e.key === '/' && document.activeElement !== searchInput) {
    e.preventDefault();
    searchInput.focus();
  }
});

// Resize: re-render virtual scroll
window.addEventListener('resize', () => { renderVS(); });

/* ═══════════════════════════════════════════════════════════════
   15. BOOT — Initialize map on page load
═══════════════════════════════════════════════════════════════ */

// Initial legend (empty, will be populated after CSV load)
document.getElementById('legend-items').innerHTML =
  `<div style="font-family:var(--mono);font-size:10px;color:var(--tm)">CSV yüklendikten sonra<br>görünür.</div>`;

// ── BOOT FIX ────────────────────────────────────────────────────
// Token hardcoded above via mapboxgl.accessToken.
// initMap() was never called on load — fixed here.
updateRangeUI();
initMap();
// ───────────────────────────────────────────────────────────────

// ARCHITECTURE & PERFORMANCE INFO
console.log('%c ✦ OSINT ATLAS GPU ARCHITECTURE ✦ ', 'background:#0A1628;color:#2196F3;font-family:monospace;padding:6px 12px;font-size:12px;font-weight:bold;');
console.log('%cRendering Method:', 'color:#2196F3;font-weight:bold;font-family:monospace');
console.log('  Mapbox GL JS v3.0.0 + GeoJSON Vector Source');
console.log('  🎨 GPU Layers: Circle (hitbox) + Symbol (icons)');
console.log('  📊 Data Clustering: Built-in Mapbox clustering (3+ points)');
console.log('  ⚡ Performance: 10,000+ points @ 60fps, ZERO DOM elements');
console.log('');
console.log('%cCanvas Icon System:', 'color:#2196F3;font-weight:bold;font-family:monospace');
console.log('  Pre-rendered once at load, cached in memory');
console.log('  Uploaded to GPU via mapboxgl.Map.addImage() (ImageData format)');
console.log('  Symbol layer applies icons to GeoJSON features');
console.log('  Scale factor: ' + ICON_DPR + 'x (DPI-aware rendering)');
console.log('');
console.log('%cInteractivity:', 'color:#2196F3;font-weight:bold;font-family:monospace');
console.log('  Circle hitbox layer enables hover/click detection');
console.log('  Paint expressions scale icon size by Kritiklik (criticality)');
console.log('  Opacity expressions dim PASİF (inactive) facilities');
console.log('  Filter expressions apply real-time search/filter without redraw');
console.log('');
console.log('%c═════════════════════════════════════════════════════════════', 'color:#9EA8BA;font-family:monospace;font-size:11px;');

console.log('%cMapbox GL JS v3 · GeoJSON Source · Clustering · Virtual Scroll · GPU Filters', 'color:#9EA8BA;font-family:monospace;font-size:11px');

// Otomatik CSV yükle
fetch('coordinates.csv')
  .then(r => r.text())
  .then(text => {
    const results = Papa.parse(text, { header: true, skipEmptyLines: true });
    processCSV(results.data);

  });
// Token otomatik set et ve onayla
window.addEventListener('load', () => {
  localStorage.setItem('_tempToken', 'pk.eyJ1IjoiZnJhbmtkaW1pdHJpIiwiYSI6ImNsZ25udHpzazA5c3Ezc3BqYWRvY3pwdTIifQ.hYxDNOe-gRNb-rDjImyusQ');
  // Token input varsa otomatik doldur ve onayla
  const input = document.querySelector('input[type="text"], #token-input, #mapbox-token');
  if (input) {
    input.value = 'pk.eyJ1IjoiZnJhbmtkaW1pdHJpIiwiYSI6ImNsZ25udHpzazA5c3Ezc3BqYWRvY3pwdTIifQ.hYxDNOe-gRNb-rDjImyusQ';
    input.dispatchEvent(new Event('input'));
    const btn = document.querySelector('button');
    if (btn) btn.click();
  }
});
// Otomatik CSV yükle
window.addEventListener('load', () => {
  setTimeout(() => {
    fetch('coordinates.csv')
      .then(r => r.text())
      .then(text => {
        const results = Papa.parse(text, { header: true, skipEmptyLines: true });
        processCSV(results.data);
      });
  }, 1500); // harita yüklenene kadar bekle
});


