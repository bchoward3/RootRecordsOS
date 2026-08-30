// Supabase INIT
const SUPABASE_URL = 'https://vyuqusttytnvqceoaniz.supabase.co';
const SUPABASE_KEY = 'sb_publishable_gFLrIl6ZcWbWd434sPYUYw_X4Y_jLQn';
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// State Assigned inside the load block below. `basemaps` is NOT here — it's declared as a const inside that block, and a duplicate here would be permanently undefined and shadowed.
let map, gravesLayer, lineageLayer, labelsLayer;
let currentUser = null;
let currentGraves = [];
let placedPoint = null;
let mapClickHandler = null;
let moveHandler = null;
let editingGrave = null;
let currentFilterId = null;
let currentFilterName = null;
let ancestorGens = 2;
let descendantGens = 2;
let webVisible = false;
let labelMode = 'name';        // 'name' | 'cemetery' | 'both'
let labelsPermanent = false;   // false = hover only (desktop), true = always on
let labelZoomThreshold = 12;
let gravesWithPhotos = new Set();

window.addEventListener('load', () => {

// Declared here, above every use, so no function can hit it in the
// temporal dead zone if it ever gets called during load.
const labeledNames = new Set();


// Map INIT
map = L.map('map', { zoomControl: true }).setView([37.8, -85.3], 7);

// Routing module needs the map instance
if (window.RRRoute) RRRoute.init(map);

// CARTO raster basemaps now require a free key (5M tiles/month).
// Request one at https://carto.com/basemaps/apikey and paste it here.
// Without it the tiles still load but carry an "API key required" watermark.
const CARTO_KEY = 'cb1_25ei_1_4a1f2d4fcc7676aa77cdd80c';
const cartoSuffix = CARTO_KEY ? '?key=' + CARTO_KEY : '';

const basemaps = {
  voyager: L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png' + cartoSuffix, {
    attribution: '© CARTO © OpenStreetMap', subdomains: 'abcd', maxZoom: 20
  }),
  light: L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png' + cartoSuffix, {
    attribution: '© CARTO © OpenStreetMap', subdomains: 'abcd', maxZoom: 20
  }),
  topo: L.tileLayer('https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer/tile/{z}/{y}/{x}', {
    // Tiles stop at 16; upscale beyond that so zoom stays continuous when
    // switching basemaps rather than hitting a hard stop.
    attribution: '© USGS The National Map', maxNativeZoom: 16, maxZoom: 19
  }),
  osm: L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap', maxZoom: 19
  }),
  satellite: L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    // Rural imagery often tops out at 18; upscale rather than showing blanks.
    attribution: '© Esri', maxNativeZoom: 18, maxZoom: 19
  }),
  toner: L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenTopoMap © OpenStreetMap', maxNativeZoom: 17, maxZoom: 19
  })
};

// Transparent shaded-relief overlay. Sits in its own pane between the
// basemap and the markers, blended with multiply so the terrain darkens the
// basemap rather than washing it out.
map.createPane('hillshade');
map.getPane('hillshade').style.zIndex = 250;
map.getPane('hillshade').style.pointerEvents = 'none';
map.getPane('hillshade').style.mixBlendMode = 'multiply';
map.getPane('hillshade').style.opacity = '0.45';

const hillshadeLayer = L.tileLayer(
  'https://server.arcgisonline.com/ArcGIS/rest/services/Elevation/World_Hillshade/MapServer/tile/{z}/{y}/{x}',
  { attribution: '© Esri', maxNativeZoom: 16, maxZoom: 20, pane: 'hillshade' }
);

// Apply sepia CSS filter to map tiles
const style = document.createElement('style');
style.textContent = '.leaflet-tile-pane { filter: sepia(15%) brightness(100%) contrast(100%); }';
document.head.appendChild(style);

basemaps.voyager.addTo(map);
let currentBasemap = 'voyager';

// Grave marker style
const graveIcon = L.divIcon({
  className: '',
  html: '<div style="width:12px;height:12px;background:#1a1a2e;border:2px solid #c8b89a;transform:rotate(45deg);"></div>',
  iconSize: [12, 12],
  iconAnchor: [6, 6]
});

// Graphics layers
gravesLayer = L.layerGroup().addTo(map);
lineageLayer = L.layerGroup().addTo(map);
labelsLayer = L.layerGroup().addTo(map);


// AUTH
async function checkAuth() {
  const { data: { session } } = await sb.auth.getSession();
  if (session) {
    setUser(session.user);
  } else {
    // Guest lands in the app read-only. Sign-in is available from the header button but not forced on arrival.
    currentUser = null;
    document.getElementById('auth-modal').classList.add('hidden');
    document.getElementById('login-btn').style.display = 'block';
    document.getElementById('user-indicator').style.display = 'none';
    updateBasemapAccess();
    loadGraves();
  }
}

// Basemaps that cost money per tile — hidden from guests so visitors can't spend the quota. This is a courtesy, not security: the token is still readable in app.js. Restrict it by URL in the Mapbox account.
const METERED_BASEMAPS = ['mapbox'];

function updateBasemapAccess() {
  METERED_BASEMAPS.forEach(key => {
    const opt = document.querySelector(`.bm-option[data-bm="${key}"]`);
    if (opt) opt.style.display = currentUser ? 'flex' : 'none';
  });
}

function setUser(user) {
  currentUser = user;
  document.getElementById('auth-modal').classList.add('hidden');
  document.getElementById('login-btn').style.display = 'none';
  document.getElementById('user-indicator').style.display = 'flex';
  document.getElementById('user-email-display').textContent = user.email;
  updateBasemapAccess();
  loadGraves();
}

function showAuthModal() {
  document.getElementById('auth-modal').classList.remove('hidden');
}

document.getElementById('auth-submit').addEventListener('click', async () => {
  const email = document.getElementById('auth-email').value.trim();
  const pwd = document.getElementById('auth-password').value;
  const errEl = document.getElementById('auth-error');
  errEl.style.display = 'none';
  const btn = document.getElementById('auth-submit');
  btn.disabled = true; btn.textContent = 'Signing in...';
  const { data, error } = await sb.auth.signInWithPassword({ email, password: pwd });
  btn.disabled = false; btn.textContent = 'Sign In';
  if (error) { errEl.textContent = error.message; errEl.style.display = 'block'; }
  else setUser(data.user);
});

document.getElementById('login-btn').addEventListener('click', showAuthModal);
document.getElementById('auth-close').addEventListener('click', () => {
  document.getElementById('auth-modal').classList.add('hidden');
});
document.getElementById('auth-guest').addEventListener('click', () => {
  document.getElementById('auth-modal').classList.add('hidden');
});
document.getElementById('auth-modal').addEventListener('click', (e) => {
  // Backdrop click dismisses; clicks inside the box do not.
  if (e.target.id === 'auth-modal') e.target.classList.add('hidden');
});
document.getElementById('logout-btn').addEventListener('click', async () => {
  await sb.auth.signOut();
  currentUser = null;
  document.getElementById('login-btn').style.display = 'block';
  document.getElementById('user-indicator').style.display = 'none';
  // Signing out while on a metered basemap — revert to the free default.
  if (METERED_BASEMAPS.includes(currentBasemap)) {
    map.removeLayer(basemaps[currentBasemap]);
    basemaps.voyager.addTo(map);
    currentBasemap = 'voyager';
    document.querySelectorAll('.bm-option').forEach(o =>
      o.classList.toggle('active', o.dataset.bm === 'voyager'));
  }
  updateBasemapAccess();
  document.getElementById('feature-panel').style.display = 'none';
  loadGraves();
});

// Load graves from Supabase and render them on the map and populate the cemetery dropdown for filtering.
async function loadGraves() {
  const { data, error } = await sb.rpc('get_graves_geojson');
  if (error) { console.error('Load graves failed:', error); return; }
  currentGraves = data || [];
  if (window.RRPicker) RRPicker.setSource(currentGraves);
  await loadPhotoIndex();
  renderGraves();
  populateCemeteryDropdown();
}

// Which graves have at least one photo. Used to flag photo-less records on
// the map so they can be caught while still on site.
async function loadPhotoIndex() {
  try {
    const { data } = await sb.from('attachments')
      .select('grave_id')
      .eq('file_type', 'photo');
    gravesWithPhotos = new Set((data || []).map(a => a.grave_id).filter(Boolean));
  } catch (e) {
    console.warn('[photos] index failed:', e.message);
  }
}

function renderGraves(filter) {
  gravesLayer.clearLayers();
  const graves = filter
    ? currentGraves.filter(g => g.person_name?.toLowerCase().includes(filter.toLowerCase()) || g.id === filter)
    : currentGraves;

  graves.forEach(g => {
    if (!g.location) return;
    const coords = parseLocation(g.location);
    if (!coords) return;
    const marker = createGraveMarker(g, coords);
    marker._graveRef = g;
    marker.addTo(gravesLayer);
  });
}

// ── Grave markers & labels ──
// One factory for both render paths so labels can't work in one and
// not the other.
function graveLabelText(g) {
  const name = (g.person_name || '').trim();
  const cem = (g.cemetery_name || '').trim();
  if (labelMode === 'cemetery') return cem || name;
  if (labelMode === 'both') {
    if (name && cem) return `${name}<span class="gt-cem">${cem}</span>`;
    return name || cem;
  }
  return name || cem;
}

function createGraveMarker(g, coords) {
  const icon = L.icon({
    iconUrl: 'grave.png',
    iconSize: [20, 28],
    iconAnchor: [10, 28],
    className: gravesWithPhotos.has(g.id) ? 'grave-marker' : 'grave-marker no-photo'
  });
  const marker = L.marker([coords.lat, coords.lng], { icon });
  const text = graveLabelText(g);
  if (text) {
    marker.bindTooltip(text, {
      permanent: labelsPermanent,
      direction: 'right',
      offset: [8, -12],
      className: 'grave-tooltip',
      opacity: 1
    });
  }
  marker.on('click', () => openFeaturePanel(g));
  return marker;
}

// Permanent tooltips below the zoom threshold would pile up, so hide
// them with a class rather than unbinding and rebinding every marker.
function updateLabelVisibility() {
  if (!map) return;
  const hide = labelsPermanent && map.getZoom() < labelZoomThreshold;
  document.getElementById('map').classList.toggle('labels-hidden', hide);
}

function refreshGraveLabels() {
  gravesLayer.eachLayer(layer => {
    if (!layer.getTooltip) return;
    const g = layer._graveRef;
    if (!g) return;
    layer.unbindTooltip();
    const text = graveLabelText(g);
    if (text) {
      layer.bindTooltip(text, {
        permanent: labelsPermanent,
        direction: 'right',
        offset: [8, -12],
        className: 'grave-tooltip',
        opacity: 1
      });
    }
  });
  updateLabelVisibility();
}

// fitBounds fits the coordinates, but markers are anchored at their base and
// draw 28px upward, and the floating button stack covers the right edge. On a
// phone that stack is ~14% of the viewport, so uniform padding pushes edge
// markers underneath it. Pad asymmetrically instead.
function fitToCoords(coords, opts) {
  if (!coords || coords.length === 0) return;
  if (coords.length === 1) {
    map.setView(coords[0], 14, Object.assign({ animate: true }, opts || {}));
    return;
  }
  const w = map.getSize().x;
  const narrow = w < 500;
  map.fitBounds(L.latLngBounds(coords), Object.assign({
    // top: clear the icon height + label. right: clear the button stack.
    paddingTopLeft: [narrow ? 30 : 50, 55],
    paddingBottomRight: [narrow ? 62 : 70, 45],
    animate: true
  }, opts || {}));
}

function parseLocation(loc) {
  if (!loc) return null;
  if (typeof loc === 'object' && loc.coordinates) {
    return { lat: loc.coordinates[1], lng: loc.coordinates[0] };
  }
  const match = String(loc).match(/POINT\(([^ ]+) ([^ )]+)\)/);
  if (match) return { lat: parseFloat(match[2]), lng: parseFloat(match[1]) };
  return null;
}

function populateCemeteryDropdown() {
  const select = document.getElementById('cemetery-select');
  const cemeteries = {};
  currentGraves.forEach(g => {
    if (g.cemetery_name && !cemeteries[g.cemetery_name]) {
      cemeteries[g.cemetery_name] = parseLocation(g.location);
    }
  });
  select.innerHTML = '<option value="">— Select a cemetery —</option>';
  Object.entries(cemeteries).sort().forEach(([name]) => {
    const opt = document.createElement('option');
    opt.value = name; opt.textContent = name;
    select.appendChild(opt);
  });
}

// ══════════════════════════════════════════
// BASEMAP
// ══════════════════════════════════════════
document.getElementById('basemap-btn').addEventListener('click', () => {
  const p = document.getElementById('basemap-panel');
  p.style.display = p.style.display === 'block' ? 'none' : 'block';
});

document.querySelectorAll('.bm-option').forEach(el => {
  el.addEventListener('click', () => {
    const bm = el.dataset.bm;
    if (bm === currentBasemap) { document.getElementById('basemap-panel').style.display = 'none'; return; }
    map.removeLayer(basemaps[currentBasemap]);
    basemaps[bm].addTo(map);
    currentBasemap = bm;
    document.querySelectorAll('.bm-option').forEach(o => o.classList.remove('active'));
    el.classList.add('active');
    document.getElementById('basemap-panel').style.display = 'none';
  });
});

// ══════════════════════════════════════════
// LOCATE
// ══════════════════════════════════════════
document.getElementById('locate-btn').addEventListener('click', () => {
  if (!navigator.geolocation) return;
  navigator.geolocation.getCurrentPosition(pos => {
    map.setView([pos.coords.latitude, pos.coords.longitude], 15);
  }, err => alert('Location unavailable: ' + err.message));
});

// ══════════════════════════════════════════
// PANEL HELPERS
// ══════════════════════════════════════════
function openPanel(id) {
  document.querySelectorAll('.panel').forEach(p => { p.classList.remove('open'); });
  document.getElementById('feature-panel').style.display = 'none';
  document.getElementById(id).classList.add('open');
}
function closePanel(id) { document.getElementById(id).classList.remove('open'); }
function closeAllPanels() {
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('open'));
  document.getElementById('feature-panel').style.display = 'none';
  hideNavPanel();
}

// Toolbar buttons
document.getElementById('btn-add').addEventListener('click', () => {
  if (!currentUser) { showAuthModal(); return; }
  resetAddPanel();
  openPanel('add-panel');
});
document.getElementById('btn-filter').addEventListener('click', () => openPanel('filter-panel'));
document.getElementById('btn-web').addEventListener('click', () => {
  buildFullWeb();
});
document.getElementById('display-btn').addEventListener('click', () => openPanel('layers-panel'));

// Close buttons
document.getElementById('add-close').addEventListener('click', () => { closePanel('add-panel'); resetAddPanel(); });
document.getElementById('filter-close').addEventListener('click', () => closePanel('filter-panel'));
document.getElementById('layers-close').addEventListener('click', () => closePanel('layers-panel'));
document.getElementById('fp-close').addEventListener('click', () => { document.getElementById('feature-panel').style.display = 'none'; });
document.getElementById('nav-close').addEventListener('click', hideNavPanel);
document.getElementById('nav-minimize').addEventListener('click', toggleNavMinimize);
document.getElementById('edit-close').addEventListener('click', () => closePanel('edit-panel'));
document.getElementById('edit-cancel').addEventListener('click', () => closePanel('edit-panel'));

// ── Extent button ──
document.getElementById('extent-btn').addEventListener('click', () => {
  if (currentGraves.length === 0) {
    map.setView([37.8, -85.3], 7, { animate: true });
    return;
  }
  const coords = currentGraves
    .map(g => parseLocation(g.location))
    .filter(Boolean)
    .map(c => [c.lat, c.lng]);
  if (coords.length === 1) {
    map.setView(coords[0], 14, { animate: true });
  } else if (coords.length > 1) {
    fitToCoords(coords);
  } else {
    map.setView([37.8, -85.3], 7, { animate: true });
  }
});

// Layer toggle
document.getElementById('toggle-hillshade').addEventListener('change', e => {
  if (e.target.checked) hillshadeLayer.addTo(map);
  else map.removeLayer(hillshadeLayer);
  try { localStorage.setItem('rr-hillshade', e.target.checked ? '1' : '0'); } catch (err) {}
});

try {
  if (localStorage.getItem('rr-hillshade') === '1') {
    document.getElementById('toggle-hillshade').checked = true;
    hillshadeLayer.addTo(map);
  }
} catch (e) { /* private mode */ }

document.getElementById('toggle-graves').addEventListener('change', e => {
  if (e.target.checked) gravesLayer.addTo(map);
  else map.removeLayer(gravesLayer);
});

// ══════════════════════════════════════════
// ADD GRAVE WORKFLOW
// ══════════════════════════════════════════

// One-time GPS tip
function showGpsTip() {
  if (localStorage.getItem('rr-gps-tip-dismissed')) return;
  document.getElementById('gps-tip').style.display = 'block';
}
window.dismissGpsTip = function() {
  localStorage.setItem('rr-gps-tip-dismissed', '1');
  document.getElementById('gps-tip').style.display = 'none';
};

// Compressed photo blob stored here between steps
let capturedPhotoBlob = null;
let capturedAudioBlob = null;
let mediaRecorder = null;
let audioChunks = [];
let recordingTimer = null;


// Image compression via canvas
async function compressImage(file, maxWidth = 1200, quality = 0.8) {
  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const scale = Math.min(1, maxWidth / img.width);
      canvas.width = img.width * scale;
      canvas.height = img.height * scale;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      canvas.toBlob(blob => resolve(blob), 'image/jpeg', quality);
    };
    img.src = url;
  });
}

function showStep(n) {
  ['step1-content','step2-content','step3-content'].forEach((id, i) => {
    document.getElementById(id).style.display = i + 1 === n ? 'block' : 'none';
  });
  ['s1','s2','s3','s4'].forEach((id, i) => {
    const el = document.getElementById(id);
    el.className = 'step' + (i + 1 < n ? ' done' : i + 1 === n ? ' active' : '');
  });
}

// Between graves in the same cemetery: keep the cemetery/county/state you're
// standing in, clear everything specific to the person. Location is NOT kept —
// reusing it would stack two graves on one coordinate.
function resetForNextGrave() {
  const cem = document.getElementById('g-cemetery').value;
  const county = document.getElementById('g-county').value;
  const state = document.getElementById('g-state').value;
  resetAddPanel();
  document.getElementById('g-cemetery').value = cem;
  document.getElementById('g-county').value = county;
  document.getElementById('g-state').value = state;
  showStatus('add-status',
    `✓ Saved. ${cem ? cem + ' — n' : 'N'}ext grave: take a photo, then set location.`, 'success');
}

function resetAddPanel() {
  placedPoint = null;
  capturedPhotoBlob = null;
  capturedAudioBlob = null;
  audioChunks = [];
  if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop();
  if (recordingTimer) { clearInterval(recordingTimer); recordingTimer = null; }
  if (mapClickHandler) { map.off('click', mapClickHandler); mapClickHandler = null; }
  document.getElementById('click-banner').style.display = 'none';
  document.getElementById('click-banner').textContent = 'Tap map to place grave location';
  document.getElementById('coord-display').textContent = '';
  document.getElementById('gps-status').textContent = '';
  document.getElementById('photo-exif-msg').textContent = '';
  document.getElementById('audio-msg').textContent = '';
  document.getElementById('photo-preview-wrap').style.display = 'none';
  document.getElementById('photo-capture-wrap').style.display = 'block';
  document.getElementById('step3-photo-thumb').style.display = 'none';
  document.getElementById('audio-record-wrap').style.display = 'block';
  document.getElementById('audio-recording-wrap').style.display = 'none';
  document.getElementById('audio-preview-wrap').style.display = 'none';
  document.getElementById('audio-timer').textContent = '0:00';
  document.getElementById('g-photo').value = '';
  ['g-name','g-dob','g-dod','g-cemetery','g-county','g-notes','g-marriage-date'].forEach(id => {
    document.getElementById(id).value = '';
  });
  // Picker fields hold a person id in a data attribute. Clearing .value
  // alone leaves that id attached, so the next record would inherit the
  // previous one's linked parent or spouse under a blank name.
  ['g-father','g-mother','g-spouse'].forEach(id => {
    const el = document.getElementById(id);
    if (window.RRPicker) RRPicker.set(el, '', null);
    else el.value = '';
  });
  document.getElementById('g-state').value = 'KY';
  document.getElementById('add-status').className = 'status';
  document.getElementById('save-grave').textContent = 'Save Record';
  document.getElementById('save-grave').disabled = false;
  document.getElementById('save-add-another').disabled = false;
  showStep(1);
}

// ── Step 1: Photo capture ──
document.getElementById('g-photo').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;

  const exifMsg = document.getElementById('photo-exif-msg');
  exifMsg.textContent = '⏳ Processing photo...';

  // Compress image
  capturedPhotoBlob = await compressImage(file);
  const origMB = (file.size / 1024 / 1024).toFixed(1);
  const compKB = (capturedPhotoBlob.size / 1024).toFixed(0);

  // Show preview
  const previewUrl = URL.createObjectURL(capturedPhotoBlob);
  document.getElementById('photo-preview').src = previewUrl;
  document.getElementById('photo-preview-wrap').style.display = 'block';
  document.getElementById('photo-capture-wrap').style.display = 'none';

  // Show in step 3 thumbnail
  document.getElementById('step3-thumb-img').src = previewUrl;
  document.getElementById('step3-photo-thumb').style.display = 'block';

  // Try EXIF GPS extraction
  try {
    const exif = await exifr.gps(file);
    if (exif && exif.latitude && exif.longitude) {
      placedPoint = L.latLng(exif.latitude, exif.longitude);
      document.getElementById('coord-display').textContent = `📍 ${exif.latitude.toFixed(5)}, ${exif.longitude.toFixed(5)}`;
      exifMsg.textContent = `✓ Location captured from photo · ${origMB}MB → ${compKB}KB`;
      map.setView([exif.latitude, exif.longitude], 16, { animate: true });
    } else {
      exifMsg.textContent = `📍 No GPS in photo — set location in next step · ${origMB}MB → ${compKB}KB`;
    }
  } catch (err) {
    exifMsg.textContent = `📍 No GPS in photo — set location in next step · ${origMB}MB → ${compKB}KB`;
  }

  // Show GPS tip once
  showGpsTip();
});

document.getElementById('retake-photo-btn').addEventListener('click', () => {
  capturedPhotoBlob = null;
  placedPoint = null;
  document.getElementById('photo-preview-wrap').style.display = 'none';
  document.getElementById('photo-capture-wrap').style.display = 'block';
  document.getElementById('photo-preview').src = '';
  document.getElementById('step3-photo-thumb').style.display = 'none';
  document.getElementById('photo-exif-msg').textContent = '';
  document.getElementById('coord-display').textContent = '';
  document.getElementById('g-photo').value = '';
});

// ── Step 1: Audio recording ──
const MAX_RECORDING_SECONDS = 120; // 2 minute limit

document.getElementById('audio-record-btn').addEventListener('click', async () => {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mimeType = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/mp4';
    mediaRecorder = new MediaRecorder(stream, { mimeType });
    audioChunks = [];

    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) audioChunks.push(e.data);
    };

    mediaRecorder.onstop = () => {
      stream.getTracks().forEach(t => t.stop());
      capturedAudioBlob = new Blob(audioChunks, { type: mimeType });
      const url = URL.createObjectURL(capturedAudioBlob);
      document.getElementById('audio-preview').src = url;
      document.getElementById('audio-preview-wrap').style.display = 'block';
      document.getElementById('audio-recording-wrap').style.display = 'none';
      const sizeKB = (capturedAudioBlob.size / 1024).toFixed(0);
      document.getElementById('audio-msg').textContent = `✓ Audio captured (${sizeKB}KB)`;
      clearInterval(recordingTimer);
    };

    mediaRecorder.start();

    // Show recording UI
    document.getElementById('audio-record-wrap').style.display = 'none';
    document.getElementById('audio-recording-wrap').style.display = 'block';

    // Timer
    let seconds = 0;
    recordingTimer = setInterval(() => {
      seconds++;
      const mins = Math.floor(seconds / 60);
      const secs = seconds % 60;
      document.getElementById('audio-timer').textContent = `${mins}:${secs.toString().padStart(2, '0')}`;
      if (seconds >= MAX_RECORDING_SECONDS) {
        mediaRecorder.stop();
        clearInterval(recordingTimer);
        document.getElementById('audio-msg').textContent = '⏱ Maximum recording length reached (2 min)';
      }
    }, 1000);

  } catch (err) {
    document.getElementById('audio-msg').textContent = '❌ Microphone access denied — check browser permissions';
  }
});

document.getElementById('audio-stop-btn').addEventListener('click', () => {
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.stop();
    clearInterval(recordingTimer);
  }
});

document.getElementById('audio-rerecord-btn').addEventListener('click', () => {
  capturedAudioBlob = null;
  audioChunks = [];
  document.getElementById('audio-preview-wrap').style.display = 'none';
  document.getElementById('audio-record-wrap').style.display = 'block';
  document.getElementById('audio-preview').src = '';
  document.getElementById('audio-msg').textContent = '';
  document.getElementById('audio-timer').textContent = '0:00';
});

document.getElementById('step1-next').addEventListener('click', async () => {
  await populateCemeteryDropdown();
  showStep(2);
  if (!placedPoint) {
    document.getElementById('click-banner').style.display = 'block';
    startMapClick();
  }
});

document.getElementById('step1-skip').addEventListener('click', async () => {
  capturedPhotoBlob = null;
  await populateCemeteryDropdown();
  showStep(2);
  document.getElementById('click-banner').style.display = 'block';
  startMapClick();
});

// ── Step 2: Location ──
document.getElementById('gps-locate-btn').addEventListener('click', () => {
  const statusEl = document.getElementById('gps-status');
  statusEl.textContent = '⏳ Getting GPS location...';
  if (!navigator.geolocation) {
    statusEl.textContent = '❌ GPS not available on this device';
    return;
  }
  navigator.geolocation.getCurrentPosition(pos => {
    placedPoint = L.latLng(pos.coords.latitude, pos.coords.longitude);
    document.getElementById('coord-display').textContent = `📍 ${placedPoint.lat.toFixed(5)}, ${placedPoint.lng.toFixed(5)}`;
    statusEl.textContent = `✓ GPS location captured (±${Math.round(pos.coords.accuracy)}m accuracy)`;
    map.setView([placedPoint.lat, placedPoint.lng], 17, { animate: true });
    if (mapClickHandler) { map.off('click', mapClickHandler); mapClickHandler = null; }
    document.getElementById('click-banner').style.display = 'none';
  }, err => {
    statusEl.textContent = `❌ Location denied — tap map to place manually`;
    document.getElementById('click-banner').style.display = 'block';
    startMapClick();
  }, { enableHighAccuracy: true, timeout: 10000 });
});

document.getElementById('step2-next').addEventListener('click', () => {
  if (!placedPoint) {
    document.getElementById('gps-status').textContent = '❌ Location required — use GPS or tap the map';
    return;
  }
  if (mapClickHandler) { map.off('click', mapClickHandler); mapClickHandler = null; }
  document.getElementById('click-banner').style.display = 'none';
  showStep(3);
});

document.getElementById('step2-back').addEventListener('click', () => {
  if (mapClickHandler) { map.off('click', mapClickHandler); mapClickHandler = null; }
  document.getElementById('click-banner').style.display = 'none';
  showStep(1);
});

document.getElementById('step3-back').addEventListener('click', () => {
  showStep(2);
  if (!placedPoint) {
    document.getElementById('click-banner').style.display = 'block';
    startMapClick();
  }
});

function startMapClick() {
  if (mapClickHandler) map.off('click', mapClickHandler);
  mapClickHandler = (e) => {
    placedPoint = e.latlng;
    document.getElementById('coord-display').textContent = `📍 ${placedPoint.lat.toFixed(5)}, ${placedPoint.lng.toFixed(5)}`;
    document.getElementById('click-banner').style.display = 'none';
    document.getElementById('gps-status').textContent = '📍 Location set from map tap';
    map.off('click', mapClickHandler); mapClickHandler = null;
  };
  map.on('click', mapClickHandler);
}

// Cemetery dropdown auto-fill
document.getElementById('cemetery-select').addEventListener('change', (e) => {
  const name = e.target.value;
  if (!name) return;
  const grave = currentGraves.find(g => g.cemetery_name === name);
  if (!grave) return;
  const coords = parseLocation(grave.location);
  if (coords) {
    placedPoint = L.latLng(coords.lat, coords.lng);
    document.getElementById('coord-display').textContent = `📍 ${coords.lat.toFixed(5)}, ${coords.lng.toFixed(5)}`;
    document.getElementById('click-banner').style.display = 'none';
    document.getElementById('gps-status').textContent = `📍 Location set from ${name}`;
    if (mapClickHandler) { map.off('click', mapClickHandler); mapClickHandler = null; }
    map.setView([coords.lat, coords.lng], 16, { animate: true, duration: 1.2 });
    document.getElementById('g-cemetery').value = name;
    document.getElementById('g-county').value = grave.county || '';
    document.getElementById('g-state').value = grave.state || 'KY';
  }
});

// Save grave
let addAnotherMode = false;

async function handleSaveGrave() {
  if (!placedPoint) { showStatus('add-status', 'No location set. Go back and tap the map.', 'error'); return; }
  const name = document.getElementById('g-name').value.trim();
  if (!name) { showStatus('add-status', 'Person name is required.', 'error'); return; }

  const btn = document.getElementById('save-grave');
  const btnAnother = document.getElementById('save-add-another');
  btn.disabled = true; btn.textContent = 'Saving...';
  btnAnother.disabled = true;

  // Build the record payload
  const recordPayload = {
    name,
    dob: document.getElementById('g-dob').value || null,
    dod: document.getElementById('g-dod').value || null,
    father: document.getElementById('g-father').value.trim() || null,
    mother: document.getElementById('g-mother').value.trim() || null,
    father_id: RRPicker.value(document.getElementById('g-father')).id,
    mother_id: RRPicker.value(document.getElementById('g-mother')).id,
    // Spouse rides along in the payload so an offline capture keeps it and
    // syncPendingRecords can write the marriage row when the queue drains.
    spouse: document.getElementById('g-spouse').value.trim() || null,
    spouse_id: RRPicker.value(document.getElementById('g-spouse')).id,
    marriage_date: document.getElementById('g-marriage-date').value.trim() || null,
    cemetery_name: document.getElementById('g-cemetery').value.trim() || null,
    county: document.getElementById('g-county').value.trim() || null,
    state: document.getElementById('g-state').value.trim() || null,
    description: document.getElementById('g-notes').value.trim() || null,
    lat: placedPoint.lat,
    lng: placedPoint.lng
  };

  // ── OFFLINE: queue to IndexedDB ──
  if (!navigator.onLine) {
    try {
      await window.RRDb.queueRecord(recordPayload, capturedPhotoBlob, capturedAudioBlob);
      const count = await window.RRDb.getPendingCount();
      showStatus('add-status', `📴 Saved offline — ${count} record${count === 1 ? '' : 's'} queued for sync`, 'info');
      btn.textContent = 'Queued!';
      updateSyncBadge();
      if (addAnotherMode) {
        const cemNow = document.getElementById('g-cemetery').value;
        resetAddPanel();
        document.getElementById('g-cemetery').value = cemNow;
        document.getElementById('g-county').value = recordPayload.county || '';
        document.getElementById('g-state').value = recordPayload.state || 'KY';
        showStatus('add-status',
          `📴 Queued (${count} pending). Next grave: take a photo, then set location.`, 'info');
      } else {
        setTimeout(() => { closePanel('add-panel'); resetAddPanel(); }, 2000);
      }
      return;
    } catch (err) {
      showStatus('add-status', `Offline save failed: ${err.message}`, 'error');
      btn.disabled = false; btn.textContent = 'Save Record';
      btnAnother.disabled = false;
      return;
    }
  }

  try {
    // 1. Create person record
    const personData = {
      name: recordPayload.name,
      dob: recordPayload.dob,
      dod: recordPayload.dod,
      father: recordPayload.father,
      mother: recordPayload.mother,
      // Linked ids when the parent has a record; null when the name is
      // only known as text.
      father_id: recordPayload.father_id || null,
      mother_id: recordPayload.mother_id || null,
    };
    const { data: person, error: pErr } = await sb.from('persons').insert(personData).select().single();
    if (pErr) throw pErr;

    // 2. Create grave record
    const graveData = {
      person_id: person.id,
      person_name: name,
      dob: personData.dob,
      dod: personData.dod,
      father: personData.father,
      mother: personData.mother,
      cemetery_name: document.getElementById('g-cemetery').value.trim() || null,
      county: document.getElementById('g-county').value.trim() || null,
      state: document.getElementById('g-state').value.trim() || null,
      description: document.getElementById('g-notes').value.trim() || null,
      location: `POINT(${placedPoint.lng} ${placedPoint.lat})`
    };
    const { data: grave, error: gErr } = await sb.from('graves').insert(graveData).select().single();
    if (gErr) throw gErr;

    // 2b. Marriage, if a spouse was entered. A failure here must not lose
    // the grave that is already saved, so it is noted and carried past.
    let marriageNote = '';
    if (window.RRMarriage && (recordPayload.spouse || recordPayload.spouse_id)) {
      try {
        await RRMarriage.add(sb, person.id, {
          id: recordPayload.spouse_id,
          name: recordPayload.spouse,
          marriage_date: recordPayload.marriage_date
        });
      } catch (mErr) {
        console.warn('Marriage save failed:', mErr);
        marriageNote = ` — marriage not saved: ${mErr.message}`;
      }
    }

    // 3. Upload compressed photo if captured
    if (capturedPhotoBlob) {
      try {
        const path = `photos/${grave.id}/${Date.now()}_headstone.jpg`;
        const { error: upErr } = await sb.storage.from('graves-media').upload(path, capturedPhotoBlob, {
          contentType: 'image/jpeg'
        });
        if (!upErr) {
          await sb.from('attachments').insert({
            grave_id: grave.id, person_id: person.id,
            file_name: 'headstone.jpg', file_path: path,
            file_type: 'photo', file_size: capturedPhotoBlob.size,
            mime_type: 'image/jpeg'
          });
        }
      } catch (upErr) {
        console.warn('Photo upload failed:', upErr);
      }
    }

    // 4. Upload audio note if recorded
    if (capturedAudioBlob) {
      try {
        const ext = capturedAudioBlob.type.includes('webm') ? 'webm' : 'mp4';
        const audioPath = `audio/${grave.id}/${Date.now()}_note.${ext}`;
        const { error: audErr } = await sb.storage.from('graves-media').upload(audioPath, capturedAudioBlob, {
          contentType: capturedAudioBlob.type
        });
        if (!audErr) {
          await sb.from('attachments').insert({
            grave_id: grave.id, person_id: person.id,
            file_name: `note.${ext}`, file_path: audioPath,
            file_type: 'audio', file_size: capturedAudioBlob.size,
            mime_type: capturedAudioBlob.type
          });
        }
      } catch (audErr) {
        console.warn('Audio upload failed:', audErr);
      }
    }
    btn.textContent = 'Saved!';
    await loadGraves();
    if (addAnotherMode) {
      resetForNextGrave();
      // resetForNextGrave writes its own success line, so the marriage
      // warning has to be re-stated after it or it would be swallowed.
      if (marriageNote) showStatus('add-status', `Grave saved${marriageNote}`, 'error');
    } else {
      if (marriageNote) showStatus('add-status', `Grave saved${marriageNote}`, 'error');
      setTimeout(() => { closePanel('add-panel'); resetAddPanel(); }, 1800);
    }

  } catch (err) {
    console.error(err);
    showStatus('add-status', `Save failed: ${err.message}`, 'error');
    btn.disabled = false; btn.textContent = 'Save Record';
    btnAnother.disabled = false;
  }
}

document.getElementById('save-grave').addEventListener('click', () => {
  addAnotherMode = false;
  handleSaveGrave();
});
document.getElementById('save-add-another').addEventListener('click', () => {
  addAnotherMode = true;
  handleSaveGrave();
});

// ══════════════════════════════════════════
// NAVIGATION
// ══════════════════════════════════════════
function hideNavPanel() {
  document.getElementById('nav-panel').classList.remove('open');
  document.getElementById('nav-panel').classList.remove('minimized');
  document.getElementById('nav-offroad').classList.remove('show');
  if (window.RRRoute) RRRoute.clear();
}

function toggleNavMinimize() {
  const panel = document.getElementById('nav-panel');
  const btn = document.getElementById('nav-minimize');
  const minimized = panel.classList.toggle('minimized');
  btn.textContent = minimized ? '⌃' : '⌄';
  btn.title = minimized ? 'Expand directions' : 'Minimize — show whole route';
  // Collapsing frees up the screen, so refit to the whole route.
  if (minimized && window.RRRoute) {
    setTimeout(() => RRRoute.fitRoute(), 60);
  }
}

function showNavStatus(msg) {
  const panel = document.getElementById('nav-panel');
  document.getElementById('nav-summary').textContent = msg;
  document.getElementById('nav-offroad').classList.remove('show');
  document.getElementById('nav-steps').innerHTML = '';
  panel.classList.remove('minimized');
  document.getElementById('nav-minimize').textContent = '⌄';
  panel.classList.add('open');
}

function renderNavResult(result, destName) {
  const summary = document.getElementById('nav-summary');
  const offroad = document.getElementById('nav-offroad');
  const steps = document.getElementById('nav-steps');

  if (result.mode === 'offroad') {
    summary.textContent = 'Bearing only — ' + (destName || 'grave');
  } else {
    summary.textContent = RRRoute.formatDistance(result.distance) +
      ' · ' + RRRoute.formatDuration(result.duration);
  }

  if (result.offroad) {
    const o = result.offroad;
    offroad.innerHTML =
      '<strong>Last stretch on foot — no mapped road.</strong><br>' +
      'Head <strong>' + o.compass + '</strong> (' + Math.round(o.bearing) +
      '°) for <strong>' + RRRoute.formatFeet(o.distance) + '</strong>.' +
      (result.note ? '<br><span style="opacity:0.8;">' + result.note + '</span>' : '');
    offroad.classList.add('show');
    document.getElementById('nav-walk-btn').classList.add('show');
  } else {
    offroad.classList.remove('show');
    document.getElementById('nav-walk-btn').classList.remove('show');
  }

  steps.innerHTML = (result.steps || []).map(s =>
    '<div class="nav-step">' +
      '<div>' + s.instruction + '</div>' +
      '<div class="nav-step-dist">' + RRRoute.formatDistance(s.distance) + '</div>' +
    '</div>'
  ).join('');
}

let lastNavDest = null;

function startNavigation(grave, coords) {
  const btn = document.getElementById('fp-navigate');
  lastNavDest = coords ? { lat: coords.lat, lng: coords.lng, name: grave.person_name } : null;
  if (!coords) {
    showNavStatus('This record has no location.');
    return;
  }
  btn.disabled = true;
  RRRoute.navigateTo(
    { lat: coords.lat, lng: coords.lng, name: grave.person_name },
    {
      onStatus: (msg) => showNavStatus(msg),
      onResult: (result) => {
        btn.disabled = false;
        renderNavResult(result, grave.person_name);
      },
      onError: (msg) => {
        btn.disabled = false;
        showNavStatus(msg);
      }
    }
  );
}

// ══════════════════════════════════════════
// PHOTO GALLERY
// ══════════════════════════════════════════
let currentPhotos = [];
let currentPhotoIndex = 0;

function showPhotoAt(i) {
  if (!currentPhotos[i]) return;
  currentPhotoIndex = i;
  document.getElementById('fp-photo').src = currentPhotos[i].url;
  document.querySelectorAll('.fp-thumb').forEach(t => {
    t.classList.toggle('active', parseInt(t.dataset.i, 10) === i);
  });
}

function openLightbox(i) {
  if (!currentPhotos.length) return;
  currentPhotoIndex = i;
  renderLightbox();
  document.getElementById('photo-lightbox').classList.remove('hidden');
}

function closeLightbox() {
  document.getElementById('photo-lightbox').classList.add('hidden');
}

function renderLightbox() {
  const p = currentPhotos[currentPhotoIndex];
  if (!p) return;
  document.getElementById('lb-image').src = p.url;
  const multi = currentPhotos.length > 1;
  document.getElementById('lb-caption').textContent =
    multi ? `${p.name} — ${currentPhotoIndex + 1} of ${currentPhotos.length}` : p.name;
  document.getElementById('lb-prev').style.display = multi ? 'flex' : 'none';
  document.getElementById('lb-next').style.display = multi ? 'flex' : 'none';
}

function stepPhoto(delta) {
  if (!currentPhotos.length) return;
  currentPhotoIndex = (currentPhotoIndex + delta + currentPhotos.length) % currentPhotos.length;
  renderLightbox();
  showPhotoAt(currentPhotoIndex);
}

document.getElementById('fp-photo').addEventListener('click', () => openLightbox(currentPhotoIndex));
document.getElementById('lb-close').addEventListener('click', closeLightbox);
document.getElementById('lb-prev').addEventListener('click', () => stepPhoto(-1));
document.getElementById('lb-next').addEventListener('click', () => stepPhoto(1));
document.getElementById('photo-lightbox').addEventListener('click', (e) => {
  if (e.target.id === 'photo-lightbox') closeLightbox();
});
document.addEventListener('keydown', (e) => {
  if (document.getElementById('photo-lightbox').classList.contains('hidden')) return;
  if (e.key === 'Escape') closeLightbox();
  if (e.key === 'ArrowLeft') stepPhoto(-1);
  if (e.key === 'ArrowRight') stepPhoto(1);
});

// ══════════════════════════════════════════
// FEATURE PANEL
// ══════════════════════════════════════════
// The panel is position:fixed with no offsets in CSS — position is owned
// entirely by JS. Without this it falls back to its static flow position,
// which on a phone can be below the fold, so the panel appears to vanish.
// Also clamps a dragged panel back into view after rotation or resize.
function positionFeaturePanel(keepExisting) {
  const panel = document.getElementById('feature-panel');
  if (panel.style.display !== 'block') return;

  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const w = panel.offsetWidth || 260;
  const h = panel.offsetHeight || 320;

  const cs = getComputedStyle(document.documentElement);
  const safeTop = parseInt(cs.getPropertyValue('--safe-top')) || 0;
  const headerH = 48 + safeTop;
  const minTop = headerH + 8;

  let left = parseInt(panel.style.left);
  let top = parseInt(panel.style.top);

  // No position yet, or we're re-opening: start from a sane default.
  if (!keepExisting || isNaN(left) || isNaN(top)) {
    left = 12;
    top = minTop + 4;
  }

  // Clamp so the panel is always reachable, however it got here.
  const maxLeft = Math.max(8, vw - w - 8);
  const maxTop = Math.max(minTop, vh - Math.min(h, 160) - 8);
  panel.style.left = Math.min(Math.max(left, 8), maxLeft) + 'px';
  panel.style.top = Math.min(Math.max(top, minTop), maxTop) + 'px';
}

// Rotation and resize change the viewport; a panel positioned for the old
// one can land off-screen.
window.addEventListener('resize', () => positionFeaturePanel(true));
window.addEventListener('orientationchange', () => {
  setTimeout(() => positionFeaturePanel(true), 250);
});

async function openFeaturePanel(grave) {
  closeAllPanels();
  editingGrave = grave;
  // Guests see Trace and Navigate only — write actions are hidden by CSS.
  document.getElementById('feature-panel').classList.toggle('guest', !currentUser);
  document.getElementById('fp-title').textContent = `⚰ ${grave.person_name || 'Unknown'}`;

  const fields = [
    ['Date of Birth', grave.dob ? new Date(grave.dob).toLocaleDateString() : null],
    ['Date of Death', grave.dod ? new Date(grave.dod).toLocaleDateString() : null],
    ['Father', grave.father],
    ['Mother', grave.mother],
    ['Cemetery', grave.cemetery_name],
    ['County', grave.county],
    ['State', grave.state],
    ['Notes', grave.description],
  ];

  document.getElementById('fp-body').innerHTML = fields
    .filter(([, v]) => v)
    .map(([l, v]) => `
      <div class="fp-field">
        <div class="fp-field-label">${l}</div>
        <div class="fp-field-value">${v}</div>
      </div>`)
    .join('') || '<p style="color:var(--brown);font-size:12px;">No details recorded.</p>';

  // Spouses. Read from BOTH sides of the marriages table — a marriage
  // entered from the spouse's record sits in person_b_id and would be
  // invisible here if only person_a_id were queried.
  if (grave.person_id && window.RRMarriage && navigator.onLine) {
    RRMarriage.load(sb, grave.person_id).then(ms => {
      // The panel may have been closed or moved on while this was in flight.
      if (!ms.length || editingGrave !== grave) return;
      const body = document.getElementById('fp-body');
      const placeholder = body.querySelector('p');
      if (placeholder) placeholder.remove();
      const block = document.createElement('div');
      block.className = 'fp-field';
      const label = document.createElement('div');
      label.className = 'fp-field-label';
      label.textContent = ms.length > 1 ? 'Spouses' : 'Spouse';
      block.appendChild(label);
      ms.forEach(m => {
        const v = document.createElement('div');
        v.className = 'fp-field-value';
        // textContent, not innerHTML — these are names typed by a user.
        v.textContent = RRMarriage.summarize(m) + (m.linked ? '' : ' · name only');
        block.appendChild(v);
      });
      body.appendChild(block);
    }).catch(e => console.warn('Marriage load failed:', e));
  }

  // Load photo and audio
  const photoEl = document.getElementById('fp-photo');
  photoEl.style.display = 'none';
  currentPhotos = [];
  currentPhotoIndex = 0;
  document.getElementById('fp-thumbs').style.display = 'none';
  document.getElementById('fp-thumbs').innerHTML = '';
  document.getElementById('fp-audio').style.display = 'none';
  document.getElementById('fp-docs').style.display = 'none';
  document.getElementById('fp-docs-list').innerHTML = '';

  const { data: atts } = await sb.from('attachments').select('*').eq('grave_id', grave.id);
  if (atts && atts.length > 0) {
    // Photos — all of them, oldest first
    const photos = atts
      .filter(a => a.file_type === 'photo')
      .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    if (photos.length > 0) {
      const signed = await Promise.all(photos.map(async p => {
        const { data } = await sb.storage.from('graves-media').createSignedUrl(p.file_path, 3600);
        return data?.signedUrl ? { url: data.signedUrl, name: p.file_name } : null;
      }));
      currentPhotos = signed.filter(Boolean);
      if (currentPhotos.length > 0) {
        showPhotoAt(0);
        photoEl.style.display = 'block';
        const thumbs = document.getElementById('fp-thumbs');
        if (currentPhotos.length > 1) {
          thumbs.innerHTML = currentPhotos.map((p, i) =>
            `<img class="fp-thumb${i === 0 ? ' active' : ''}" data-i="${i}" src="${p.url}" alt=""/>`
          ).join('');
          thumbs.querySelectorAll('.fp-thumb').forEach(t => {
            t.addEventListener('click', () => showPhotoAt(parseInt(t.dataset.i, 10)));
          });
          thumbs.style.display = 'flex';
        }
      }
    }
    // Audio
    const audio = atts.find(a => a.file_type === 'audio');
    if (audio) {
      const { data: audioSigned } = await sb.storage.from('graves-media').createSignedUrl(audio.file_path, 3600);
      if (audioSigned?.signedUrl) {
        document.getElementById('fp-audio-player').src = audioSigned.signedUrl;
        document.getElementById('fp-audio').style.display = 'block';
      }
    }
    // Documents — anything that isn't a photo or an audio note
    const docs = atts.filter(a => a.file_type !== 'photo' && a.file_type !== 'audio');
    if (docs.length > 0) {
      const links = await Promise.all(docs.map(async d => {
        const { data: sig } = await sb.storage.from('graves-media').createSignedUrl(d.file_path, 3600);
        if (!sig?.signedUrl) return '';
        const icon = (d.mime_type || '').includes('pdf') ? '📄' : '📎';
        const kb = d.file_size ? `<span class="fp-doc-size">${Math.round(d.file_size / 1024)} KB</span>` : '';
        return `<a class="fp-doc" href="${sig.signedUrl}" target="_blank" rel="noopener">${icon} ${d.file_name}${kb}</a>`;
      }));
      const rendered = links.filter(Boolean).join('');
      if (rendered) {
        document.getElementById('fp-docs-list').innerHTML = rendered;
        document.getElementById('fp-docs').style.display = 'block';
      }
    }
  }

  document.getElementById('feature-panel').style.display = 'block';
  positionFeaturePanel();

  // Zoom to grave
  const coords = parseLocation(grave.location);
  if (coords) map.setView([coords.lat, coords.lng], 15, { animate: true, duration: 1 });

  // Action buttons
  document.getElementById('fp-trace').onclick = () => {
    openPanel('filter-panel');
    runTrace(grave.person_name, grave.person_id);
  };
  document.getElementById('fp-edit').onclick = () => openEditPanel(grave);
  document.getElementById('fp-move').onclick = () => startMoveMode(grave);
  document.getElementById('fp-delete').onclick = () => deleteGrave(grave);
  document.getElementById('fp-navigate').onclick = () => startNavigation(grave, coords);
  document.getElementById('fp-relate').onclick = () => showRelationship(grave);
}

// ══════════════════════════════════════════
// EDIT PANEL
// ══════════════════════════════════════════
function openEditPanel(grave) {
  if (!currentUser) { showAuthModal(); return; }
  document.getElementById('feature-panel').style.display = 'none';
  editingGrave = grave;
  const fieldDefs = [
    { id: 'ep-name', label: 'Person Name', field: 'person_name', type: 'text' },
    { id: 'ep-dob', label: 'Date of Birth', field: 'dob', type: 'date' },
    { id: 'ep-dod', label: 'Date of Death', field: 'dod', type: 'date' },
    { id: 'ep-father', label: 'Father', field: 'father', type: 'text' },
    { id: 'ep-mother', label: 'Mother', field: 'mother', type: 'text' },
    { id: 'ep-cemetery', label: 'Cemetery', field: 'cemetery_name', type: 'text' },
    { id: 'ep-county', label: 'County', field: 'county', type: 'text' },
    { id: 'ep-state', label: 'State', field: 'state', type: 'text' },
    { id: 'ep-notes', label: 'Notes', field: 'description', type: 'textarea' },
  ];

  const container = document.getElementById('edit-fields');
  container.innerHTML = '';
  fieldDefs.forEach(def => {
    const label = document.createElement('label');
    label.className = 'rr-label'; label.textContent = def.label;
    container.appendChild(label);
    const val = grave[def.field] || '';
    if (def.type === 'textarea') {
      const ta = document.createElement('textarea');
      ta.id = def.id; ta.className = 'rr-input'; ta.value = val;
      container.appendChild(ta);
    } else if (def.type === 'date') {
      const inp = document.createElement('input');
      inp.type = 'text'; inp.id = def.id; inp.className = 'rr-input';
      inp.placeholder = 'YYYY-MM-DD';
      if (val) { try { inp.value = new Date(val).toISOString().split('T')[0]; } catch(e) {} }
      container.appendChild(inp);
    } else {
      const inp = document.createElement('input');
      inp.type = 'text'; inp.id = def.id; inp.className = 'rr-input'; inp.value = val;
      container.appendChild(inp);
    }
  });

  // Parent pickers. Fields are rebuilt each time the panel opens, so these
  // attach after construction. Existing links are loaded from persons —
  // graves only carries the parent names as text.
  if (window.RRPicker) {
    const fatherInput = document.getElementById('ep-father');
    const motherInput = document.getElementById('ep-mother');
    RRPicker.attach(fatherInput, { excludeId: grave.person_id });
    RRPicker.attach(motherInput, { excludeId: grave.person_id });
    if (grave.person_id) {
      sb.from('persons').select('father_id, mother_id').eq('id', grave.person_id).single()
        .then(({ data }) => {
          if (!data) return;
          RRPicker.set(fatherInput, fatherInput.value, data.father_id);
          RRPicker.set(motherInput, motherInput.value, data.mother_id);
        });
    }
  }

  // Marriages and attachments both save on their own, independently of
  // the panel's Save Changes button.
  renderEditMarriages(grave);
  loadEditAttachments(grave.id);
  document.getElementById('edit-status').className = 'status';
  document.getElementById('edit-save').textContent = 'Save Changes';
  document.getElementById('edit-save').disabled = false;
  openPanel('edit-panel');
}

// ══════════════════════════════════════════
// MARRIAGES — EDIT PANEL
// ══════════════════════════════════════════
// Each marriage is its own row in its own table, so these save and delete
// immediately rather than waiting on the panel's Save Changes button —
// the same model the attachment list already uses. Mixing the two would
// leave the panel half-saved whenever one half failed.

let marriageRowSeq = 0;

function marriageStatus(msg, type) {
  const el = document.getElementById('edit-marriage-status');
  el.textContent = msg || '';
  el.style.color = type === 'error' ? 'var(--red)' : 'var(--brown)';
}

const MARRIAGE_REASONS = [
  ['', 'Not recorded'],
  ['death', 'Ended in death'],
  ['divorce', 'Divorced'],
  ['unknown', 'Ended — cause unknown']
];

async function renderEditMarriages(grave) {
  const container = document.getElementById('edit-marriages');
  const addBtn = document.getElementById('edit-add-marriage');
  container.innerHTML = '';
  marriageStatus('');

  if (!grave.person_id) {
    const msg = document.createElement('div');
    msg.style.cssText = 'font-size:11px;color:var(--brown);';
    msg.textContent = 'This grave has no linked person record, so a marriage cannot be attached to it.';
    container.appendChild(msg);
    addBtn.style.display = 'none';
    return;
  }

  if (!navigator.onLine) {
    const msg = document.createElement('div');
    msg.style.cssText = 'font-size:11px;color:var(--brown);';
    msg.textContent = 'Offline — marriages cannot be loaded or edited.';
    container.appendChild(msg);
    addBtn.style.display = 'none';
    return;
  }
  addBtn.style.display = 'block';

  let list = [];
  try {
    list = await RRMarriage.load(sb, grave.person_id);
  } catch (e) {
    marriageStatus('Could not load marriages: ' + e.message, 'error');
    return;
  }

  if (!list.length) {
    const none = document.createElement('div');
    none.style.cssText = 'font-size:11px;color:var(--brown);';
    none.textContent = 'No marriages recorded.';
    container.appendChild(none);
  }
  list.forEach(m => container.appendChild(buildMarriageRow(grave, m)));
}

function buildMarriageRow(grave, m) {
  const uid = 'mr' + (++marriageRowSeq);
  const row = document.createElement('div');
  row.style.cssText = 'border:1px solid var(--sepia);border-radius:4px;padding:8px;margin-bottom:8px;background:#fdfaf3;';

  function label(text) {
    const l = document.createElement('label');
    l.className = 'rr-label';
    l.textContent = text;
    return l;
  }

  function textField(id, placeholder, value) {
    const i = document.createElement('input');
    i.type = 'text'; i.id = id; i.className = 'rr-input';
    i.placeholder = placeholder;
    i.value = value || '';
    return i;
  }

  row.appendChild(label('Spouse'));

  let spouseInput = null;
  if (m && m.side === 'b') {
    // This marriage was entered from the spouse's record, so the spouse
    // here is the row's person_a. Changing it would mean rewriting which
    // record owns the row — a delete and recreate, not an edit.
    const fixed = document.createElement('div');
    fixed.style.cssText = 'font-size:13px;color:var(--dark-brown);padding:4px 0;';
    fixed.textContent = m.spouseName || 'Unnamed spouse';
    row.appendChild(fixed);
    const note = document.createElement('div');
    note.style.cssText = 'font-size:10px;color:var(--brown);margin-bottom:6px;line-height:1.4;';
    note.textContent = 'Entered from their record. Dates and outcome are editable here; the spouse is not.';
    row.appendChild(note);
  } else {
    spouseInput = textField(uid + '-spouse', "Spouse's full name", m ? m.spouseName : '');
    row.appendChild(spouseInput);
    if (window.RRPicker) {
      RRPicker.attach(spouseInput, { excludeId: grave.person_id });
      RRPicker.set(spouseInput, m ? (m.spouseName || '') : '', m ? m.spouseId : null);
    }
  }

  const dates = document.createElement('div');
  dates.style.cssText = 'display:flex;gap:8px;';
  const mCol = document.createElement('div');
  mCol.style.cssText = 'flex:1;';
  mCol.appendChild(label('Married'));
  const mDate = textField(uid + '-mdate', 'YYYY-MM-DD', m ? m.marriage_date : '');
  mCol.appendChild(mDate);
  const eCol = document.createElement('div');
  eCol.style.cssText = 'flex:1;';
  eCol.appendChild(label('Ended'));
  const eDate = textField(uid + '-edate', 'YYYY-MM-DD', m ? m.end_date : '');
  eCol.appendChild(eDate);
  dates.appendChild(mCol);
  dates.appendChild(eCol);
  row.appendChild(dates);

  row.appendChild(label('Outcome'));
  const reason = document.createElement('select');
  reason.id = uid + '-reason';
  reason.className = 'rr-input';
  MARRIAGE_REASONS.forEach(([val, text]) => {
    const o = document.createElement('option');
    o.value = val; o.textContent = text;
    reason.appendChild(o);
  });
  // Blank means nobody has looked. 'unknown' means someone looked and
  // could not tell. Those are different research states, so they are
  // separate options rather than one silence.
  reason.value = (m && m.end_reason) || '';
  row.appendChild(reason);

  row.appendChild(label('Notes'));
  const notes = textField(uid + '-notes', 'Source, uncertainty, anything worth keeping', m ? m.notes : '');
  row.appendChild(notes);

  const btns = document.createElement('div');
  btns.style.cssText = 'display:flex;gap:8px;margin-top:8px;';

  const saveBtn = document.createElement('button');
  saveBtn.className = 'rr-btn';
  saveBtn.style.cssText = 'flex:2;margin-top:0;';
  saveBtn.textContent = m ? 'Save marriage' : 'Add marriage';
  saveBtn.addEventListener('click', async () => {
    const picked = spouseInput && window.RRPicker
      ? RRPicker.value(spouseInput)
      : { name: spouseInput ? spouseInput.value.trim() : null, id: null };

    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving…';
    try {
      if (m) {
        const fields = {
          marriage_date: mDate.value.trim() || null,
          end_date: eDate.value.trim() || null,
          end_reason: reason.value || null,
          notes: notes.value.trim() || null
        };
        // Only an a-side row may change who the spouse is.
        if (m.side === 'a') {
          if (!picked.name && !picked.id) throw new Error('A marriage needs a spouse name.');
          fields.person_b_id = picked.id || null;
          fields.spouse_name = picked.name || null;
        }
        await RRMarriage.update(sb, m.id, fields);
        marriageStatus('✓ Marriage updated');
      } else {
        await RRMarriage.add(sb, grave.person_id, {
          id: picked.id,
          name: picked.name,
          marriage_date: mDate.value.trim() || null,
          end_date: eDate.value.trim() || null,
          end_reason: reason.value || null,
          notes: notes.value.trim() || null
        });
        marriageStatus('✓ Marriage added');
      }
      await renderEditMarriages(grave);
    } catch (e) {
      marriageStatus(e.message, 'error');
      saveBtn.disabled = false;
      saveBtn.textContent = m ? 'Save marriage' : 'Add marriage';
    }
  });
  btns.appendChild(saveBtn);

  const killBtn = document.createElement('button');
  killBtn.className = 'rr-btn secondary';
  killBtn.style.cssText = 'flex:1;margin-top:0;';
  killBtn.textContent = m ? 'Remove' : 'Cancel';
  killBtn.addEventListener('click', async () => {
    if (!m) { row.remove(); marriageStatus(''); return; }
    const who = m.spouseName || 'this spouse';
    if (!confirm(`Remove the marriage to ${who}? It will disappear from both records.`)) return;
    killBtn.disabled = true;
    try {
      await RRMarriage.remove(sb, m.id);
      marriageStatus('Marriage removed');
      await renderEditMarriages(grave);
    } catch (e) {
      marriageStatus('Could not remove: ' + e.message, 'error');
      killBtn.disabled = false;
    }
  });
  btns.appendChild(killBtn);

  row.appendChild(btns);
  return row;
}

document.getElementById('edit-add-marriage').addEventListener('click', () => {
  if (!editingGrave || !editingGrave.person_id) return;
  const container = document.getElementById('edit-marriages');
  // Drop the "No marriages recorded" line the moment a row appears.
  const placeholder = container.querySelector('div:not([style*="border"])');
  if (placeholder && !placeholder.querySelector('input')) placeholder.remove();
  const row = buildMarriageRow(editingGrave, null);
  container.appendChild(row);
  const input = row.querySelector('input');
  if (input) input.focus();
});

async function loadEditAttachments(graveId) {
  const container = document.getElementById('edit-attachments');
  container.innerHTML = '';
  const { data: atts } = await sb.from('attachments').select('*').eq('grave_id', graveId);
  if (!atts || atts.length === 0) {
    container.innerHTML = '<div style="font-size:11px;color:var(--brown);">No attachments yet.</div>';
    return;
  }
  atts.forEach(att => {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:8px;padding:6px 0;border-bottom:1px solid #f0e8d8;';
    const icon = att.file_type === 'photo' ? '🖼' : '📄';
    const label = document.createElement('span');
    label.style.cssText = 'font-size:12px;color:var(--dark-brown);word-break:break-word;flex:1;';
    label.textContent = `${icon} ${att.file_name}`;
    const del = document.createElement('button');
    del.className = 'att-delete';
    del.textContent = '✕';
    del.title = `Delete ${att.file_name}`;
    del.addEventListener('click', () => deleteAttachment(att, graveId));
    row.appendChild(label);
    row.appendChild(del);
    container.appendChild(row);
  });
}

async function deleteAttachment(att, graveId) {
  if (!currentUser) { showAuthModal(); return; }
  if (!confirm(`Delete "${att.file_name}"? This cannot be undone.`)) return;
  const statusEl = document.getElementById('edit-attachment-status');
  statusEl.textContent = `Deleting ${att.file_name}...`;

  // Storage first — the row holds the only reference to the file path.
  const { error: sErr } = await sb.storage.from('graves-media').remove([att.file_path]);
  if (sErr) console.warn('[attachment] storage delete failed:', sErr.message);

  const { error: rErr } = await sb.from('attachments').delete().eq('id', att.id);
  if (rErr) {
    statusEl.textContent = `Delete failed: ${rErr.message}`;
    return;
  }
  statusEl.textContent = `✓ ${att.file_name} deleted`;
  loadEditAttachments(graveId);
}

document.getElementById('edit-attachment-input').addEventListener('change', async e => {
  const file = e.target.files[0];
  if (!file || !editingGrave) return;
  const statusEl = document.getElementById('edit-attachment-status');
  statusEl.textContent = `Uploading ${file.name}...`;
  const path = `photos/${editingGrave.id}/${Date.now()}_${file.name}`;
  const { error } = await sb.storage.from('graves-media').upload(path, file);
  if (!error) {
    await sb.from('attachments').insert({
      grave_id: editingGrave.id, person_id: editingGrave.person_id,
      file_name: file.name, file_path: path,
      file_type: file.type.startsWith('image/') ? 'photo' : 'document',
      file_size: file.size, mime_type: file.type
    });
    statusEl.textContent = `✓ ${file.name} uploaded`;
    loadEditAttachments(editingGrave.id);
  } else {
    statusEl.textContent = `Upload failed: ${error.message}`;
  }
  e.target.value = '';
});

document.getElementById('edit-save').addEventListener('click', async () => {
  if (!editingGrave) return;
  const btn = document.getElementById('edit-save');
  btn.disabled = true; btn.textContent = 'Saving...';

  const updates = {
    person_name: document.getElementById('ep-name').value.trim() || null,
    dob: document.getElementById('ep-dob').value || null,
    dod: document.getElementById('ep-dod').value || null,
    father: document.getElementById('ep-father').value.trim() || null,
    mother: document.getElementById('ep-mother').value.trim() || null,
    cemetery_name: document.getElementById('ep-cemetery').value.trim() || null,
    county: document.getElementById('ep-county').value.trim() || null,
    state: document.getElementById('ep-state').value.trim() || null,
    description: document.getElementById('ep-notes').value.trim() || null,
  };

  const { error } = await sb.from('graves').update(updates).eq('id', editingGrave.id);
  if (error) {
    showStatus('edit-status', `Save failed: ${error.message}`, 'error');
    btn.disabled = false; btn.textContent = 'Save Changes';
    return;
  }

  // Sync to persons table
  if (editingGrave.person_id) {
    await sb.from('persons').update({
      name: updates.person_name,
      dob: updates.dob, dod: updates.dod,
      father: updates.father, mother: updates.mother,
      father_id: RRPicker.value(document.getElementById('ep-father')).id,
      mother_id: RRPicker.value(document.getElementById('ep-mother')).id,
    }).eq('id', editingGrave.person_id);
  }

  showStatus('edit-status', '✓ Record updated', 'success');
  btn.textContent = 'Saved!';
  await loadGraves();
  setTimeout(() => closePanel('edit-panel'), 1500);
});

// ══════════════════════════════════════════
// MOVE & DELETE
// ══════════════════════════════════════════
function startMoveMode(grave) {
  if (!currentUser) { showAuthModal(); return; }
  document.getElementById('feature-panel').style.display = 'none';
  document.getElementById('click-banner').textContent = 'Tap map to set new location — tap again to cancel';
  document.getElementById('click-banner').style.display = 'block';
  if (moveHandler) map.off('click', moveHandler);
  moveHandler = async (e) => {
    map.off('click', moveHandler); moveHandler = null;
    document.getElementById('click-banner').style.display = 'none';
    document.getElementById('click-banner').textContent = 'Tap map to place grave location';
    const { error } = await sb.from('graves').update({
      location: `POINT(${e.latlng.lng} ${e.latlng.lat})`
    }).eq('id', grave.id);
    if (!error) { await loadGraves(); }
  };
  map.on('click', moveHandler);
}

async function deleteGrave(grave) {
  if (!currentUser) { showAuthModal(); return; }

  // Read the marriages before asking, so the warning can say what else is
  // about to change. Deleting a person silently rewrites their spouses'
  // records too, and that should not be a surprise.
  let marriages = [];
  if (grave.person_id && window.RRMarriage && navigator.onLine) {
    try {
      marriages = await RRMarriage.load(sb, grave.person_id);
    } catch (e) {
      console.warn('[delete] could not read marriages:', e);
    }
  }
  let marriageWarning = '';
  if (marriages.length) {
    const who = marriages.map(m => m.spouseName || 'an unnamed spouse').join(', ');
    marriageWarning = `\n\n${marriages.length} marriage${marriages.length === 1 ? '' : 's'} ` +
      `(${who}) will be kept on the spouse's record, but as a name-only entry.`;
  }
  if (!confirm(`Delete record for "${grave.person_name}"?${marriageWarning}\n\nThis cannot be undone.`)) return;

  // 1. Storage files first — once the attachment rows are gone we lose the paths.
  const { data: atts } = await sb.from('attachments')
    .select('id, file_path')
    .eq('grave_id', grave.id);

  const paths = (atts || []).map(a => a.file_path).filter(Boolean);
  if (paths.length > 0) {
    const { error: storageErr } = await sb.storage.from('graves-media').remove(paths);
    if (storageErr) console.warn('[delete] storage cleanup failed:', storageErr.message);
  }

  // 2. Attachment rows
  await sb.from('attachments').delete().eq('grave_id', grave.id);

  // 3. The grave itself
  await sb.from('graves').delete().eq('id', grave.id);

  // 4. The person — but only if no other grave still references them.
  if (grave.person_id) {
    const { data: remaining } = await sb.from('graves')
      .select('id')
      .eq('person_id', grave.person_id)
      .limit(1);
    if (!remaining || remaining.length === 0) {
      // Must run before the delete — person_a_id cascades, so the rows
      // would be gone before anything could be salvaged from them.
      if (window.RRMarriage) {
        try {
          await RRMarriage.preserveOnDelete(sb, grave.person_id, grave.person_name);
        } catch (e) {
          console.warn('[delete] marriage preservation failed:', e);
        }
      }
      await sb.from('persons').delete().eq('id', grave.person_id);
    }
  }

  document.getElementById('feature-panel').style.display = 'none';
  hideNavPanel();
  await loadGraves();
}

// ══════════════════════════════════════════
// FILTER BY PERSON
// ══════════════════════════════════════════
async function applyFilter(name, personId) {
  currentFilterName = name;
  currentFilterId = personId;
  document.getElementById('filter-name-display').textContent = name;
  document.getElementById('filter-active').style.display = 'block';
  document.getElementById('trace-options').style.display = 'block';
  document.getElementById('web-legend').style.display = 'none';
  lineageLayer.clearLayers();
  labelsLayer.clearLayers();
  resetWebButton();
  hideClearTrace();
  renderGraves(name);

  // Zoom to matching graves
  const matching = currentGraves.filter(g =>
    g.person_name?.toLowerCase().includes(name.toLowerCase())
  );
  if (matching.length > 0) {
    const coords = matching.map(g => parseLocation(g.location)).filter(Boolean);
    if (coords.length === 1) {
      map.setView([coords[0].lat, coords[0].lng], 14, { animate: true, duration: 1 });
    } else if (coords.length > 1) {
      fitToCoords(coords.map(c => [c.lat, c.lng]), { duration: 1 });
    }
    // Open feature panel for single match
    if (matching.length === 1) {
      setTimeout(() => openFeaturePanel(matching[0]), 600);
    }
  }

  buildGenerationPills();
}

function buildGenerationPills() {
  ['ancestor-pills', 'descendant-pills'].forEach((id, isDesc) => {
    const container = document.getElementById(id);
    container.innerHTML = '';
    const current = isDesc ? descendantGens : ancestorGens;
    [1, 2, 3, 4].forEach(n => {
      const pill = document.createElement('div');
      pill.className = 'gen-pill' + (n <= current ? ' selected' : '');
      pill.textContent = n;
      pill.addEventListener('click', () => {
        if (isDesc) descendantGens = n; else ancestorGens = n;
        buildGenerationPills();
      });
      container.appendChild(pill);
    });
  });
}

document.getElementById('filter-search-btn').addEventListener('click', async () => {
  const input = document.getElementById('filter-search').value.trim();
  if (!input) return;
  const { data } = await sb.from('persons').select('id, name').ilike('name', `%${input}%`).limit(1);
  const person = data?.[0];
  applyFilter(person ? person.name : input, person?.id || null);
});

document.getElementById('filter-search').addEventListener('keydown', async e => {
  if (e.key !== 'Enter') return;
  document.getElementById('filter-search-btn').click();
});

document.getElementById('browse-btn').addEventListener('click', async () => {
  const list = document.getElementById('browse-list');
  if (list.style.display === 'block') { list.style.display = 'none'; return; }
  list.innerHTML = '<div style="padding:10px;font-size:11px;color:var(--brown);">Loading...</div>';
  list.style.display = 'block';
  const { data } = await sb.from('persons').select('id, name, dob, dod').order('name');
  // Only list people who actually have a grave on the map — an orphaned
  // person row would otherwise show here and filter to nothing when tapped.
  const withGraves = new Set(currentGraves.map(g => g.person_id).filter(Boolean));
  const named = new Set(
    currentGraves.map(g => (g.person_name || '').trim().toLowerCase()).filter(Boolean)
  );
  const rows = (data || []).filter(p =>
    withGraves.has(p.id) || named.has((p.name || '').trim().toLowerCase())
  );
  list.innerHTML = '';
  rows.forEach(p => {
    const div = document.createElement('div');
    div.className = 'browse-item';
    const dob = p.dob ? new Date(p.dob).getFullYear() : '?';
    const dod = p.dod ? new Date(p.dod).getFullYear() : '?';
    const dates = (p.dob || p.dod) ? `${dob}–${dod}` : '';
    div.innerHTML = `<span>${p.name}</span><span class="dates">${dates}</span>`;
    div.addEventListener('click', () => {
      list.style.display = 'none';
      document.getElementById('filter-search').value = p.name;
      applyFilter(p.name, p.id);
    });
    list.appendChild(div);
  });
  if (rows.length === 0) {
    list.innerHTML = '<div style="padding:10px;font-size:11px;color:var(--brown);">No records yet.</div>';
  }
});

// Shared by the Filter panel's Clear Filter button and the floating
// Clear Trace button on the map.
function clearTraceAndFilter(resetView) {
  currentFilterName = null; currentFilterId = null;
  document.getElementById('filter-active').style.display = 'none';
  document.getElementById('web-legend').style.display = 'none';
  document.getElementById('trace-options').style.display = 'none';
  document.getElementById('filter-search').value = '';
  lineageLayer.clearLayers();
  labelsLayer.clearLayers();
  labeledNames.clear();
  resetWebButton();
  hideClearTrace();
  renderGraves();
  if (resetView) map.setView([37.8, -85.3], 7, { animate: true, duration: 1 });
}

function showClearTrace() {
  document.getElementById('clear-trace-btn').style.display = 'block';
}
function hideClearTrace() {
  document.getElementById('clear-trace-btn').style.display = 'none';
}

document.getElementById('clear-trace-btn').addEventListener('click', () => {
  clearTraceAndFilter(false);
});

document.getElementById('clear-filter-btn').addEventListener('click', () => {
  clearTraceAndFilter(true);
});

// ══════════════════════════════════════════
// WALK-IN COMPASS
// ══════════════════════════════════════════
// Live bearing to the grave for the final stretch on foot. Fully offline —
// GPS and the magnetometer are hardware, no network involved.
function openCompass(dest) {
  if (!dest) return;
  const overlay = document.getElementById('compass-overlay');
  document.getElementById('compass-target').textContent =
    dest.name ? 'Walking to ' + dest.name : 'Walking to grave';
  document.getElementById('compass-distance').textContent = '—';
  document.getElementById('compass-bearing').textContent = 'Waiting for GPS…';
  document.getElementById('compass-note').textContent = '';
  overlay.classList.remove('arrived');
  overlay.classList.add('open');

  // Must be called straight from the tap for the iOS compass permission.
  RRCompass.start(dest, {
    onReady: (hasHeading) => {
      document.getElementById('compass-note').textContent = hasHeading
        ? 'Hold the phone flat. If the arrow drifts, wave the phone in a figure eight to recalibrate.'
        : 'Compass unavailable — the arrow points by map bearing, so orient the top of the phone to north.';
    },
    onUpdate: (st) => {
      const arrow = document.getElementById('compass-arrow');
      // The glyph points right at 0deg, so -90 makes 0 mean straight ahead.
      arrow.style.transform = 'rotate(' + (st.arrow - 90) + 'deg)';
      document.getElementById('compass-distance').textContent =
        RRRoute.formatFeet(st.distance);
      document.getElementById('compass-bearing').textContent =
        st.compass + ' · ' + Math.round(st.bearing) + '° · ±' +
        Math.round(st.accuracy) + 'm GPS';
      document.getElementById('compass-overlay').classList.toggle('arrived', st.arrived);
      if (st.arrived) {
        document.getElementById('compass-bearing').textContent =
          'You should be within a few paces — look around.';
      }
    },
    onError: (msg) => {
      document.getElementById('compass-bearing').textContent = msg;
    }
  });
}

function closeCompass() {
  RRCompass.stop();
  document.getElementById('compass-overlay').classList.remove('open');
}

document.getElementById('compass-close').addEventListener('click', closeCompass);
document.getElementById('nav-walk-btn').addEventListener('click', () => {
  openCompass(lastNavDest);
});

// Stop the sensors if the app is backgrounded — watchPosition left running
// drains the battery for no benefit while the screen is off.
document.addEventListener('visibilitychange', () => {
  if (document.hidden && RRCompass.isRunning()) closeCompass();
});

// ══════════════════════════════════════════
// HOW AM I RELATED?
// ══════════════════════════════════════════
// The user is never in the records — every record is a deceased person —
// so the calculation is anchored on their closest recorded ancestor plus
// how many generations above them that person sits. Set once, stored
// locally, reused for every query.
let relateSubject = null;

function getAnchor() {
  try {
    const raw = localStorage.getItem('rr-anchor');
    return raw ? JSON.parse(raw) : null;
  } catch (e) { return null; }
}

function setAnchor(a) {
  try { localStorage.setItem('rr-anchor', JSON.stringify(a)); } catch (e) {}
}

function openAnchorPanel() {
  const panel = document.getElementById('anchor-panel');
  const input = document.getElementById('anchor-input');
  const existing = getAnchor();
  if (window.RRPicker) {
    RRPicker.attach(input);
    RRPicker.set(input, existing ? existing.name : '', existing ? existing.id : null);
  }
  document.getElementById('anchor-gens').value = existing ? existing.gens : '2';
  document.getElementById('anchor-status').textContent = '';
  document.getElementById('relate-panel').classList.remove('open');
  panel.classList.add('open');
}

document.getElementById('anchor-close').addEventListener('click', () => {
  document.getElementById('anchor-panel').classList.remove('open');
});
document.getElementById('relate-close').addEventListener('click', () => {
  document.getElementById('relate-panel').classList.remove('open');
});
document.getElementById('relate-change-anchor').addEventListener('click', openAnchorPanel);

document.getElementById('anchor-save').addEventListener('click', () => {
  const input = document.getElementById('anchor-input');
  const v = RRPicker.value(input);
  const status = document.getElementById('anchor-status');
  if (!v.id) {
    status.textContent = v.name
      ? 'That name has no record yet. The anchor must be someone with a grave in the app.'
      : 'Choose an ancestor from the list.';
    return;
  }
  setAnchor({ id: v.id, name: v.name, gens: parseInt(document.getElementById('anchor-gens').value, 10) });
  document.getElementById('anchor-panel').classList.remove('open');
  if (relateSubject) showRelationship(relateSubject);
});

async function showRelationship(grave) {
  relateSubject = grave;
  const anchor = getAnchor();
  if (!anchor) { openAnchorPanel(); return; }

  const panel = document.getElementById('relate-panel');
  const body = document.getElementById('relate-body');
  document.getElementById('relate-title').textContent = grave.person_name || 'Relationship';
  body.innerHTML = '<div class="rel-note">Working it out…</div>';
  panel.classList.add('open');

  const { data: persons, error } = await sb.from('persons')
    .select('id, name, dob, dod, gender, father, mother, father_id, mother_id');
  if (error) {
    body.innerHTML = '<div class="rel-note">Could not load records: ' + error.message + '</div>';
    return;
  }

  const res = RRRelate.relate(persons || [], grave.person_id, anchor.id, anchor.gens);
  renderRelationship(res, grave, anchor);
}

function years(p) {
  if (!p) return '';
  const a = p.dob ? String(p.dob).slice(0, 4) : '';
  const b = p.dod ? String(p.dod).slice(0, 4) : '';
  return a || b ? `${a}–${b}` : '';
}

function nodeHtml(p, cls) {
  const y = years(p);
  const ghost = p && p.real === false ? ' ghost' : '';
  return `<div class="rel-node ${cls}${ghost}">
      <div class="rel-node-name">${p ? p.name : 'Unknown'}</div>
      ${y ? `<div class="rel-node-years">${y}</div>` : ''}
    </div>`;
}

// Two chains rising to the shared ancestor. Not a general family tree —
// the data is a graph with multiple paths, and this deliberately shows one.
function treeHtml(path, anchor) {
  const subjChain = path.subjectPath || [];
  const userChain = path.userPath || [];
  const shared = path.ancestor;

  const col = (chain, endCls, label, extraTop) => {
    // chain runs [self ... ancestor]; drop the ancestor, it is shown once
    const rest = chain.slice(0, -1);
    let html = '<div class="rel-col">';
    rest.forEach((p, i) => {
      html += nodeHtml(p, i === 0 ? endCls : '');
      if (i < rest.length - 1) html += '<div class="rel-connector"></div>';
    });
    if (extraTop) html += '<div class="rel-connector"></div>' + extraTop;
    html += '</div><div class="rel-col-label">' + label + '</div>';
    return '<div>' + html + '</div>';
  };

  const youNode = `<div class="rel-node you"><div class="rel-node-name">You</div></div>`;
  const anchorNote = anchor.gens > 1
    ? `<div class="rel-connector"></div><div class="rel-node ghost"><div class="rel-node-name">${anchor.gens - 1} generation${anchor.gens - 1 === 1 ? '' : 's'} not recorded</div></div>`
    : '';

  return `<div class="rel-shared-wrap">
      ${nodeHtml(shared, 'shared')}
      <div class="rel-col-label">shared ancestor</div>
      <div class="rel-shared-join"></div>
      <div class="rel-tree">
        ${col(subjChain, 'subject', 'this record', '')}
        ${col(userChain, '', 'your line', anchorNote + '<div class="rel-connector"></div>' + youNode)}
      </div>
    </div>`;
}

function renderRelationship(res, grave, anchor) {
  const body = document.getElementById('relate-body');
  const name = grave.person_name || 'This person';

  if (!res.ok) {
    body.innerHTML = res.reason === 'anchor-missing'
      ? '<div class="rel-note">Your anchor record no longer exists. Set a new one.</div>'
      : '<div class="rel-note">This record has no person entry to trace from.</div>';
    return;
  }

  if (!res.paths || res.paths.length === 0) {
    const b = res.breaks || { subject: [], user: [] };
    const line = (arr) => arr.length
      ? arr.map(x => `${x.name} (${x.gen} generation${x.gen === 1 ? '' : 's'} back)`).join(', ')
      : 'no recorded parents';
    body.innerHTML = `
      <div class="rel-answer">No documented relationship to <strong>${name}</strong>.</div>
      <div class="rel-note">This means the records do not yet connect, not that there is no relation.</div>
      <div class="rel-alt-head">Where the lines stop</div>
      <div class="rel-alt">This record's line ends at: ${line(b.subject)}</div>
      <div class="rel-alt">Your line ends at: ${line(b.user)}</div>
      <div class="rel-note" style="margin-top:8px;">Finding a parent for either would likely connect them.</div>`;
    return;
  }

  const best = res.paths[0];
  const sharedNames = (best.ancestors || [best.ancestor]).map(a => a.name).join(' and ');

  // When the subject is themselves the shared ancestor, the generic
  // "through X, who is your Y and their Z" sentence collapses into
  // nonsense — they are the connection.
  const viaLine = best.subjectGen === 0
    ? `Directly in your line, ${describeSide(best.userGen, 'your')}.`
    : `Through ${sharedNames}, who is ${describeSide(best.userGen, 'your')} and ${describeSide(best.subjectGen, name + "'s")}.`;

  let html = `<div class="rel-answer">
      <strong>${name}</strong> is your <strong>${best.label}</strong>.
      <div class="rel-via">${viaLine}</div>
    </div>`;

  html += treeHtml(best, anchor);

  if (res.paths.length > 1) {
    html += '<div class="rel-alt-head">Also related through</div>';
    res.paths.slice(1).forEach(p => {
      const nm = (p.ancestors || [p.ancestor]).map(a => a.name).join(' and ');
      html += `<div class="rel-alt">${nm} — ${p.label}</div>`;
    });
  }
  if (res.truncated) {
    html += `<div class="rel-note">${res.truncated} more distant connection${res.truncated === 1 ? '' : 's'} not shown.</div>`;
  }

  html += `<div class="rel-note" style="margin-top:10px;">Anchor: ${anchor.name}, your ${anchorLabel(anchor.gens)}.</div>`;
  body.innerHTML = html;
}

function anchorLabel(g) {
  if (g === 1) return 'parent';
  if (g === 2) return 'grandparent';
  return (g - 2 === 1 ? 'great-' : 'great-'.repeat(g - 2)) + 'grandparent';
}

function describeSide(gen, who) {
  if (gen === 0) return who === 'your' ? 'you' : who;
  const poss = who === 'your' ? 'your' : who;
  if (gen === 1) return `${poss} parent`;
  if (gen === 2) return `${poss} grandparent`;
  return `${poss} ` + 'great-'.repeat(gen - 2) + 'grandparent';
}

// ══════════════════════════════════════════
// PERSON PICKERS
// ══════════════════════════════════════════
if (window.RRPicker) {
  RRPicker.attach(document.getElementById('g-father'));
  RRPicker.attach(document.getElementById('g-mother'));
  RRPicker.attach(document.getElementById('g-spouse'));
}

// ══════════════════════════════════════════
// DISPLAY THEME
// ══════════════════════════════════════════
// Themes are CSS variable overrides on <body>. Every component already reads
// from those variables, so nothing else needs to know a theme changed.
function applyTheme(name) {
  document.body.classList.remove('theme-day', 'theme-night');
  if (name !== 'standard') document.body.classList.add('theme-' + name);
  document.querySelectorAll('.theme-opt').forEach(b =>
    b.classList.toggle('active', b.dataset.theme === name));
  try { localStorage.setItem('rr-theme', name); } catch (e) { /* private mode */ }
}

document.querySelectorAll('.theme-opt').forEach(btn => {
  btn.addEventListener('click', () => applyTheme(btn.dataset.theme));
});

try {
  const saved = localStorage.getItem('rr-theme');
  if (saved) applyTheme(saved);
} catch (e) { /* private mode */ }

// ══════════════════════════════════════════
// PENDING QUEUE REVIEW
// ══════════════════════════════════════════
async function showQueuePanel() {
  const panel = document.getElementById('queue-panel');
  const list = document.getElementById('queue-list');
  const title = document.getElementById('queue-title');
  list.innerHTML = '';

  let pending = [];
  try {
    pending = await window.RRDb.getPendingRecords();
  } catch (e) {
    list.innerHTML = '<div class="queue-item">Could not read the queue.</div>';
    panel.classList.add('open');
    return;
  }

  title.textContent = pending.length === 1
    ? '1 record pending sync'
    : `${pending.length} records pending sync`;

  if (pending.length === 0) {
    list.innerHTML = '<div class="queue-item">Nothing pending — everything is synced.</div>';
  } else {
    pending.forEach(rec => {
      const p = rec.payload || {};
      const row = document.createElement('div');
      row.className = 'queue-item';

      const name = document.createElement('div');
      name.className = 'queue-item-name';
      name.textContent = p.person_name || 'Unnamed record';
      row.appendChild(name);

      const bits = [];
      if (p.cemetery_name) bits.push(p.cemetery_name);
      if (rec.created_at) bits.push(new Date(rec.created_at).toLocaleTimeString());
      bits.push(rec.photoId ? 'photo' : 'no photo');
      if (rec.audioId) bits.push('audio');

      const meta = document.createElement('div');
      meta.className = 'queue-item-meta';
      meta.textContent = bits.join(' · ');
      if (!rec.photoId) meta.classList.add('queue-flag');
      row.appendChild(meta);

      list.appendChild(row);
    });
  }

  const syncBtn = document.getElementById('queue-sync');
  syncBtn.disabled = !navigator.onLine || !currentUser || pending.length === 0;
  syncBtn.textContent = !navigator.onLine
    ? 'Offline — will sync when reconnected'
    : (!currentUser ? 'Sign in to sync' : 'Sync now');

  panel.classList.add('open');
}

document.getElementById('queue-close').addEventListener('click', () => {
  document.getElementById('queue-panel').classList.remove('open');
});
document.getElementById('queue-sync').addEventListener('click', async () => {
  document.getElementById('queue-panel').classList.remove('open');
  await syncPendingRecords();
});

// ══════════════════════════════════════════
// PLACE SEARCH
// ══════════════════════════════════════════
// Marker dropped on a geocoded result. Deliberately not a grave icon —
// it marks a searched location, not a record.
let searchMarker = null;

function clearSearchMarker() {
  if (searchMarker) {
    map.removeLayer(searchMarker);
    searchMarker = null;
  }
}

function dropSearchMarker(r) {
  clearSearchMarker();
  const icon = L.divIcon({
    className: 'geo-pin',
    html: '<div class="geo-pin-dot"></div>',
    iconSize: [24, 32],
    iconAnchor: [12, 32]
  });
  searchMarker = L.marker([r.lat, r.lng], { icon, zIndexOffset: 500 }).addTo(map);
  searchMarker.bindTooltip(r.label, {
    permanent: true,
    direction: 'top',
    offset: [0, -30],
    className: 'geo-pin-label',
    opacity: 1
  });
  // Tapping the pin removes it.
  searchMarker.on('click', clearSearchMarker);
}

document.getElementById('geo-btn').addEventListener('click', () => {
  const panel = document.getElementById('geo-panel');
  const open = panel.style.display === 'block';
  panel.style.display = open ? 'none' : 'block';
  document.getElementById('geo-btn').classList.toggle('active', !open);
  if (!open) document.getElementById('geo-input').focus();
});

async function runPlaceSearch() {
  const q = document.getElementById('geo-input').value.trim();
  const results = document.getElementById('geo-results');
  const status = document.getElementById('geo-status');
  if (!q) return;

  results.innerHTML = '';
  status.textContent = 'Searching\u2026';
  clearSearchMarker();

  const { local, remote, offline } = await RRGeo.search(q, currentGraves);

  const render = (items, heading) => {
    if (items.length === 0) return;
    const h = document.createElement('div');
    h.className = 'geo-group';
    h.textContent = heading;
    results.appendChild(h);
    items.forEach(r => {
      const row = document.createElement('div');
      row.className = 'geo-item';
      const label = document.createElement('div');
      label.className = 'geo-item-label';
      label.textContent = r.count > 1 ? `${r.label} (${r.count} records)` : r.label;
      row.appendChild(label);
      if (r.detail) {
        const detail = document.createElement('div');
        detail.className = 'geo-item-detail';
        detail.textContent = r.detail;
        row.appendChild(detail);
      }
      row.addEventListener('click', () => goToPlace(r));
      results.appendChild(row);
    });
  };

  render(local, 'In your records');
  render(remote, 'Places');

  if (local.length === 0 && remote.length === 0) {
    status.textContent = offline
      ? 'No matching records. Address search needs a connection.'
      : 'Nothing found. Try a town or county name.';
  } else {
    status.textContent = offline ? 'Offline \u2014 searched your records only.' : '';
  }
}

function goToPlace(r) {
  if (r.source === 'record' && r.grave) {
    const c = parseLocation(r.grave.location);
    if (c) map.setView([c.lat, c.lng], 16, { animate: true });
    openFeaturePanel(r.grave);
  } else {
    dropSearchMarker(r);
    map.setView([r.lat, r.lng], 15, { animate: true });
  }
  document.getElementById('geo-panel').style.display = 'none';
  document.getElementById('geo-btn').classList.remove('active');
}

document.getElementById('geo-search').addEventListener('click', runPlaceSearch);
document.getElementById('geo-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') runPlaceSearch();
});

// ══════════════════════════════════════════
// LABELS
// ══════════════════════════════════════════
// Label controls now live inside the Display & Offline panel, so there is
// no separate toggle button to wire.
document.getElementById('labels-always').addEventListener('change', (e) => {
  labelsPermanent = e.target.checked;
  refreshGraveLabels();
});

document.querySelectorAll('input[name="label-type"]').forEach(radio => {
  radio.addEventListener('change', (e) => {
    if (!e.target.checked) return;
    labelMode = e.target.value;
    refreshGraveLabels();
  });
});

document.getElementById('label-zoom-threshold').addEventListener('input', (e) => {
  labelZoomThreshold = parseInt(e.target.value, 10);
  document.getElementById('label-zoom-value').textContent = labelZoomThreshold;
  updateLabelVisibility();
});

map.on('zoomend', updateLabelVisibility);

// ══════════════════════════════════════════
// LINEAGE TRACE
// ══════════════════════════════════════════
const ancestorColors = [
  [120,0,0,230],[170,40,40,200],[210,100,100,170],[235,170,170,140]
];
const descendantColors = [
  [0,0,140,230],[40,40,200,200],[100,100,220,170],[170,170,235,140]
];

function toRgba(c) { return `rgba(${c[0]},${c[1]},${c[2]},${(c[3]||230)/255})`; }
function toWeight(gen) { return Math.max(1, 3 - gen * 0.5); }

// Shared by the Filter panel's Trace button and the feature panel's Trace.
// Sets filter state directly rather than calling applyFilter(), which
// re-opens the feature panel on a single match and would close the
// filter panel out from under us.
async function runTrace(name, personId) {
  if (!name) return;
  currentFilterName = name;
  currentFilterId = personId || null;
  document.getElementById('filter-name-display').textContent = name;
  document.getElementById('filter-active').style.display = 'block';
  document.getElementById('trace-options').style.display = 'block';
  buildGenerationPills();

  const btn = document.getElementById('trace-btn');
  btn.disabled = true; btn.textContent = '⬡ Tracing...';
  const lines = await traceFromPerson(name);
  btn.disabled = false; btn.textContent = '⬡ Trace Family Web';
  document.getElementById('web-legend').style.display = 'block';
  if (lines > 0) showClearTrace(); else hideClearTrace();
  return lines;
}

document.getElementById('trace-btn').addEventListener('click', async () => {
  if (!currentFilterName) return;
  await runTrace(currentFilterName, currentFilterId);
});

async function traceFromPerson(startName) {
  lineageLayer.clearLayers();
  labelsLayer.clearLayers();
  labeledNames.clear();
  resetWebButton();

  const gravesByName = {};
  currentGraves.forEach(g => {
    const n = (g.person_name || '').trim().toLowerCase();
    if (n) gravesByName[n] = g;
  });

  const { data: persons } = await sb.from('persons').select('name, father, mother');
  const personsByName = {};
  const childrenByParent = {};
  (persons || []).forEach(p => {
    const n = (p.name || '').trim().toLowerCase();
    const f = (p.father || '').trim().toLowerCase();
    const m = (p.mother || '').trim().toLowerCase();
    if (n) {
      personsByName[n] = { father: f, mother: m };
      if (f) { if (!childrenByParent[f]) childrenByParent[f] = []; childrenByParent[f].push(n); }
      if (m) { if (!childrenByParent[m]) childrenByParent[m] = []; childrenByParent[m].push(n); }
    }
  });

  const startKey = startName.trim().toLowerCase();
  const startGrave = gravesByName[startKey];
  const visitedA = new Set(), visitedD = new Set();
  const involvedNames = new Set([startKey]);
  let lineCount = 0;

  // Label start person
  if (startGrave) {
    const coords = parseLocation(startGrave.location);
    if (coords) addLabel(startName, [coords.lat, coords.lng], [26,26,46,255], true);
  }

  function traceAncestors(name, gen) {
    if (gen > ancestorGens || visitedA.has(name) || !name) return;
    visitedA.add(name);
    const childGrave = gravesByName[name];
    const person = personsByName[name];
    if (!person) return;
    const color = ancestorColors[gen - 1] || ancestorColors[3];

    [['father', person.father], ['mother', person.mother]].forEach(([, parentName]) => {
      if (!parentName || !gravesByName[parentName] || !childGrave) return;
      const childCoords = parseLocation(childGrave.location);
      const parentCoords = parseLocation(gravesByName[parentName].location);
      if (!childCoords || !parentCoords) return;
      L.polyline([[childCoords.lat, childCoords.lng],[parentCoords.lat, parentCoords.lng]], {
        color: toRgba(color), weight: toWeight(gen), opacity: 1
      }).addTo(lineageLayer);
      addLabel(gravesByName[parentName].person_name, [parentCoords.lat, parentCoords.lng], color, false);
      involvedNames.add(parentName);
      lineCount++;
      traceAncestors(parentName, gen + 1);
    });
  }

  function traceDescendants(name, gen) {
    if (gen > descendantGens || visitedD.has(name) || !name) return;
    visitedD.add(name);
    const parentGrave = gravesByName[name];
    if (!parentGrave) return;
    const color = descendantColors[gen - 1] || descendantColors[3];
    (childrenByParent[name] || []).forEach(childName => {
      const childGrave = gravesByName[childName];
      if (!childGrave) return;
      const parentCoords = parseLocation(parentGrave.location);
      const childCoords = parseLocation(childGrave.location);
      if (!parentCoords || !childCoords) return;
      L.polyline([[parentCoords.lat, parentCoords.lng],[childCoords.lat, childCoords.lng]], {
        color: toRgba(color), weight: toWeight(gen), opacity: 1, dashArray: gen > 2 ? '6,4' : null
      }).addTo(lineageLayer);
      addLabel(childGrave.person_name, [childCoords.lat, childCoords.lng], color, false);
      involvedNames.add(childName);
      lineCount++;
      traceDescendants(childName, gen + 1);
    });
  }

  traceAncestors(startKey, 1);
  traceDescendants(startKey, 1);

  // Filter graves to only those in trace
  renderGravesById([...involvedNames]);

  // Zoom to extent
  const allCoords = [...involvedNames]
    .map(n => gravesByName[n]).filter(Boolean)
    .map(g => parseLocation(g.location)).filter(Boolean)
    .map(c => [c.lat, c.lng]);
  if (allCoords.length > 1) {
    fitToCoords(allCoords, { duration: 1.2 });
  } else if (allCoords.length === 1) {
    map.setView(allCoords[0], 14, { animate: true, duration: 1 });
  }

  return lineCount;
}

function renderGravesById(names) {
  gravesLayer.clearLayers();
  const nameSet = new Set(names.map(n => n.toLowerCase()));
  currentGraves.filter(g => nameSet.has((g.person_name || '').toLowerCase())).forEach(g => {
    const coords = parseLocation(g.location);
    if (!coords) return;
    const marker = createGraveMarker(g, coords);
    marker._graveRef = g;
    marker.addTo(gravesLayer);
  });
}

function addLabel(name, latlng, color, isSelected) {  if (!name) return;
  const display = name.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  if (labeledNames.has(display)) return;
  labeledNames.add(display);
  // The origin gets high-contrast cream-on-ink with a gold border so it
  // reads as the starting point rather than another traced relative.
  const c = isSelected ? '#f5efe0' : `rgba(${color[0]},${color[1]},${color[2]},1)`;
  const bg = isSelected ? '#1a1a2e' : 'white';
  const border = isSelected ? '#c8b89a' : `rgba(${color[0]},${color[1]},${color[2]},0.5)`;
  const weight = isSelected ? '700' : '600';
  const icon = L.divIcon({
    className: 'rr-trace-label',
    html: `<div style="background:${bg};color:${c};padding:2px 6px;border-radius:2px;font-size:${isSelected ? 11 : 10}px;font-weight:${weight};font-family:Georgia,serif;white-space:nowrap;border:1px solid ${border};box-shadow:0 1px 4px rgba(0,0,0,0.25);">${display}</div>`,
    iconSize: [0, 0],
    iconAnchor: [-4, 6]
  });
  L.marker(latlng, { icon, interactive: false, zIndexOffset: isSelected ? 100 : -100 }).addTo(labelsLayer);
}

// ══════════════════════════════════════════
// SHOW ALL FAMILY WEB
// ══════════════════════════════════════════
// Put the Family Web button back to its unbuilt state. Called whenever
// something else takes over lineageLayer (filter, trace, clear).
function resetWebButton() {
  webVisible = false;
  const btn = document.getElementById('btn-web');
  btn.textContent = '⬡ Family Web';
  btn.classList.remove('active');
}

async function buildFullWeb() {
  const btn = document.getElementById('btn-web');

  // Second tap — tear the web down instead of rebuilding it.
  if (webVisible) {
    lineageLayer.clearLayers();
    labelsLayer.clearLayers();
    labeledNames.clear();
    resetWebButton();
    hideClearTrace();
    return;
  }

  lineageLayer.clearLayers();
  labelsLayer.clearLayers();
  labeledNames.clear();
  btn.textContent = '⬡ Building...';
  btn.disabled = true;

  const gravesByName = {};
  currentGraves.forEach(g => {
    const n = (g.person_name || '').trim().toLowerCase();
    if (n) gravesByName[n] = g;
  });

  const { data: persons } = await sb.from('persons').select('name, father, mother');
  let count = 0;
  (persons || []).forEach(p => {
    const childName = (p.name || '').trim().toLowerCase();
    const childGrave = gravesByName[childName];
    if (!childGrave) return;
    const childCoords = parseLocation(childGrave.location);
    if (!childCoords) return;

    [p.father, p.mother].forEach((parentName, i) => {
      const pn = (parentName || '').trim().toLowerCase();
      if (!pn || !gravesByName[pn]) return;
      const parentCoords = parseLocation(gravesByName[pn].location);
      if (!parentCoords) return;
      L.polyline([[childCoords.lat, childCoords.lng],[parentCoords.lat, parentCoords.lng]], {
        color: i === 0 ? 'rgba(100,0,0,0.7)' : 'rgba(0,0,100,0.7)',
        weight: 1.5, opacity: 1
      }).addTo(lineageLayer);
      count++;
    });
  });

  btn.textContent = count > 0 ? `⬡ Hide Web (${count})` : '⬡ Family Web';
  btn.disabled = false;
  webVisible = count > 0;
  btn.classList.toggle('active', webVisible);

  if (count > 0) {
    const allCoords = currentGraves.map(g => parseLocation(g.location)).filter(Boolean).map(c => [c.lat, c.lng]);
    if (allCoords.length > 1) fitToCoords(allCoords);
  }
}

// ══════════════════════════════════════════
// UTILITIES
// ══════════════════════════════════════════
function showStatus(id, msg, type) {
  const el = document.getElementById(id);
  el.textContent = msg;
  el.className = `status ${type}`;
}

// Offline detection
// Offline detection handled in sync section below

// Close basemap panel on map click
map.on('click', () => { document.getElementById('basemap-panel').style.display = 'none'; });

// ══════════════════════════════════════════
// INIT
// ══════════════════════════════════════════
// ── Draggable + resizable feature panel ──
(function makePanelDraggable() {
  const panel = document.getElementById('feature-panel');
  const resizeHandle = document.getElementById('fp-resize-handle');
  const redockBtn = document.getElementById('fp-redock');
  let isDragging = false, isResizing = false;
  let dragStartX, dragStartY, panelStartX, panelStartY;
  let resizeStartX, resizeStartY, startW, startH;
  let defaultLeft = null, defaultTop = null;

  panel.style.cursor = 'grab';

  // Drag — mouse
  panel.addEventListener('mousedown', (e) => {
    if (e.target === resizeHandle || e.target.tagName === 'BUTTON' ||
        e.target.tagName === 'IMG' || e.target.tagName === 'AUDIO') return;
    isDragging = true;
    dragStartX = e.clientX; dragStartY = e.clientY;
    panelStartX = parseInt(panel.style.left) || 0;
    panelStartY = parseInt(panel.style.top) || 0;
    panel.style.cursor = 'grabbing';
    e.preventDefault();
  });

  document.addEventListener('mousemove', (e) => {
    if (isDragging) {
      panel.style.left = `${panelStartX + e.clientX - dragStartX}px`;
      panel.style.top = `${panelStartY + e.clientY - dragStartY}px`;
      positionFeaturePanel(true);
    }
    if (isResizing) {
      panel.style.width = `${Math.max(200, startW + e.clientX - resizeStartX)}px`;
      panel.style.maxHeight = `${Math.max(150, startH + e.clientY - resizeStartY)}px`;
    }
  });

  document.addEventListener('mouseup', () => {
    isDragging = false; isResizing = false;
    panel.style.cursor = 'grab';
  });

  // Resize handle — mouse
  resizeHandle.addEventListener('mousedown', (e) => {
    isResizing = true;
    resizeStartX = e.clientX; resizeStartY = e.clientY;
    startW = panel.offsetWidth; startH = panel.offsetHeight;
    e.preventDefault(); e.stopPropagation();
  });

  // Redock
  redockBtn.addEventListener('click', () => {
    if (defaultLeft !== null) {
      panel.style.left = `${defaultLeft}px`;
      panel.style.top = `${defaultTop}px`;
    }
    panel.style.width = '260px';
    panel.style.maxHeight = '320px';
  });

  // Store default position when panel first shown
  const observer = new MutationObserver(() => {
    if (panel.style.display === 'block' && defaultLeft === null) {
      defaultLeft = parseInt(panel.style.left) || 0;
      defaultTop = parseInt(panel.style.top) || 0;
    }
  });
  observer.observe(panel, { attributes: true, attributeFilter: ['style'] });

  // Drag — touch
  panel.addEventListener('touchstart', (e) => {
    if (e.target === resizeHandle || e.target.tagName === 'BUTTON' ||
        e.target.tagName === 'IMG' || e.target.tagName === 'AUDIO') return;
    const t = e.touches[0];
    isDragging = true;
    dragStartX = t.clientX; dragStartY = t.clientY;
    panelStartX = parseInt(panel.style.left) || 0;
    panelStartY = parseInt(panel.style.top) || 0;
    e.preventDefault();
  }, { passive: false });

  panel.addEventListener('touchmove', (e) => {
    if (!isDragging) return;
    const t = e.touches[0];
    panel.style.left = `${panelStartX + t.clientX - dragStartX}px`;
    panel.style.top = `${panelStartY + t.clientY - dragStartY}px`;
    positionFeaturePanel(true);
    e.preventDefault();
  }, { passive: false });

  panel.addEventListener('touchend', () => { isDragging = false; });
})();

// ══════════════════════════════════════════
// OFFLINE SYNC
// ══════════════════════════════════════════

async function updateSyncBadge() {
  try {
    const count = await window.RRDb.getPendingCount();
    const badge = document.getElementById('sync-badge');
    if (count > 0) {
      badge.textContent = `⏳ ${count} record${count === 1 ? '' : 's'} pending sync`;
      badge.style.display = 'block';
      badge.style.cursor = 'pointer';
    } else {
      badge.style.display = 'none';
    }
  } catch (e) { /* db not ready */ }
}

async function syncPendingRecords() {
  if (!navigator.onLine || !currentUser) return;

  const pending = await window.RRDb.getPendingRecords();
  if (pending.length === 0) return;

  const badge = document.getElementById('sync-badge');
  badge.textContent = `⏳ Syncing ${pending.length} record${pending.length === 1 ? '' : 's'}...`;
  badge.style.display = 'block';

  let synced = 0, failed = 0;

  for (const item of pending) {
    try {
      const p = item.payload;

      // 1. Insert person
      const { data: person, error: pErr } = await sb.from('persons').insert({
        name: p.name, dob: p.dob, dod: p.dod,
        father: p.father, mother: p.mother,
        father_id: p.father_id || null, mother_id: p.mother_id || null
      }).select().single();
      if (pErr) throw pErr;

      // 2. Insert grave
      const { data: grave, error: gErr } = await sb.from('graves').insert({
        person_id: person.id,
        person_name: p.name,
        dob: p.dob, dod: p.dod,
        father: p.father, mother: p.mother,
        cemetery_name: p.cemetery_name,
        county: p.county, state: p.state,
        description: p.description,
        location: `POINT(${p.lng} ${p.lat})`
      }).select().single();
      if (gErr) throw gErr;

      // 2b. Marriage captured in the field. A spouse_id chosen offline came
      // from the already-loaded graves, so it still points at a real
      // persons row by the time the queue drains.
      if (window.RRMarriage && (p.spouse || p.spouse_id)) {
        try {
          await RRMarriage.add(sb, person.id, {
            id: p.spouse_id, name: p.spouse, marriage_date: p.marriage_date
          });
        } catch (mErr) {
          console.warn('Queued marriage failed:', mErr);
        }
      }

      // 3. Upload photo if queued
      if (item.photoId) {
        const photoBlob = await window.RRDb.getMediaBlob(item.photoId);
        if (photoBlob) {
          const path = `photos/${grave.id}/${Date.now()}_headstone.jpg`;
          const { error: upErr } = await sb.storage.from('graves-media')
            .upload(path, photoBlob, { contentType: 'image/jpeg' });
          if (!upErr) {
            await sb.from('attachments').insert({
              grave_id: grave.id, person_id: person.id,
              file_name: 'headstone.jpg', file_path: path,
              file_type: 'photo', file_size: photoBlob.size,
              mime_type: 'image/jpeg'
            });
          }
        }
      }

      // 4. Upload audio if queued
      if (item.audioId) {
        const audioBlob = await window.RRDb.getMediaBlob(item.audioId);
        if (audioBlob) {
          const ext = audioBlob.type.includes('webm') ? 'webm' : 'mp4';
          const path = `audio/${grave.id}/${Date.now()}_note.${ext}`;
          const { error: audErr } = await sb.storage.from('graves-media')
            .upload(path, audioBlob, { contentType: audioBlob.type });
          if (!audErr) {
            await sb.from('attachments').insert({
              grave_id: grave.id, person_id: person.id,
              file_name: `note.${ext}`, file_path: path,
              file_type: 'audio', file_size: audioBlob.size,
              mime_type: audioBlob.type
            });
          }
        }
      }

      // 5. Remove from queue
      await window.RRDb.markSynced(item.id, item.photoId, item.audioId);
      synced++;

    } catch (err) {
      console.warn('Sync failed for record:', err);
      failed++;
    }
  }

  // Refresh map and update badge
  await loadGraves();

  if (failed === 0) {
    badge.textContent = `✓ ${synced} record${synced === 1 ? '' : 's'} synced`;
    setTimeout(() => { badge.style.display = 'none'; }, 3000);
  } else {
    badge.textContent = `⚠ ${synced} synced, ${failed} failed`;
    setTimeout(() => updateSyncBadge(), 4000);
  }
}

// Manual sync trigger — tap the badge
document.getElementById('sync-badge').addEventListener('click', showQueuePanel);

// Auto-sync when connection restored
window.addEventListener('online', () => {
  document.getElementById('offline-banner').style.display = 'none';
  setTimeout(() => syncPendingRecords(), 1500);
});

window.addEventListener('offline', () => {
  document.getElementById('offline-banner').style.display = 'block';
});

if (!navigator.onLine) document.getElementById('offline-banner').style.display = 'block';

// ══════════════════════════════════════════
// SERVICE WORKER REGISTRATION
// ══════════════════════════════════════════
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js')
    .then(reg => console.log('Service Worker registered:', reg.scope))
    .catch(err => console.warn('Service Worker registration failed:', err));
}

// ══════════════════════════════════════════
// OFFLINE MAP TILE DOWNLOAD
// ══════════════════════════════════════════

let downloadCancelled = false;

// Convert lat/lng bounds to tile coordinates at a zoom level
function latLngToTile(lat, lng, zoom) {
  const n = Math.pow(2, zoom);
  const x = Math.floor((lng + 180) / 360 * n);
  const latRad = lat * Math.PI / 180;
  const y = Math.floor((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * n);
  return { x, y };
}

// Build list of tile URLs for current bounds across zoom range
function buildTileList(bounds, minZoom, maxZoom) {
  const tiles = [];
  const template = basemaps[currentBasemap]._url;
  const subdomains = basemaps[currentBasemap].options.subdomains || 'abc';
  const subArray = typeof subdomains === 'string' ? subdomains.split('') : subdomains;

  for (let z = minZoom; z <= maxZoom; z++) {
    const nw = latLngToTile(bounds.getNorth(), bounds.getWest(), z);
    const se = latLngToTile(bounds.getSouth(), bounds.getEast(), z);
    for (let x = nw.x; x <= se.x; x++) {
      for (let y = nw.y; y <= se.y; y++) {
        const s = subArray[Math.abs(x + y) % subArray.length];
        const url = template
          .replace('{s}', s)
          .replace('{z}', z)
          .replace('{x}', x)
          .replace('{y}', y)
          .replace('{r}', '');
        tiles.push(url);
      }
    }
  }
  return tiles;
}

document.getElementById('download-tiles-btn').addEventListener('click', async () => {
  const maxZoom = parseInt(document.getElementById('offline-zoom-level').value);
  const minZoom = 10;
  const bounds = map.getBounds();
  const tiles = buildTileList(bounds, minZoom, maxZoom);

  if (tiles.length > 20000) {
    document.getElementById('offline-status').textContent =
      '⚠ Area too large — zoom in further or choose lower detail';
    return;
  }

  downloadCancelled = false;
  document.getElementById('tile-progress-wrap').style.display = 'block';
  document.getElementById('download-tiles-btn').disabled = true;
  document.getElementById('offline-status').textContent = '';

  let done = 0, failed = 0;
  const batchSize = 6; // parallel requests

  for (let i = 0; i < tiles.length; i += batchSize) {
    if (downloadCancelled) break;
    const batch = tiles.slice(i, i + batchSize);
    await Promise.all(batch.map(url =>
      fetch(url, { mode: 'no-cors' })
        .then(() => { done++; })
        .catch(() => { failed++; done++; })
    ));

    const pct = Math.round((done / tiles.length) * 100);
    document.getElementById('tile-progress-bar').style.width = `${pct}%`;
    document.getElementById('tile-progress-text').textContent =
      `Downloading ${done.toLocaleString()} of ${tiles.length.toLocaleString()} tiles (${pct}%)`;

    // Small delay to avoid hammering tile server
    await new Promise(r => setTimeout(r, 40));
  }

  document.getElementById('tile-progress-wrap').style.display = 'none';
  document.getElementById('download-tiles-btn').disabled = false;
  document.getElementById('tile-progress-bar').style.width = '0%';

  if (downloadCancelled) {
    document.getElementById('offline-status').textContent =
      `Cancelled — ${done.toLocaleString()} tiles saved`;
  } else {
    const estMB = ((done * 15) / 1024).toFixed(0);
    document.getElementById('offline-status').textContent =
      `✓ Map saved for offline use — ${done.toLocaleString()} tiles (~${estMB}MB)`;
  }
  updateCacheSize();
});

document.getElementById('cancel-download-btn').addEventListener('click', () => {
  downloadCancelled = true;
});

// ── Clear offline tile cache ──
document.getElementById('clear-tiles-btn').addEventListener('click', async () => {
  if (!confirm('Clear all downloaded offline map tiles? The map will need cell service until you download again.')) return;
  try {
    const keys = await caches.keys();
    const tileCaches = keys.filter(k => k.includes('tiles'));
    await Promise.all(tileCaches.map(k => caches.delete(k)));
    document.getElementById('offline-status').textContent = '✓ Offline map cleared';
    setTimeout(() => updateCacheSize(), 500);
  } catch (err) {
    document.getElementById('offline-status').textContent = 'Failed to clear cache';
  }
});

// ── Show current cache size ──
async function updateCacheSize() {
  try {
    if (!navigator.storage || !navigator.storage.estimate) return;
    const est = await navigator.storage.estimate();
    const usedMB = (est.usage / 1024 / 1024).toFixed(0);
    const quotaMB = (est.quota / 1024 / 1024).toFixed(0);
    const el = document.getElementById('offline-status');
    if (el && !el.textContent) {
      el.textContent = `Storage used: ${usedMB}MB of ${quotaMB}MB available`;
    }
  } catch (e) { /* not supported */ }
}

// Update cache size when layers panel opens
document.getElementById('display-btn').addEventListener('click', () => {
  setTimeout(() => updateCacheSize(), 200);
});

checkAuth();
updateSyncBadge();
// Attempt sync on load if online
if (navigator.onLine) setTimeout(() => syncPendingRecords(), 2500);

}); // end window.addEventListener('load')
