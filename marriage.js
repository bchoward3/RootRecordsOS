/* marriage.js — RootRecords marriage records
 * Exposes window.RRMarriage.
 *
 * A marriage is stored once, on one row, hanging off person_a_id. There is
 * no reciprocal row: symmetry is a read-time concern, not a storage one.
 * Two rows for one marriage would drift apart the moment either is edited.
 *
 * Consequences that every caller has to respect:
 *
 * 1. Reading a person's marriages means querying BOTH person_a_id and
 *    person_b_id. Querying one side silently loses every marriage that was
 *    entered from the spouse's record.
 *
 * 2. The spouse is whichever side is not the person being viewed. On the
 *    a-side the spouse's name comes from persons or from spouse_name; on
 *    the b-side it always comes from persons, because person_a_id is NOT
 *    NULL and therefore always has a record.
 *
 * 3. spouse_name is the same permanent fallback as father/mother on
 *    persons. A wife with no located grave has no persons row, and that is
 *    the normal case for the earliest generations — not a gap to be fixed.
 *
 * Marriages are deliberately NOT part of the relationship graph in
 * relate.js. A spouse is not a blood relation, and letting marriage edges
 * into ancestor traversal would produce confidently wrong cousin answers.
 */
(function () {
  'use strict';

  function norm(s) {
    return (s || '').toString().trim().toLowerCase().replace(/\s+/g, ' ');
  }

  function year(d) {
    return d ? String(d).slice(0, 4) : '';
  }

  /* ---------- read ---------- */

  /**
   * load(sb, personId) -> Promise<[marriage]>
   *
   * marriage = {
   *   id, spouseId, spouseName, linked,
   *   marriage_date, end_date, end_reason, notes,
   *   side: 'a' | 'b'          // which column this person sits in
   * }
   *
   * Sorted earliest marriage first; undated marriages last, since an
   * undated one cannot be placed in the sequence.
   */
  function load(sb, personId) {
    if (!personId) return Promise.resolve([]);

    return sb.from('marriages')
      .select('*')
      .or('person_a_id.eq.' + personId + ',person_b_id.eq.' + personId)
      .then(function (res) {
        if (res.error) throw res.error;
        var rows = res.data || [];
        if (!rows.length) return [];

        // Resolve spouse names from persons in one query rather than
        // relying on embedded joins — two foreign keys to the same table
        // need constraint-name hints, which are not worth depending on.
        var ids = {};
        rows.forEach(function (r) {
          var other = r.person_a_id === personId ? r.person_b_id : r.person_a_id;
          if (other) ids[other] = true;
        });
        var idList = Object.keys(ids);
        if (!idList.length) return shape(rows, personId, {});

        return sb.from('persons').select('id, name').in('id', idList)
          .then(function (pRes) {
            var byId = {};
            (pRes.data || []).forEach(function (p) { byId[p.id] = p.name; });
            return shape(rows, personId, byId);
          });
      });
  }

  function shape(rows, personId, namesById) {
    return rows.map(function (r) {
      var isA = r.person_a_id === personId;
      var spouseId = isA ? r.person_b_id : r.person_a_id;
      var spouseName = spouseId
        ? (namesById[spouseId] || null)
        : (isA ? r.spouse_name : null);
      return {
        id: r.id,
        spouseId: spouseId || null,
        // Fall back to the stored text even when an id exists but the
        // persons row could not be read — better a name than a blank.
        spouseName: spouseName || r.spouse_name || null,
        linked: !!spouseId,
        marriage_date: r.marriage_date || null,
        end_date: r.end_date || null,
        end_reason: r.end_reason || null,
        notes: r.notes || null,
        side: isA ? 'a' : 'b'
      };
    }).sort(function (x, y) {
      if (!x.marriage_date && !y.marriage_date) return 0;
      if (!x.marriage_date) return 1;
      if (!y.marriage_date) return -1;
      return String(x.marriage_date).localeCompare(String(y.marriage_date));
    });
  }

  /* ---------- write ---------- */

  /**
   * add(sb, personId, spouse) -> Promise<row>
   * spouse = { id, name, marriage_date, end_date, end_reason, notes }
   *
   * Rejects a spouse with neither an id nor a name — an empty marriage row
   * records nothing and cannot be told apart from a mistake later.
   */
  function add(sb, personId, spouse) {
    spouse = spouse || {};
    if (!personId) return Promise.reject(new Error('This record has no person to attach a marriage to.'));
    if (!spouse.id && !norm(spouse.name)) {
      return Promise.reject(new Error('A marriage needs a spouse name.'));
    }
    if (spouse.id && spouse.id === personId) {
      return Promise.reject(new Error('A person cannot be married to themselves.'));
    }

    return load(sb, personId).then(function (existing) {
      var dupe = existing.some(function (m) {
        if (spouse.id && m.spouseId) return m.spouseId === spouse.id;
        if (spouse.id || m.spouseId) return false;
        return norm(m.spouseName) === norm(spouse.name);
      });
      if (dupe) throw new Error('That marriage is already recorded.');

      // person_a_id is NOT NULL, so the person being edited always takes
      // the a-side. A linked spouse goes in person_b_id; an unlinked one
      // is kept as text in the same way father/mother are.
      return sb.from('marriages').insert({
        person_a_id: personId,
        person_b_id: spouse.id || null,
        spouse_name: spouse.name || null,
        marriage_date: spouse.marriage_date || null,
        end_date: spouse.end_date || null,
        end_reason: spouse.end_reason || null,
        notes: spouse.notes || null
      }).select().single().then(function (res) {
        if (res.error) throw res.error;
        return res.data;
      });
    });
  }

  function update(sb, marriageId, fields) {
    return sb.from('marriages').update(fields).eq('id', marriageId)
      .then(function (res) {
        if (res.error) throw res.error;
        return true;
      });
  }

  function remove(sb, marriageId) {
    return sb.from('marriages').delete().eq('id', marriageId)
      .then(function (res) {
        if (res.error) throw res.error;
        return true;
      });
  }

  /* ---------- display ---------- */

  var REASON = { death: 'until death', divorce: 'divorced', unknown: 'end unknown' };

  /**
   * describe(m) -> 'm. 1871 – 1902, divorced' or '' when nothing is dated.
   *
   * A null end_reason means nobody has looked. 'unknown' means someone
   * looked and could not tell. Those are different research states and the
   * display keeps them apart rather than flattening both to silence.
   */
  function describe(m) {
    var bits = [];
    var my = year(m.marriage_date);
    var ey = year(m.end_date);
    if (my && ey) bits.push('m. ' + my + '\u2013' + ey);
    else if (my) bits.push('m. ' + my);
    else if (ey) bits.push('ended ' + ey);
    if (m.end_reason && REASON[m.end_reason]) bits.push(REASON[m.end_reason]);
    return bits.join(', ');
  }

  // One-line summary for the feature panel, e.g.
  // "Sarah Combs (m. 1871–1902, divorced)"
  function summarize(m) {
    var name = m.spouseName || 'Unnamed spouse';
    var d = describe(m);
    return d ? name + ' (' + d + ')' : name;
  }

  window.RRMarriage = {
    load: load,
    add: add,
    update: update,
    remove: remove,
    describe: describe,
    summarize: summarize
  };
})();
