/* geocode.js — RootRecords place search
 * Exposes window.RRGeo.
 *
 * Searches the user's own records first (works offline, and covers the many
 * cemeteries with no postal address), then falls back to the Pelias geocoder
 * on HeiGIT's public API using the same key as routing.
 */
(function () {
  'use strict';

  var ORS_KEY = 'eyJvcmciOiI1YjNjZTM1OTc4NTExMTAwMDFjZjYyNDgiLCJpZCI6Ijg2YzE4NGQyOTU2MjRhNzU4N2FmM2I1MjZmNGU2M2M0IiwiaCI6Im11cm11cjY0In0=';

  // Geocoding is a separate service from openrouteservice on the same API,
  // so the path prefix differs from /openrouteservice/v2/directions. Try the
  // prefixed form first, fall back to the bare one, remember what worked.
  var GEO_PATHS = [
    'https://api.heigit.org/openrouteservice/geocode/search',
    'https://api.heigit.org/geocode/search'
  ];
  var workingPath = null;

  // Bias results toward eastern Kentucky.
  var FOCUS = { lat: 37.9, lng: -83.2 };

  function normalize(s) {
    return (s || '').toString().trim().toLowerCase();
  }

  /* ---------- local records ---------- */

  function searchRecords(query, graves) {
    var q = normalize(query);
    if (!q || !graves) return [];
    var seen = {};
    var out = [];

    graves.forEach(function (g) {
      var fields = [g.cemetery_name, g.address, g.city, g.county];
      var hit = fields.some(function (f) { return normalize(f).indexOf(q) !== -1; });
      if (!hit) return;

      // Group by cemetery so ten graves in one place give one result.
      var key = normalize(g.cemetery_name) || ('grave:' + g.id);
      if (seen[key]) { seen[key].count++; return; }

      var entry = {
        source: 'record',
        label: g.cemetery_name || g.person_name || 'Untitled record',
        detail: [g.city, g.county, g.state].filter(Boolean).join(', '),
        lat: null, lng: null,
        count: 1,
        grave: g
      };
      seen[key] = entry;
      out.push(entry);
    });

    return out;
  }

  /* ---------- geocoder ---------- */

  function parseFeatures(json) {
    var feats = (json && json.features) || [];
    return feats.map(function (f) {
      var p = f.properties || {};
      var c = (f.geometry && f.geometry.coordinates) || [];
      return {
        source: 'geocode',
        label: p.name || p.label || 'Unnamed place',
        detail: [p.locality, p.region, p.country].filter(Boolean).join(', '),
        lat: c[1],
        lng: c[0],
        count: 0,
        grave: null
      };
    }).filter(function (r) {
      return typeof r.lat === 'number' && typeof r.lng === 'number';
    });
  }

  function tryPath(url, query) {
    var full = url +
      '?api_key=' + encodeURIComponent(ORS_KEY) +
      '&text=' + encodeURIComponent(query) +
      '&boundary.country=US' +
      '&focus.point.lat=' + FOCUS.lat +
      '&focus.point.lon=' + FOCUS.lng +
      '&size=6';
    return fetch(full).then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    });
  }

  function geocode(query) {
    if (!navigator.onLine) return Promise.resolve([]);

    var paths = workingPath ? [workingPath] : GEO_PATHS;

    return tryPath(paths[0], query)
      .then(function (json) { workingPath = paths[0]; return parseFeatures(json); })
      .catch(function () {
        if (paths.length < 2) return [];
        return tryPath(paths[1], query)
          .then(function (json) { workingPath = paths[1]; return parseFeatures(json); })
          .catch(function () { return []; });
      });
  }

  /* ---------- combined ---------- */

  function search(query, graves) {
    var local = searchRecords(query, graves);
    return geocode(query).then(function (remote) {
      return { local: local, remote: remote, offline: !navigator.onLine };
    });
  }

  window.RRGeo = {
    search: search,
    searchRecords: searchRecords,
    geocode: geocode
  };
})();
