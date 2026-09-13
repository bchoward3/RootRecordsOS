/* pedigree.js — RootRecords pedigree chart
 * Exposes window.RRPedigree.
 *
 * Ancestors only, from one person upward. This is deliberately a much
 * smaller problem than a family tree view: every person has exactly two
 * parent slots, so positions are fixed by arithmetic and no layout
 * algorithm is needed. Ahnentafel numbering — the root is 1, and slot n's
 * father is 2n, mother 2n+1 — puts every ancestor in one predictable place.
 *
 * The graph comes from relate.js, so this inherits the two properties that
 * matter with these records: parent links resolve through father_id first
 * and fall back to the plain-text father name, and ancestors known only as
 * a name are real nodes rather than dead air.
 *
 * The honesty problem specific to this format:
 *
 *   A pedigree chart has 2^n slots per generation and fills them by
 *   duplication. In a population where cousins married, one person
 *   legitimately occupies several slots. A chart showing sixteen
 *   great-great-grandparents may be showing thirteen people. Presented
 *   without comment that is a quietly false claim about how many
 *   ancestors someone had, so repeats are detected and marked rather
 *   than silently drawn twice.
 */
(function () {
  'use strict';

  var MAX_GENERATIONS = 6;

  /**
   * build(persons, rootId, generations) -> result
   *
   * result = {
   *   ok, reason,
   *   generations,
   *   slots: { <ahnentafel>: { key, node, gen, ahnentafel, repeatGroup } },
   *   filled, possible, distinct,
   *   repeats: [ { key, name, slots: [n, n, ...] } ],
   *   deadEnds: [ { name, gen, ahnentafel } ]
   * }
   */
  function build(persons, rootId, generations) {
    if (!window.RRRelate) return { ok: false, reason: 'relate-missing' };

    var gens = Math.min(Math.max(parseInt(generations, 10) || 4, 1), MAX_GENERATIONS);
    var graph = window.RRRelate.buildGraph(persons || []);
    var rootKey = 'id:' + rootId;
    if (!graph[rootKey]) return { ok: false, reason: 'root-missing' };

    var slots = {};

    // No cycle guard beyond the depth cap. A person who is their own
    // ancestor is a data error, and the cap stops it from running away;
    // suppressing it silently would hide the error instead.
    function place(key, n, gen) {
      if (!key || !graph[key] || gen > gens) return;
      slots[n] = {
        key: key,
        node: graph[key],
        gen: gen,
        ahnentafel: n,
        repeatGroup: 0
      };
      place(graph[key].fatherKey, n * 2, gen + 1);
      place(graph[key].motherKey, n * 2 + 1, gen + 1);
    }
    place(rootKey, 1, 0);

    /* ---------- pedigree collapse ---------- */

    var byKey = {};
    Object.keys(slots).forEach(function (n) {
      var k = slots[n].key;
      if (!byKey[k]) byKey[k] = [];
      byKey[k].push(parseInt(n, 10));
    });

    var repeats = [];
    Object.keys(byKey).forEach(function (k) {
      if (byKey[k].length < 2) return;
      var group = repeats.length + 1;
      byKey[k].sort(function (a, b) { return a - b; });
      byKey[k].forEach(function (n) { slots[n].repeatGroup = group; });
      repeats.push({
        key: k,
        name: graph[k] ? graph[k].name : 'Unknown',
        slots: byKey[k],
        group: group
      });
    });

    /* ---------- where the lines stop ---------- */

    // A chain ending before the requested depth is a research lead, not a
    // blank. Naming the person it stops at is the actionable part.
    var deadEnds = [];
    Object.keys(slots).forEach(function (n) {
      var s = slots[n];
      if (s.gen >= gens) return;
      var node = s.node;
      if (node.fatherKey || node.motherKey) return;
      deadEnds.push({
        name: node.name,
        gen: s.gen,
        ahnentafel: s.ahnentafel,
        real: node.real !== false
      });
    });
    deadEnds.sort(function (a, b) { return a.gen - b.gen; });

    return {
      ok: true,
      generations: gens,
      slots: slots,
      filled: Object.keys(slots).length,
      possible: Math.pow(2, gens + 1) - 1,
      distinct: Object.keys(byKey).length,
      repeats: repeats,
      deadEnds: deadEnds
    };
  }

  /* ---------- naming ---------- */

  // Reuses relate.js so a pedigree slot and a relationship result never
  // disagree about what to call the same position.
  function slotLabel(gen, gender) {
    if (gen === 0) return 'Subject';
    if (window.RRRelate && window.RRRelate.nameRelationship) {
      return window.RRRelate.nameRelationship(0, gen, gender, false);
    }
    return 'Generation ' + gen;
  }

  // Ahnentafel slots for one generation, in chart order.
  function generationSlots(gen) {
    var first = Math.pow(2, gen);
    var out = [];
    for (var i = 0; i < Math.pow(2, gen); i++) out.push(first + i);
    return out;
  }

  window.RRPedigree = {
    build: build,
    slotLabel: slotLabel,
    generationSlots: generationSlots,
    MAX_GENERATIONS: MAX_GENERATIONS
  };
})();
