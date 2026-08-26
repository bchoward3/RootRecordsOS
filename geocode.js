/* geocode.js — RootRecords place search
 * Exposes window.RRGeo.
 *
 * Searches the user's own records first — this works offline and covers the
 * many cemeteries that have no postal address at all — then falls back to
 * Nominatim for addresses and place names.
 *
 * Why Nominatim and not OpenRouteService: HeiGIT's Pelias geocoder sends no
 * Access-Control-Allow-Origin header, so a browser blocks the response before
 * the app ever sees it. Nominatim sets CORS headers and needs no API key.
 */
(function () {
  'use strict';

  var NOMINATIM = 'https://nominatim.openstreetmap.org/search';

  // Prefer results in eastern Kentucky: left,top,right,bottom
  // bounded=0 means "prefer", not "restrict" — searching Savannah still works.
  var VIEWBOX = '-84.6,38.9,-81.9,37.1';

  // Nominatim's usage policy allows at most 1 request/second. Browsers can't
  // set User-Agent, but the Referer header GitHub Pages sends identifies us.
  var MIN_INTERVAL_MS = 1100;
  var lastCall = 0;

  function normalize(s) {
    return (s || '').toString().trim().toLowerCase();
  }

  /* ---------- local records ---------- */

  function searchRecords(query, graves) {
    var q = normalize(query);
    if (!q || !graves || !graves.length) return [];
    var seen = {};
    var out = [];

    graves.forEach(function (g) {
      var hit = [g.cemetery_name, g.address, g.city, g.county, g.person_name]
        .some(function (f) { return normalize(f).indexOf(q) !== -1; });
      if (!hit) return;

      // Group by cemetery so ten graves in one place give one result.
      var key = normalize(g.cemetery_name) || ('grave:' + g.id);
      if (seen[key]) { seen[key].count++; return; }

      var entry = {
        source: 'record',
        label: g.cemetery_name || g.person_name || 'Untitled record',
        detail: [g.city, g.county, g.state].filter(Boolean).join(', '),
        lat: null,
        lng: null,
        count: 1,
        grave: g
      };
      seen[key] = entry;
      out.push(entry);
    });

    return out;
  }

  /* ---------- geocoder ---------- */

  function parseResults(json) {
    if (!Array.isArray(json)) return [];
    return json.map(function (r) {
      // display_name is long; first part is the label, the next few give
      // context, so results stay readable in a narrow panel.
      var parts = (r.display_name || '').split(',').map(function (p) {
        return p.trim();
      });
      return {
        source: 'geocode',
        label: r.name || parts[0] || 'Unnamed place',
        detail: parts.slice(1, 4).join(', '),
        lat: parseFloat(r.lat),
        lng: parseFloat(r.lon),
        count: 0,
        grave: null
      };
    }).filter(function (r) {
      return !isNaN(r.lat) && !isNaN(r.lng);
    });
  }

  function geocode(query) {
    if (!navigator.onLine) return Promise.resolve([]);

    var wait = Math.max(0, MIN_INTERVAL_MS - (Date.now() - lastCall));

    return new Promise(function (resolve) {
      setTimeout(resolve, wait);
    }).then(function () {
      lastCall = Date.now();
      var url = NOMINATIM +
        '?q=' + encodeURIComponent(query) +
        '&format=jsonv2' +
        '&countrycodes=us' +
        '&viewbox=' + VIEWBOX +
        '&bounded=0' +
        '&addressdetails=0' +
        '&limit=6';
      return fetch(url, { headers: { 'Accept': 'application/json' } })
        .then(function (res) {
          if (!res.ok) throw new Error('HTTP ' + res.status);
          return res.json();
        })
        .then(parseResults)
        .catch(function (e) {
          console.warn('[geocode] lookup failed:', e.message);
          return [];
        });
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
