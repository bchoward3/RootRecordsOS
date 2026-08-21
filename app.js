// ══════════════════════════════════════════
// SUPABASE INIT
// ══════════════════════════════════════════
const SUPABASE_URL = 'https://vyuqusttytnvqceoaniz.supabase.co';
const SUPABASE_KEY = 'sb_publishable_gFLrIl6ZcWbWd434sPYUYw_X4Y_jLQn';
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// State
let map, basemaps, gravesLayer, lineageLayer, labelsLayer;
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
const labeledNames = new Set();

window.addEventListener('load', () => {

// ══════════════════════════════════════════
// MAP INIT
// ══════════════════════════════════════════
map = L.map('map', { zoomControl: true }).setView([37.8, -85.3], 7);

// Routing module needs the map instance
if (window.RRRoute) RRRoute.init(map);

const basemaps = {
  voyager: L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
    attribution: '© CartoDB © OpenStreetMap', maxZoom: 19
  }),
  light: L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
    attribution: '© CartoDB © OpenStreetMap', maxZoom: 19
  }),
  topo: L.tileLayer('https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer/tile/{z}/{y}/{x}', {
    attribution: '© USGS The National Map', maxZoom: 16
  }),
  osm: L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap', maxZoom: 19
  }),
  satellite: L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    attribution: '© Esri', maxZoom: 19
  }),
  toner: L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenTopoMap © OpenStreetMap', maxZoom: 17
  })
};

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

// ══════════════════════════════════════════
// AUTH
// ══════════════════════════════════════════
async function checkAuth() {
  const { data: { session } } = await sb.auth.getSession();
  if (session) {
    setUser(session.user);
  } else {
    // Guest: land in the app read-only. Sign-in is available from the
    // header button, not forced on arrival.
    currentUser = null;
    document.getElementById('auth-modal').classList.add('hidden');
    document.getElementById('login-btn').style.display = 'block';
    document.getElementById('user-indicator').style.display = 'none';
    updateBasemapAccess();
    loadGraves();
  }
}

// Basemaps that cost money per tile — hidden from guests so visitors
// can't spend the quota. This is a courtesy, not security: the token is
// still readable in app.js. Restrict it by URL in the Mapbox account.
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

// ══════════════════════════════════════════
// LOAD GRAVES
// ══════════════════════════════════════════
async function loadGraves() {
  const { data, error } = await sb.rpc('get_graves_geojson');
  if (error) { console.error('Load graves failed:', error); return; }
  currentGraves = data || [];
  renderGraves();
  populateCemeteryDropdown();
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
    className: 'grave-marker'
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
document.getElementById('btn-layers').addEventListener('click', () => openPanel('layers-panel'));

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
    map.fitBounds(L.latLngBounds(coords), { padding: [40, 40], animate: true });
  } else {
    map.setView([37.8, -85.3], 7, { animate: true });
  }
});

// Layer toggle
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
  ['g-name','g-dob','g-dod','g-father','g-mother','g-cemetery','g-county','g-notes'].forEach(id => {
    document.getElementById(id).value = '';
  });
  document.getElementById('g-state').value = 'KY';
  document.getElementById('add-status').className = 'status';
  document.getElementById('save-grave').textContent = 'Save Record';
  document.getElementById('save-grave').disabled = false;
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
document.getElementById('save-grave').addEventListener('click', async () => {
  if (!placedPoint) { showStatus('add-status', 'No location set. Go back and tap the map.', 'error'); return; }
  const name = document.getElementById('g-name').value.trim();
  if (!name) { showStatus('add-status', 'Person name is required.', 'error'); return; }

  const btn = document.getElementById('save-grave');
  btn.disabled = true; btn.textContent = 'Saving...';

  // Build the record payload
  const recordPayload = {
    name,
    dob: document.getElementById('g-dob').value || null,
    dod: document.getElementById('g-dod').value || null,
    father: document.getElementById('g-father').value.trim() || null,
    mother: document.getElementById('g-mother').value.trim() || null,
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
      setTimeout(() => { closePanel('add-panel'); resetAddPanel(); }, 2000);
      return;
    } catch (err) {
      showStatus('add-status', `Offline save failed: ${err.message}`, 'error');
      btn.disabled = false; btn.textContent = 'Save Record';
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
    setTimeout(() => { closePanel('add-panel'); resetAddPanel(); }, 1800);

  } catch (err) {
    console.error(err);
    showStatus('add-status', `Save failed: ${err.message}`, 'error');
    btn.disabled = false; btn.textContent = 'Save Record';
  }
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
  } else {
    offroad.classList.remove('show');
  }

  steps.innerHTML = (result.steps || []).map(s =>
    '<div class="nav-step">' +
      '<div>' + s.instruction + '</div>' +
      '<div class="nav-step-dist">' + RRRoute.formatDistance(s.distance) + '</div>' +
    '</div>'
  ).join('');
}

function startNavigation(grave, coords) {
  const btn = document.getElementById('fp-navigate');
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
// FEATURE PANEL
// ══════════════════════════════════════════
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

  // Load photo and audio
  const photoEl = document.getElementById('fp-photo');
  photoEl.style.display = 'none';
  document.getElementById('fp-audio').style.display = 'none';

  const { data: atts } = await sb.from('attachments').select('*').eq('grave_id', grave.id);
  if (atts && atts.length > 0) {
    // Photo
    const photo = atts.find(a => a.file_type === 'photo');
    if (photo) {
      const { data: signedData } = await sb.storage.from('graves-media').createSignedUrl(photo.file_path, 3600);
      if (signedData?.signedUrl) {
        photoEl.src = signedData.signedUrl;
        photoEl.style.display = 'block';
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
  }

  document.getElementById('feature-panel').style.display = 'block';

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

  // Load existing attachments
  loadEditAttachments(grave.id);
  document.getElementById('edit-status').className = 'status';
  document.getElementById('edit-save').textContent = 'Save Changes';
  document.getElementById('edit-save').disabled = false;
  openPanel('edit-panel');
}

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
    row.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:6px 0;border-bottom:1px solid #f0e8d8;';
    const icon = att.file_type === 'photo' ? '🖼' : '📄';
    row.innerHTML = `<span style="font-size:12px;color:var(--dark-brown);">${icon} ${att.file_name}</span>`;
    container.appendChild(row);
  });
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
  if (!confirm(`Delete record for "${grave.person_name}"? This cannot be undone.`)) return;

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
      const bounds = L.latLngBounds(coords.map(c => [c.lat, c.lng]));
      map.fitBounds(bounds, { padding: [40, 40], animate: true, duration: 1 });
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
// LABELS
// ══════════════════════════════════════════
document.getElementById('labels-btn').addEventListener('click', () => {
  const panel = document.getElementById('label-panel');
  const open = panel.style.display === 'block';
  panel.style.display = open ? 'none' : 'block';
  document.getElementById('labels-btn').classList.toggle('active', !open);
});

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
    map.fitBounds(L.latLngBounds(allCoords), { padding: [40, 40], animate: true, duration: 1.2 });
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

const labeledNames = new Set();
function addLabel(name, latlng, color, isSelected) {
  if (!name) return;
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
    if (allCoords.length > 1) map.fitBounds(L.latLngBounds(allCoords), { padding: [40,40] });
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
        father: p.father, mother: p.mother
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
document.getElementById('sync-badge').addEventListener('click', () => {
  if (navigator.onLine) syncPendingRecords();
});

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
document.getElementById('btn-layers').addEventListener('click', () => {
  setTimeout(() => updateCacheSize(), 200);
});

checkAuth();
updateSyncBadge();
// Attempt sync on load if online
if (navigator.onLine) setTimeout(() => syncPendingRecords(), 2500);

}); // end window.addEventListener('load')
