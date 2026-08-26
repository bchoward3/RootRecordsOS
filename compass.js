/* compass.js — RootRecords walk-in guidance
 * Exposes window.RRCompass.
 *
 * Live bearing and distance to a target while walking. Uses GPS for position
 * and the magnetometer for which way the phone is pointing, so the arrow
 * points where to walk rather than just where north is.
 *
 * Works fully offline — both are hardware sensors, no network involved. This
 * is the mode that matters in a holler where routing has already given up.
 */
(function () {
  'use strict';

  var watchId = null;
  var target = null;
  var heading = null;      // degrees clockwise from true north, or null
  var lastFix = null;
  var wakeLock = null;
  var onUpdate = null;
  var orientationBound = false;

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

  var COMPASS = ['N','NNE','NE','ENE','E','ESE','SE','SSE',
                 'S','SSW','SW','WSW','W','WNW','NW','NNW'];
  function compassPoint(d) { return COMPASS[Math.round(d / 22.5) % 16]; }

  /* ---------- sensors ---------- */

  function handleOrientation(e) {
    // iOS exposes a true-north heading directly. Elsewhere, alpha is only
    // usable when absolute orientation is reported.
    if (typeof e.webkitCompassHeading === 'number' && !isNaN(e.webkitCompassHeading)) {
      heading = e.webkitCompassHeading;
    } else if (e.absolute && typeof e.alpha === 'number') {
      heading = (360 - e.alpha) % 360;
    }
    emit();
  }

  function handlePosition(pos) {
    lastFix = {
      lat: pos.coords.latitude,
      lng: pos.coords.longitude,
      accuracy: pos.coords.accuracy
    };
    emit();
  }

  function emit() {
    if (!onUpdate || !target || !lastFix) return;
    var bearing = bearingDeg(lastFix, target);
    var distance = haversineM(lastFix, target);
    onUpdate({
      bearing: bearing,
      compass: compassPoint(bearing),
      distance: distance,
      accuracy: lastFix.accuracy,
      heading: heading,
      // Rotation for the arrow. With a heading we can point at the target
      // relative to how the phone is held; without one, relative to north.
      arrow: heading === null ? bearing : (bearing - heading + 360) % 360,
      hasHeading: heading !== null,
      arrived: distance <= Math.max(10, lastFix.accuracy || 10)
    });
  }

  /* ---------- permission ---------- */

  // iOS 13+ requires an explicit grant, and it must be requested from inside
  // a user gesture — so this has to be called straight from a tap handler.
  function requestOrientation() {
    var DOE = window.DeviceOrientationEvent;
    if (!DOE) return Promise.resolve(false);

    if (typeof DOE.requestPermission === 'function') {
      return DOE.requestPermission()
        .then(function (state) { return state === 'granted'; })
        .catch(function () { return false; });
    }
    return Promise.resolve(true);
  }

  function bindOrientation() {
    if (orientationBound) return;
    window.addEventListener('deviceorientation', handleOrientation, true);
    orientationBound = true;
  }

  /* ---------- wake lock ---------- */

  function acquireWakeLock() {
    if (!navigator.wakeLock) return;
    navigator.wakeLock.request('screen').then(function (lock) {
      wakeLock = lock;
    }).catch(function () { /* denied or unsupported — not fatal */ });
  }

  function releaseWakeLock() {
    if (wakeLock) { wakeLock.release().catch(function () {}); wakeLock = null; }
  }

  /* ---------- public ---------- */

  /**
   * start(dest, handlers)
   * dest: { lat, lng, name }
   * handlers: { onUpdate(state), onError(msg), onReady(hasHeading) }
   * Must be called from a user gesture for the iOS compass permission.
   */
  function start(dest, handlers) {
    handlers = handlers || {};
    stop();

    target = dest;
    onUpdate = handlers.onUpdate || null;
    heading = null;
    lastFix = null;

    if (!navigator.geolocation) {
      if (handlers.onError) handlers.onError('This device has no location services.');
      return;
    }

    requestOrientation().then(function (granted) {
      if (granted) bindOrientation();
      if (handlers.onReady) handlers.onReady(granted);
    });

    watchId = navigator.geolocation.watchPosition(
      handlePosition,
      function (err) {
        if (!handlers.onError) return;
        if (err.code === 1) handlers.onError('Location permission denied.');
        else if (err.code === 3) handlers.onError('Waiting for a GPS fix\u2026');
        else handlers.onError('Could not read your location.');
      },
      { enableHighAccuracy: true, maximumAge: 1000, timeout: 20000 }
    );

    acquireWakeLock();
  }

  function stop() {
    if (watchId !== null) { navigator.geolocation.clearWatch(watchId); watchId = null; }
    if (orientationBound) {
      window.removeEventListener('deviceorientation', handleOrientation, true);
      orientationBound = false;
    }
    releaseWakeLock();
    target = null; onUpdate = null; heading = null; lastFix = null;
  }

  function isRunning() { return watchId !== null; }

  window.RRCompass = {
    start: start,
    stop: stop,
    isRunning: isRunning,
    compassPoint: compassPoint
  };
})();
