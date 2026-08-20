/* route.js — RootRecords routing module
 * Exposes window.RRRoute. No Leaflet-dependent code runs at load time;
 * the map instance is passed in via RRRoute.init(map).
 *
 * Strategy: ORS driving-car route to the nearest routable point, then a
 * visually distinct bearing-and-distance leg for the last stretch when OSM
 * has no road to the cemetery. Offline, skips ORS and goes straight to the
 * bearing leg.
 */
(function () {
  'use strict';

  var ORS_KEY = 'eyJvcmciOiI1YjNjZTM1OTc4NTExMTAwMDFjZjYyNDgiLCJpZCI6Ijg2YzE4NGQyOTU2MjRhNzU4N2FmM2I1MjZmNGU2M2M0IiwiaCI6Im11cm11cjY0In0=';
  var ORS_URL = 'https://api.heigit.org/openrouteservice/v2/directions/driving-car';

  // How far the route's end can sit from the grave before we draw a final
  // bearing leg. ORS snaps to the nearest road, so anything beyond this is
  // road network that doesn't actually reach the site.
  var SNAP_TOLERANCE_M = 50;

  var map = null;
  var routeLayer = null;   // solid — real roads
  var fallbackLayer = null; // dashed — not a road
  var endMarker = null;

  /* ---------- geodesy ---------- */

  function toRad(d) { return d * Math.PI / 180; }
  function toDeg(r) { return r * 180 / Math.PI; }

  function haversineM(a, b) {
    var R = 6371000;
    var dLat = toRad(b.lat - a.lat);
    var dLng = toRad(b.lng - a.lng);
    var la1 = toRad(a.lat), la2 = toRad(b.lat);
    var h = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return 2 * R * Math.asin(Math.sqrt(h));
  }

  function bearingDeg(a, b) {
    var la1 = toRad(a.lat), la2 = toRad(b.lat);
    var dLng = toRad(b.lng - a.lng);
    var y = Math.sin(dLng) * Math.cos(la2);
    var x = Math.cos(la1) * Math.sin(la2) - Math.sin(la1) * Math.cos(la2) * Math.cos(dLng);
    return (toDeg(Math.atan2(y, x)) + 360) % 360;
  }

  var COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
                 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];

  function compassPoint(deg) {
    return COMPASS[Math.round(deg / 22.5) % 16];
  }

  function formatDistance(m) {
    if (m < 1000) return Math.round(m) + ' m';
    return (m / 1000).toFixed(1) + ' km';
  }

  function formatFeet(m) {
    var ft = m * 3.28084;
    if (ft < 1000) return Math.round(ft / 10) * 10 + ' ft';
    return (ft / 5280).toFixed(2) + ' mi';
  }

  function formatDuration(s) {
    var min = Math.round(s / 60);
    if (min < 60) return min + ' min';
    return Math.floor(min / 60) + ' hr ' + (min % 60) + ' min';
  }

  /* ---------- position ---------- */

  function getPosition() {
    return new Promise(function (resolve, reject) {
      if (!navigator.geolocation) {
        reject(new Error('This device has no location services.'));
        return;
      }
      navigator.geolocation.getCurrentPosition(
        function (p) {
          resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy });
        },
        function (err) {
          if (err.code === 1) reject(new Error('Location is turned off for this site. Enable it in Settings \u2192 Safari \u2192 Location.'));
          else if (err.code === 3) reject(new Error('Could not get a GPS fix. Move to open sky and try again.'));
          else reject(new Error('Could not read your location.'));
        },
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 }
      );
    });
  }

  /* ---------- ORS ---------- */

  function fetchRoute(from, to) {
    var url = ORS_URL +
      '?api_key=' + encodeURIComponent(ORS_KEY) +
      '&start=' + from.lng + ',' + from.lat +
      '&end=' + to.lng + ',' + to.lat;

    return fetch(url).then(function (res) {
      if (res.status === 429) throw new Error('QUOTA');
      if (!res.ok) {
        return res.json().catch(function () { return null; }).then(function (body) {
          // 2010 = no routable point within search radius. Expected out here.
          var code = body && body.error && body.error.code;
          if (code === 2010 || res.status === 404) throw new Error('NOROUTE');
          throw new Error('ORSFAIL');
        });
      }
      return res.json();
    });
  }

  function parseRoute(geojson) {
    var f = geojson && geojson.features && geojson.features[0];
    if (!f || !f.geometry || !f.geometry.coordinates || !f.geometry.coordinates.length) {
      throw new Error('NOROUTE');
    }
    var coords = f.geometry.coordinates.map(function (c) {
      return { lat: c[1], lng: c[0] };
    });
    var seg = f.properties && f.properties.segments && f.properties.segments[0];
    return {
      coords: coords,
      distance: (f.properties && f.properties.summary && f.properties.summary.distance) || 0,
      duration: (f.properties && f.properties.summary && f.properties.summary.duration) || 0,
      steps: (seg && seg.steps) || []
    };
  }

  /* ---------- drawing ---------- */

  function clear() {
    if (!map) return;
    [routeLayer, fallbackLayer, endMarker].forEach(function (l) {
      if (l) map.removeLayer(l);
    });
    routeLayer = fallbackLayer = endMarker = null;
  }

  function drawRoute(coords) {
    var latlngs = coords.map(function (c) { return [c.lat, c.lng]; });
    // Casing underneath so the road line reads clearly on satellite basemaps.
    routeLayer = L.layerGroup([
      L.polyline(latlngs, { color: '#1e3a5f', weight: 9, opacity: 0.55, lineCap: 'round' }),
      L.polyline(latlngs, { color: '#2f7fd4', weight: 5, opacity: 0.95, lineCap: 'round' })
    ]).addTo(map);
  }

  function drawFallbackLeg(from, to, bearing, dist) {
    // Deliberately not road-like: dotted, warm, square caps, no casing.
    var line = L.polyline([[from.lat, from.lng], [to.lat, to.lng]], {
      color: '#b45309',
      weight: 4,
      opacity: 0.95,
      dashArray: '1,9',
      lineCap: 'round'
    });
    var mid = { lat: (from.lat + to.lat) / 2, lng: (from.lng + to.lng) / 2 };
    var label = L.marker([mid.lat, mid.lng], {
      interactive: false,
      icon: L.divIcon({
        className: 'rr-offroad-label',
        html: '<span>' + compassPoint(bearing) + ' \u00b7 ' +
              Math.round(bearing) + '\u00b0 \u00b7 ' + formatFeet(dist) + '</span>',
        iconSize: [0, 0]
      })
    });
    fallbackLayer = L.layerGroup([line, label]).addTo(map);
  }

  /* ---------- public ---------- */

  function init(leafletMap) {
    map = leafletMap;
  }

  /**
   * navigateTo(dest, handlers)
   * dest: { lat, lng, name }
   * handlers: { onStatus(msg), onResult(result), onError(msg) }
   *
   * result = {
   *   mode: 'road' | 'road+offroad' | 'offroad',
   *   distance, duration, steps[],
   *   offroad: null | { bearing, compass, distance }
   * }
   */
  function navigateTo(dest, handlers) {
    handlers = handlers || {};
    var status = handlers.onStatus || function () {};
    var done = handlers.onResult || function () {};
    var fail = handlers.onError || function () {};

    clear();
    status('Getting your location\u2026');

    getPosition().then(function (from) {
      var direct = haversineM(from, dest);

      // No signal: don't wait on a fetch that can't succeed.
      if (!navigator.onLine) {
        var b = bearingDeg(from, dest);
        drawFallbackLeg(from, dest, b, direct);
        map.fitBounds(L.latLngBounds([[from.lat, from.lng], [dest.lat, dest.lng]]), { padding: [50, 50] });
        done({
          mode: 'offroad',
          distance: direct,
          duration: null,
          steps: [],
          offroad: { bearing: b, compass: compassPoint(b), distance: direct },
          note: 'Offline \u2014 showing straight-line bearing only.'
        });
        return;
      }

      status('Finding a route\u2026');

      return fetchRoute(from, dest).then(function (json) {
        var r = parseRoute(json);
        var end = r.coords[r.coords.length - 1];
        var gap = haversineM(end, dest);

        drawRoute(r.coords);

        var offroad = null;
        if (gap > SNAP_TOLERANCE_M) {
          var b2 = bearingDeg(end, dest);
          drawFallbackLeg(end, dest, b2, gap);
          offroad = { bearing: b2, compass: compassPoint(b2), distance: gap };
        }

        var bounds = L.latLngBounds(r.coords.map(function (c) { return [c.lat, c.lng]; }));
        bounds.extend([dest.lat, dest.lng]);
        map.fitBounds(bounds, { padding: [50, 50] });

        done({
          mode: offroad ? 'road+offroad' : 'road',
          distance: r.distance,
          duration: r.duration,
          steps: r.steps,
          offroad: offroad
        });
      }).catch(function (e) {
        if (e.message === 'QUOTA') {
          fail('Routing quota reached for today. Bearing and distance still work offline.');
          return;
        }
        if (e.message === 'NOROUTE' || e.message === 'ORSFAIL') {
          // No mapped road reaches this. Straight line from where you stand.
          var b3 = bearingDeg(from, dest);
          drawFallbackLeg(from, dest, b3, direct);
          map.fitBounds(L.latLngBounds([[from.lat, from.lng], [dest.lat, dest.lng]]), { padding: [50, 50] });
          done({
            mode: 'offroad',
            distance: direct,
            duration: null,
            steps: [],
            offroad: { bearing: b3, compass: compassPoint(b3), distance: direct },
            note: 'No mapped road reaches this site.'
          });
          return;
        }
        fail('Could not reach the routing service. Check your connection and try again.');
      });
    }).catch(function (e) {
      fail(e.message || 'Navigation failed.');
    });
  }

  window.RRRoute = {
    init: init,
    navigateTo: navigateTo,
    clear: clear,
    formatDistance: formatDistance,
    formatFeet: formatFeet,
    formatDuration: formatDuration,
    compassPoint: compassPoint
  };
})();
