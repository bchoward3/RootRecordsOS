/* generations.js — RootRecords generational drift
 * Exposes window.RRGenerations.
 *
 * Shades graves by when, or by how far down a family line, the person
 * belongs — so that movement across the landscape between generations
 * becomes visible on the map.
 *
 * Two modes, because they answer different questions and are easy to
 * confuse:
 *
 *   LINEAGE — depth from a chosen person, following parent and child
 *   links. Shows one family dispersing. Generation is only meaningful
 *   relative to a root: "generation 3" of one family is not the same
 *   era as "generation 3" of another, so anyone unreachable from the
 *   root gets no shade at all rather than a misleading one.
 *
 *   COHORT — birth decade, ignoring family entirely. Shows the whole
 *   area changing. This is the control: if every cohort drifts the same
 *   direction, the pattern is regional history, not one family's.
 *
 * Both also return mean centres per band and the east-west displacement
 * between the earliest and latest, because an impression of drift and a
 * measured drift are different claims.
 */
(function () {
  'use strict';

  var MILES_PER_DEG_LAT = 69.054;

  /* ---------- lineage depth ---------- */

  /**
   * lineage(persons, rootId) -> { depths: {personId: n}, conflicts }
   *
   * Depth is signed: the root is 0, parents -1, children +1. Breadth
   * first, so where cousin marriage gives a person two different depths
   * the shortest wins; the rest are counted and reported rather than
   * silently picked over.
   */
  function lineage(persons, rootId) {
    if (!window.RRRelate) return null;
    var graph = window.RRRelate.buildGraph(persons || []);
    var rootKey = 'id:' + rootId;
    if (!graph[rootKey]) return null;

    // The graph only stores edges upward, so invert it once to walk down.
    var children = {};
    Object.keys(graph).forEach(function (k) {
      var n = graph[k];
      [n.fatherKey, n.motherKey].forEach(function (pk) {
        if (!pk || !graph[pk]) return;
        if (!children[pk]) children[pk] = [];
        children[pk].push(k);
      });
    });

    var depth = {};
    depth[rootKey] = 0;
    var queue = [rootKey];
    var conflicts = 0;

    while (queue.length) {
      var k = queue.shift();
      var d = depth[k];
      var node = graph[k];
      if (!node) continue;

      [node.fatherKey, node.motherKey].forEach(function (pk) {
        if (!pk || !graph[pk]) return;
        if (depth[pk] === undefined) { depth[pk] = d - 1; queue.push(pk); }
        else if (depth[pk] !== d - 1) conflicts++;
      });
      (children[k] || []).forEach(function (ck) {
        if (depth[ck] === undefined) { depth[ck] = d + 1; queue.push(ck); }
        else if (depth[ck] !== d + 1) conflicts++;
      });
    }

    // Name-only ancestors carry no grave, so only real records matter here.
    var depths = {};
    Object.keys(depth).forEach(function (k) {
      if (k.indexOf('id:') === 0) depths[k.slice(3)] = depth[k];
    });
    return { depths: depths, conflicts: conflicts };
  }

  /* ---------- cohort ---------- */

  // Birth decade. Returns null for a record with no usable year, which
  // is left unshaded rather than guessed at.
  function cohortOf(dob) {
    if (!dob) return null;
    var y = parseInt(String(dob).slice(0, 4), 10);
    if (isNaN(y) || y < 1500 || y > 2200) return null;
    return Math.floor(y / 10) * 10;
  }

  /* ---------- banding and colour ---------- */

  // Dark for the earliest band, pale for the most recent. A sequential
  // ramp, not a rainbow: the variable is ordered, and the shading should
  // say so without a legend.
  function shade(t) {
    var from = [58, 26, 22];    // dark maroon
    var to   = [232, 203, 160]; // pale parchment
    var c = from.map(function (f, i) {
      return Math.round(f + (to[i] - f) * t);
    });
    return 'rgb(' + c.join(',') + ')';
  }

  /**
   * band(points) -> [{ key, label, points, color, meanLat, meanLng, n }]
   * points: [{ key, lat, lng, ... }] where key is the band value
   * (a signed depth, or a decade). Sorted earliest first.
   */
  function band(points) {
    var groups = {};
    points.forEach(function (p) {
      if (p.key === null || p.key === undefined) return;
      if (!groups[p.key]) groups[p.key] = [];
      groups[p.key].push(p);
    });
    var keys = Object.keys(groups).map(Number).sort(function (a, b) { return a - b; });
    var span = Math.max(1, keys.length - 1);

    return keys.map(function (k, i) {
      var pts = groups[k];
      var sumLat = 0, sumLng = 0;
      pts.forEach(function (p) { sumLat += p.lat; sumLng += p.lng; });
      return {
        key: k,
        points: pts,
        n: pts.length,
        color: shade(i / span),
        meanLat: sumLat / pts.length,
        meanLng: sumLng / pts.length
      };
    });
  }

  /* ---------- measurement ---------- */

  /**
   * drift(bands) -> { eastWestMiles, northSouthMiles, totalMiles, from, to }
   *
   * Displacement of the mean centre from the earliest band to the latest.
   * Negative east-west is westward. Reported in miles because that is the
   * unit the question was asked in.
   *
   * This is a description of where the graves are, not of where people
   * lived. Burials cluster in family plots, which pulls the later bands
   * back toward the earlier ones — so a drift that shows up here is
   * likely understated rather than overstated.
   */
  function drift(bands) {
    if (!bands || bands.length < 2) return null;
    var a = bands[0], b = bands[bands.length - 1];
    var midLat = (a.meanLat + b.meanLat) / 2;
    var milesPerDegLng = MILES_PER_DEG_LAT * Math.cos(midLat * Math.PI / 180);
    var ew = (b.meanLng - a.meanLng) * milesPerDegLng;
    var ns = (b.meanLat - a.meanLat) * MILES_PER_DEG_LAT;
    return {
      eastWestMiles: ew,
      northSouthMiles: ns,
      totalMiles: Math.sqrt(ew * ew + ns * ns),
      from: a, to: b
    };
  }

  function describeDrift(d) {
    if (!d) return 'Not enough bands to measure drift.';
    var ew = Math.abs(d.eastWestMiles).toFixed(1) + ' mi ' +
             (d.eastWestMiles < 0 ? 'west' : 'east');
    var ns = Math.abs(d.northSouthMiles).toFixed(1) + ' mi ' +
             (d.northSouthMiles < 0 ? 'south' : 'north');
    return 'Centre of gravity moved ' + ew + ' and ' + ns +
           ' (' + d.totalMiles.toFixed(1) + ' mi overall) from the earliest ' +
           'group to the most recent.';
  }

  // Signed depth as something readable on a legend.
  function depthLabel(d) {
    if (d === 0) return 'the person chosen';
    if (d < 0) return Math.abs(d) + ' generation' + (d === -1 ? '' : 's') + ' before';
    return d + ' generation' + (d === 1 ? '' : 's') + ' after';
  }

  window.RRGenerations = {
    lineage: lineage,
    cohortOf: cohortOf,
    band: band,
    drift: drift,
    describeDrift: describeDrift,
    depthLabel: depthLabel,
    shade: shade
  };
})();
