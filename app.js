
// ══════════════════════════════════════════
// SUPABASE INIT
// ══════════════════════════════════════════
const SUPABASE_URL = 'https://vyuqusttytnvqceoaniz.supabase.co';
const SUPABASE_KEY = 'sb_publishable_gFLrIl6ZcWbWd434sPYUYw_X4Y_jLQn';

const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    storage: window.localStorage,
    storageKey: 'rootrecords-auth',
    detectSessionInUrl: true,
  }
});

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
const labeledNames = new Set();

window.addEventListener('load', () => {

// ══════════════════════════════════════════
// MAP INIT
// ══════════════════════════════════════════
map = L.map('map', { zoomControl: true }).setView([37.8, -85.3], 7);

const basemaps = {
  voyager: L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
    attribution: '© CartoDB © OpenStreetMap', maxZoom: 19
  }),
  light: L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
    attribution: '© CartoDB © OpenStreetMap', maxZoom: 19
  }),
  osm: L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap', maxZoom: 19
  }),
  satellite: L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    attribution: '© Esri', maxZoom: 19
  }),
  toner: L.tileLayer('https://stamen-tiles.a.ssl.fastly.net/toner-lite/{z}/{x}/{y}.png', {
    attribution: '© Stamen © OpenStreetMap', maxZoom: 19
  })
};

// Apply sepia CSS filter to map tiles
const style = document.createElement('style');
style.textContent = '.leaflet-tile-pane { filter: sepia(15%) brightness(100%) contrast(100%); }';
document.head.appendChild(style);

basemaps.voyager.addTo(map);
let currentBasemap = 'voyager';

// Grave marker style
const graveIcon = L.icon({
  // Attribution: grave icon courtsey of Abdul Matic from the Noun Project
  iconUrl: 'grave.png',
  iconSize: [25, 28],
  iconAnchor: [10, 28]
});

// Graphics layers
gravesLayer = L.layerGroup().addTo(map);
lineageLayer = L.layerGroup().addTo(map);
labelsLayer = L.layerGroup().addTo(map);

// ══════════════════════════════════════════
// AUTH
// ══════════════════════════════════════════
async function checkAuth() {
  // Listen for auth state changes first
  sb.auth.onAuthStateChange((event, session) => {
    if (session) {
      setUser(session.user);
    } else if (event === 'SIGNED_OUT') {
      currentUser = null;
      document.getElementById('login-btn').style.display = 'block';
      document.getElementById('user-indicator').style.display = 'none';
      showAuthModal();
    }
  });

  // Then check for existing session
  const { data: { session } } = await sb.auth.getSession();
  if (session) {
    setUser(session.user);
  } else {
    showAuthModal();
    await loadGraves();
  }
}

function setUser(user) {
  currentUser = user;
  document.getElementById('auth-modal').classList.add('hidden');
  document.getElementById('login-btn').style.display = 'none';
  document.getElementById('user-indicator').style.display = 'flex';
  document.getElementById('user-email-display').textContent = user.email;
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
document.getElementById('logout-btn').addEventListener('click', async () => {
  await sb.auth.signOut();
  currentUser = null;
  document.getElementById('login-btn').style.display = 'block';
  document.getElementById('user-indicator').style.display = 'none';
  showAuthModal();
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
  console.log('Rendering graves:', currentGraves.length, currentGraves);
  const graves = filter
    ? currentGraves.filter(g => g.person_name?.toLowerCase().includes(filter.toLowerCase()))
    : currentGraves;

  graves.forEach(g => {
    if (!g.location) return;
    const coords = parseLocation(g.location);
    if (!coords) return;
    const marker = L.marker([coords.lat, coords.lng], { icon: graveIcon });
    marker.on('click', () => openFeaturePanel(g));
    marker.addTo(gravesLayer);
  });
}

function parseLocation(loc) {
  if (!loc) return null;
  // GeoJSON format from Supabase: {"type":"Point","coordinates":[lng, lat]}
  if (typeof loc === 'object' && loc.type === 'Point' && loc.coordinates) {
    return { lat: loc.coordinates[1], lng: loc.coordinates[0] };
  }
  // String GeoJSON
  if (typeof loc === 'string' && loc.startsWith('{')) {
    try {
      const parsed = JSON.parse(loc);
      if (parsed.coordinates) return { lat: parsed.coordinates[1], lng: parsed.coordinates[0] };
    } catch(e) {}
  }
  // WKT format: POINT(lng lat)
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
document.getElementById('edit-close').addEventListener('click', () => closePanel('edit-panel'));
document.getElementById('edit-cancel').addEventListener('click', () => closePanel('edit-panel'));

// Layer toggle
document.getElementById('toggle-graves').addEventListener('change', e => {
  if (e.target.checked) gravesLayer.addTo(map);
  else map.removeLayer(gravesLayer);
});

// ══════════════════════════════════════════
// ADD GRAVE WORKFLOW
// ══════════════════════════════════════════
function showStep(n) {
  ['step1-content','step2-content','step3-content'].forEach((id, i) => {
    document.getElementById(id).style.display = i + 1 === n ? 'block' : 'none';
  });
  ['s1','s2','s3'].forEach((id, i) => {
    const el = document.getElementById(id);
    el.className = 'step' + (i + 1 < n ? ' done' : i + 1 === n ? ' active' : '');
  });
}

function resetAddPanel() {
  placedPoint = null;
  if (mapClickHandler) { map.off('click', mapClickHandler); mapClickHandler = null; }
  document.getElementById('click-banner').style.display = 'none';
  document.getElementById('coord-display').textContent = '';
  ['g-name','g-dob','g-dod','g-father','g-mother','g-cemetery','g-county','g-notes'].forEach(id => {
    document.getElementById(id).value = '';
  });
  document.getElementById('g-state').value = 'KY';
  document.getElementById('g-attachment').value = '';
  document.getElementById('attachment-name').textContent = '';
  document.getElementById('add-status').className = 'status';
  document.getElementById('save-grave').textContent = 'Save Record';
  document.getElementById('save-grave').disabled = false;
  showStep(1);
}

document.getElementById('step1-next').addEventListener('click', async () => {
  showStep(2);
  document.getElementById('click-banner').style.display = 'block';
  await populateCemeteryDropdown();
  startMapClick();
});

document.getElementById('step2-back').addEventListener('click', () => {
  if (mapClickHandler) { map.off('click', mapClickHandler); mapClickHandler = null; }
  document.getElementById('click-banner').style.display = 'none';
  showStep(1);
});

document.getElementById('step3-back').addEventListener('click', () => {
  placedPoint = null;
  document.getElementById('click-banner').style.display = 'block';
  showStep(2);
  startMapClick();
});

function startMapClick() {
  if (mapClickHandler) map.off('click', mapClickHandler);
  mapClickHandler = (e) => {
    placedPoint = e.latlng;
    document.getElementById('coord-display').textContent = `📍 ${placedPoint.lat.toFixed(5)}, ${placedPoint.lng.toFixed(5)}`;
    document.getElementById('click-banner').style.display = 'none';
    map.off('click', mapClickHandler); mapClickHandler = null;
    showStep(3);
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
    if (mapClickHandler) { map.off('click', mapClickHandler); mapClickHandler = null; }
    map.setView([coords.lat, coords.lng], 16, { animate: true, duration: 1.2 });
    // Pre-fill cemetery fields
    document.getElementById('g-cemetery').value = name;
    const county = grave.county || '';
    const state = grave.state || 'KY';
    document.getElementById('g-county').value = county;
    document.getElementById('g-state').value = state;
  }
});

// Attachment name display
document.getElementById('g-attachment').addEventListener('change', e => {
  const f = e.target.files[0];
  document.getElementById('attachment-name').textContent = f ? `📄 ${f.name}` : '';
});

// Save grave
document.getElementById('save-grave').addEventListener('click', async () => {
  if (!placedPoint) { showStatus('add-status', 'No location set. Go back and tap the map.', 'error'); return; }
  const name = document.getElementById('g-name').value.trim();
  if (!name) { showStatus('add-status', 'Person name is required.', 'error'); return; }

  const btn = document.getElementById('save-grave');
  btn.disabled = true; btn.textContent = 'Saving...';

  try {
    // 1. Create person record
    const personData = {
      name,
      dob: document.getElementById('g-dob').value || null,
      dod: document.getElementById('g-dod').value || null,
      father: document.getElementById('g-father').value.trim() || null,
      mother: document.getElementById('g-mother').value.trim() || null,
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

    // 3. Upload attachment if selected
    const file = document.getElementById('g-attachment').files[0];
    if (file) {
      const path = `photos/${grave.id}/${Date.now()}_${file.name}`;
      const { error: upErr } = await sb.storage.from('graves-media').upload(path, file);
      if (!upErr) {
        await sb.from('attachments').insert({
          grave_id: grave.id, person_id: person.id,
          file_name: file.name, file_path: path,
          file_type: file.type.startsWith('image/') ? 'photo' : 'document',
          file_size: file.size, mime_type: file.type
        });
      }
    }

    showStatus('add-status', `✓ Record saved for ${name}`, 'success');
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
// FEATURE PANEL
// ══════════════════════════════════════════
async function openFeaturePanel(grave) {
  closeAllPanels();
  editingGrave = grave;
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

  // Load photo
  const photoEl = document.getElementById('fp-photo');
  photoEl.style.display = 'none';
  const { data: atts } = await sb.from('attachments').select('*').eq('grave_id', grave.id);
  if (atts && atts.length > 0) {
    const photo = atts.find(a => a.file_type === 'photo');
    if (photo) {
      const { data: url } = sb.storage.from('graves-media').getPublicUrl(photo.file_path);
      photoEl.src = url.publicUrl;
      photoEl.style.display = 'block';
    }
  }

  document.getElementById('feature-panel').style.display = 'block';

  // Zoom to grave
  const coords = parseLocation(grave.location);
  if (coords) map.setView([coords.lat, coords.lng], 15, { animate: true, duration: 1 });

  // Action buttons
  document.getElementById('fp-edit').onclick = () => openEditPanel(grave);
  document.getElementById('fp-move').onclick = () => startMoveMode(grave);
  document.getElementById('fp-delete').onclick = () => deleteGrave(grave);
}

// ══════════════════════════════════════════
// EDIT PANEL
// ══════════════════════════════════════════
function openEditPanel(grave) {
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
  if (!confirm(`Delete record for "${grave.person_name}"? This cannot be undone.`)) return;
  await sb.from('graves').delete().eq('id', grave.id);
  document.getElementById('feature-panel').style.display = 'none';
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
  list.innerHTML = '';
  (data || []).forEach(p => {
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
  if (!data || data.length === 0) {
    list.innerHTML = '<div style="padding:10px;font-size:11px;color:var(--brown);">No records yet.</div>';
  }
});

document.getElementById('clear-filter-btn').addEventListener('click', () => {
  currentFilterName = null; currentFilterId = null;
  document.getElementById('filter-active').style.display = 'none';
  document.getElementById('web-legend').style.display = 'none';
  document.getElementById('filter-search').value = '';
  lineageLayer.clearLayers();
  labelsLayer.clearLayers();
  renderGraves();
  map.setView([37.8, -85.3], 7, { animate: true, duration: 1 });
});

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

document.getElementById('trace-btn').addEventListener('click', async () => {
  if (!currentFilterName) return;
  const btn = document.getElementById('trace-btn');
  btn.disabled = true; btn.textContent = '⬡ Tracing...';
  await traceFromPerson(currentFilterName);
  btn.disabled = false;
  btn.textContent = '⬡ Trace Family Web';
  document.getElementById('web-legend').style.display = 'block';
});

async function traceFromPerson(startName) {
  lineageLayer.clearLayers();
  labelsLayer.clearLayers();
  labeledNames.clear();

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
    const marker = L.marker([coords.lat, coords.lng], { icon: graveIcon });
    marker.on('click', () => openFeaturePanel(g));
    marker.addTo(gravesLayer);
  });
}

const labeledNames = new Set();
function addLabel(name, latlng, color, isSelected) {
  if (!name) return;
  const display = name.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  if (labeledNames.has(display)) return;
  labeledNames.add(display);
  const c = isSelected ? '#e8d5b0' : `rgba(${color[0]},${color[1]},${color[2]},0.9)`;
  const bg = isSelected ? '#1a1a2e' : 'white';
  const icon = L.divIcon({
    className: '',
    html: `<div style="background:${bg};color:${c};padding:2px 6px;border-radius:2px;font-size:10px;font-family:Georgia,serif;white-space:nowrap;border:1px solid rgba(${color[0]},${color[1]},${color[2]},0.4);box-shadow:0 1px 4px rgba(0,0,0,0.2);">${display}</div>`,
    iconAnchor: [-4, 6]
  });
  L.marker(latlng, { icon, interactive: false, zIndexOffset: -100 }).addTo(labelsLayer);
}

// ══════════════════════════════════════════
// SHOW ALL FAMILY WEB
// ══════════════════════════════════════════
async function buildFullWeb() {
  lineageLayer.clearLayers();
  labelsLayer.clearLayers();
  labeledNames.clear();
  const btn = document.getElementById('btn-web');
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
  btn.classList.toggle('active');

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
window.addEventListener('online', () => { document.getElementById('offline-banner').style.display = 'none'; });
window.addEventListener('offline', () => { document.getElementById('offline-banner').style.display = 'block'; });
if (!navigator.onLine) document.getElementById('offline-banner').style.display = 'block';

// Close basemap panel on map click
map.on('click', () => { document.getElementById('basemap-panel').style.display = 'none'; });

// ══════════════════════════════════════════
// INIT
// ══════════════════════════════════════════
checkAuth();

}); // end window.addEventListener('load')
