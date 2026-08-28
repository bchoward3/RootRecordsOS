/* relate.js — RootRecords relationship calculator
 * Exposes window.RRRelate.
 *
 * Works out how two people are related by walking parent links upward from
 * each and finding shared ancestors.
 *
 * Two things make this more than textbook cousin arithmetic:
 *
 * 1. Parent links come in two forms. father_id points at a record; father
 *    is a plain name kept for people who have no grave and therefore no
 *    record. Chains must survive crossing from one to the other, or they
 *    break at exactly the early generations least likely to be documented.
 *
 * 2. In an isolated population two people are often related several ways.
 *    Reporting only the first path found would be true but misleading, so
 *    every distinct shared ancestor is reported, closest first.
 */
(function () {
  'use strict';

  var MAX_DEPTH = 12;

  function norm(s) {
    return (s || '').toString().trim().toLowerCase().replace(/\s+/g, ' ');
  }

  /* ---------- graph ---------- */

  // Nodes are keyed 'id:<uuid>' for people with records, 'name:<name>' for
  // ancestors known only as a name on someone else's record. A name-only
  // ancestor is still a valid meeting point: two people who both name the
  // same father are siblings whether or not that father has a grave.
  function buildGraph(persons) {
    var byId = {};
    var byName = {};
    persons.forEach(function (p) {
      byId['id:' + p.id] = p;
      var n = norm(p.name);
      if (n && !byName[n]) byName[n] = p;
    });

    function keyFor(id, name) {
      if (id && byId['id:' + id]) return 'id:' + id;
      var n = norm(name);
      if (!n) return null;
      if (byName[n]) return 'id:' + byName[n].id; // text name resolves to a record
      return 'name:' + n;
    }

    var graph = {};
    persons.forEach(function (p) {
      graph['id:' + p.id] = {
        key: 'id:' + p.id,
        name: p.name,
        dob: p.dob,
        dod: p.dod,
        gender: p.gender,
        fatherKey: keyFor(p.father_id, p.father),
        motherKey: keyFor(p.mother_id, p.mother),
        real: true
      };
    });

    // Add placeholder nodes for name-only ancestors so they can be met.
    persons.forEach(function (p) {
      [[p.father_id, p.father], [p.mother_id, p.mother]].forEach(function (pair) {
        var k = keyFor(pair[0], pair[1]);
        if (k && !graph[k]) {
          graph[k] = {
            key: k,
            name: pair[1],
            fatherKey: null,
            motherKey: null,
            real: false
          };
        }
      });
    });

    return graph;
  }

  /* ---------- traversal ---------- */

  // Every ancestor reachable from a start node, with the path taken. Paths
  // rather than plain distances, because working out half relationships
  // needs to know which children the two lines diverged through.
  function ancestorPaths(graph, startKey) {
    var out = [];
    if (!graph[startKey]) return out;

    function walk(key, gen, path) {
      out.push({ key: key, gen: gen, path: path });
      if (gen >= MAX_DEPTH) return;
      var node = graph[key];
      if (!node) return;
      [node.fatherKey, node.motherKey].forEach(function (pk) {
        if (!pk || !graph[pk]) return;
        if (path.indexOf(pk) !== -1) return; // cycle guard
        walk(pk, gen + 1, path.concat([pk]));
      });
    }
    walk(startKey, 0, [startKey]);
    return out;
  }

  // Nearest generation of each ancestor, keeping one representative path.
  function nearestByKey(paths) {
    var map = {};
    paths.forEach(function (p) {
      if (!map[p.key] || p.gen < map[p.key].gen) map[p.key] = p;
    });
    return map;
  }

  /* ---------- naming ---------- */

  var ORDINAL = ['', 'first', 'second', 'third', 'fourth', 'fifth', 'sixth',
                 'seventh', 'eighth', 'ninth', 'tenth'];

  function ordinal(n) {
    return ORDINAL[n] || (n + 'th');
  }

  function timesRemoved(n) {
    if (n === 0) return '';
    if (n === 1) return ' once removed';
    if (n === 2) return ' twice removed';
    if (n === 3) return ' three times removed';
    return ' ' + n + ' times removed';
  }

  function greats(n) {
    // n = number of "great"s
    if (n <= 0) return '';
    if (n === 1) return 'great-';
    return 'great-'.repeat(n);
  }

  function gendered(gender, male, female, neutral) {
    if (gender === 'M') return male;
    if (gender === 'F') return female;
    return neutral;
  }

  /**
   * Name the relationship of `subject` to the person of interest.
   * a = subject's generations up to the shared ancestor
   * b = the other person's generations up to the same ancestor
   */
  function nameRelationship(a, b, gender, half) {
    var h = half ? 'half-' : '';

    // Subject is the shared ancestor: a direct ancestor of the other person.
    if (a === 0) {
      if (b === 1) return gendered(gender, 'father', 'mother', 'parent');
      if (b === 2) return gendered(gender, 'grandfather', 'grandmother', 'grandparent');
      return greats(b - 2) + gendered(gender, 'grandfather', 'grandmother', 'grandparent');
    }
    // Subject descends from the other person.
    if (b === 0) {
      if (a === 1) return gendered(gender, 'son', 'daughter', 'child');
      if (a === 2) return gendered(gender, 'grandson', 'granddaughter', 'grandchild');
      return greats(a - 2) + gendered(gender, 'grandson', 'granddaughter', 'grandchild');
    }
    // Siblings.
    if (a === 1 && b === 1) {
      return h + gendered(gender, 'brother', 'sister', 'sibling');
    }
    // Subject is a sibling of one of the other person's ancestors.
    if (a === 1) {
      return h + greats(b - 2) + gendered(gender, 'uncle', 'aunt', 'aunt or uncle');
    }
    // The other person is a sibling of one of the subject's ancestors.
    if (b === 1) {
      return h + greats(a - 2) + gendered(gender, 'nephew', 'niece', 'nephew or niece');
    }
    // Cousins.
    var degree = Math.min(a, b) - 1;
    var removed = Math.abs(a - b);
    return h + ordinal(degree) + ' cousin' + timesRemoved(removed);
  }

  /* ---------- half detection ---------- */

  // Two lines meeting at a shared ancestor are "half" when they descend
  // through children who share only one parent.
  //
  // Crucially, an unrecorded parent is not a different parent. If either
  // child's other parent is unknown we cannot establish a half relationship,
  // so we report the full one — most records here have no mother recorded,
  // and claiming "half-brother" on that basis would be wrong far more often
  // than right.
  function isHalf(graph, ancestorKey, pathA, pathB) {
    var ia = pathA.indexOf(ancestorKey);
    var ib = pathB.indexOf(ancestorKey);
    if (ia < 1 || ib < 1) return false; // one is a direct ancestor of the other
    var childA = graph[pathA[ia - 1]];
    var childB = graph[pathB[ib - 1]];
    if (!childA || !childB) return false;
    if (childA.key === childB.key) return false;

    // Identify the other parent slot — the one that is not the shared ancestor.
    var otherA = childA.fatherKey === ancestorKey ? childA.motherKey : childA.fatherKey;
    var otherB = childB.fatherKey === ancestorKey ? childB.motherKey : childB.fatherKey;

    // Unknown on either side means undetermined, not different.
    if (!otherA || !otherB) return false;
    return otherA !== otherB;
  }

  /* ---------- main ---------- */

  /**
   * relate(persons, subjectId, anchorId, anchorGens)
   *
   * anchorGens: how many generations above the user the anchor sits.
   * 1 = the user's father or mother, 2 = a grandparent, and so on. The user
   * is never in the records — every record is a deceased person — so the
   * anchor is how the calculation reaches them.
   *
   * Returns { ok, subject, paths: [...], truncated }
   */
  function relate(persons, subjectId, anchorId, anchorGens) {
    var graph = buildGraph(persons);
    var sKey = 'id:' + subjectId;
    var aKey = 'id:' + anchorId;

    if (!graph[sKey]) return { ok: false, reason: 'subject-missing' };
    if (!graph[aKey]) return { ok: false, reason: 'anchor-missing' };

    var subject = graph[sKey];

    // The subject IS the anchor.
    if (subjectId === anchorId) {
      return {
        ok: true,
        subject: subject,
        direct: true,
        paths: [{
          ancestor: subject,
          subjectGen: 0,
          userGen: anchorGens,
          label: nameRelationship(0, anchorGens, subject.gender, false),
          half: false
        }],
        truncated: 0
      };
    }

    var sPaths = ancestorPaths(graph, sKey);
    var aPaths = ancestorPaths(graph, aKey);
    var sNear = nearestByKey(sPaths);
    var aNear = nearestByKey(aPaths);

    var commonKeys = Object.keys(sNear).filter(function (k) {
      return aNear[k];
    });

    if (commonKeys.length === 0) {
      return {
        ok: true,
        subject: subject,
        paths: [],
        breaks: findChainBreaks(graph, sKey, aKey)
      };
    }

    // Drop ancestors that are only reachable through a nearer shared
    // ancestor — a shared great-grandfather is implied by a shared
    // grandfather and adds nothing.
    var commonSet = {};
    commonKeys.forEach(function (k) { commonSet[k] = true; });
    var nearest = commonKeys.filter(function (k) {
      var p = sNear[k].path;
      var i = p.indexOf(k);
      // If the child we came through is also shared, this one is redundant.
      return !(i >= 1 && commonSet[p[i - 1]]);
    });

    // A shared grandfather and grandmother are one relationship, not two.
    // Group by the pair of children the two lines diverge through: same
    // pair means the same couple, so one entry listing both ancestors.
    var groups = {};
    nearest.forEach(function (k) {
      var sPath = sNear[k].path;
      var aPath = aNear[k].path;
      var si = sPath.indexOf(k), ai = aPath.indexOf(k);
      var gk = (si >= 1 ? sPath[si - 1] : 'self') + '|' + (ai >= 1 ? aPath[ai - 1] : 'self');
      if (!groups[gk]) groups[gk] = [];
      groups[gk].push(k);
    });

    var results = Object.keys(groups).map(function (gk) {
      var keys = groups[gk];
      var k = keys[0];
      var sGen = sNear[k].gen;
      var aGen = aNear[k].gen;
      var userGen = aGen + anchorGens;
      var half = isHalf(graph, k, sNear[k].path, aNear[k].path);
      return {
        ancestor: graph[k],
        ancestors: keys.map(function (x) { return graph[x]; }),
        subjectGen: sGen,
        userGen: userGen,
        half: half,
        label: nameRelationship(sGen, userGen, subject.gender, half),
        distance: sGen + userGen,
        subjectPath: sNear[k].path.map(function (x) { return graph[x]; }),
        userPath: aNear[k].path.map(function (x) { return graph[x]; })
      };
    });

    results.sort(function (x, y) {
      return x.distance - y.distance || x.subjectGen - y.subjectGen;
    });

    var capped = results.slice(0, 5);
    return {
      ok: true,
      subject: subject,
      paths: capped,
      truncated: Math.max(0, results.length - capped.length)
    };
  }

  // When nothing connects, say where each line stops. Knowing that a chain
  // ends at a particular person is actionable research; "no relationship"
  // alone is not.
  function findChainBreaks(graph, sKey, aKey) {
    function deadEnds(startKey) {
      var ends = [];
      ancestorPaths(graph, startKey).forEach(function (p) {
        var n = graph[p.key];
        if (n && !n.fatherKey && !n.motherKey && p.gen > 0) {
          ends.push({ name: n.name, gen: p.gen, real: n.real });
        }
      });
      // furthest back first, deduped by name
      var seen = {};
      return ends.filter(function (e) {
        var k = norm(e.name);
        if (seen[k]) return false;
        seen[k] = true;
        return true;
      }).sort(function (a, b) { return b.gen - a.gen; }).slice(0, 3);
    }
    return { subject: deadEnds(sKey), user: deadEnds(aKey) };
  }

  window.RRRelate = {
    relate: relate,
    buildGraph: buildGraph,
    nameRelationship: nameRelationship,
    ancestorPaths: ancestorPaths
  };
})();
