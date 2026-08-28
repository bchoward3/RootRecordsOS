/* picker.js — RootRecords person picker
 * Exposes window.RRPicker.
 *
 * Attaches a search dropdown to a text input. Typing filters people who
 * already have records; choosing one links the field to that person's id.
 *
 * A persons row only exists when there is a grave for that person, so the
 * candidate list is drawn from the loaded graves rather than querying the
 * persons table. That works offline and structurally enforces the rule —
 * you cannot link to someone who has no grave.
 *
 * If no record exists, the typed name is kept as text and the id stays null.
 * That is a permanent fallback, not a temporary one: the earliest ancestors
 * are the least likely to have located graves.
 */
(function () {
  'use strict';

  var openDropdown = null;
  // app.js owns the graves list; it hands it over rather than the picker
  // reaching for a global.
  var source = [];

  function setSource(graves) { source = graves || []; }

  function normalize(s) {
    return (s || '').toString().trim().toLowerCase();
  }

  function closeAll() {
    if (openDropdown && openDropdown.parentNode) {
      openDropdown.parentNode.removeChild(openDropdown);
    }
    openDropdown = null;
  }

  document.addEventListener('click', function (e) {
    if (openDropdown && !openDropdown.contains(e.target) &&
        !e.target.classList.contains('rr-picker-input')) {
      closeAll();
    }
  });

  // Candidates: one entry per person who has a grave.
  function candidates(query, excludeId) {
    var q = normalize(query);
    if (!q) return [];
    var seen = {};
    var out = [];
    source.forEach(function (g) {
      if (!g.person_id || !g.person_name) return;
      if (excludeId && g.person_id === excludeId) return;
      if (seen[g.person_id]) return;
      if (normalize(g.person_name).indexOf(q) === -1) return;
      seen[g.person_id] = true;
      var years = [
        g.dob ? String(g.dob).slice(0, 4) : '',
        g.dod ? String(g.dod).slice(0, 4) : ''
      ].filter(Boolean).join('–');
      out.push({
        id: g.person_id,
        name: g.person_name,
        detail: [years, g.cemetery_name].filter(Boolean).join(' · ')
      });
    });
    return out.slice(0, 8);
  }

  function setLinked(input, person) {
    if (person) {
      input.value = person.name;
      input.dataset.personId = person.id;
    } else {
      delete input.dataset.personId;
    }
    updateBadge(input);
  }

  function updateBadge(input) {
    var badge = input.parentNode.querySelector('.rr-picker-badge');
    if (!badge) return;
    if (input.dataset.personId) {
      badge.textContent = '● linked';
      badge.className = 'rr-picker-badge linked';
    } else if (input.value.trim()) {
      badge.textContent = '○ name only';
      badge.className = 'rr-picker-badge text-only';
    } else {
      badge.textContent = '';
      badge.className = 'rr-picker-badge';
    }
  }

  function showDropdown(input, excludeId) {
    closeAll();
    var results = candidates(input.value, excludeId);
    var box = document.createElement('div');
    box.className = 'rr-picker-list';

    if (results.length === 0) {
      var none = document.createElement('div');
      none.className = 'rr-picker-none';
      none.textContent = input.value.trim()
        ? 'No record yet — will be saved as text.'
        : 'Type a name to search existing records.';
      box.appendChild(none);
    } else {
      results.forEach(function (r) {
        var row = document.createElement('div');
        row.className = 'rr-picker-item';
        var nm = document.createElement('div');
        nm.className = 'rr-picker-name';
        nm.textContent = r.name;
        row.appendChild(nm);
        if (r.detail) {
          var dt = document.createElement('div');
          dt.className = 'rr-picker-detail';
          dt.textContent = r.detail;
          row.appendChild(dt);
        }
        row.addEventListener('click', function (ev) {
          ev.stopPropagation();
          setLinked(input, r);
          closeAll();
        });
        box.appendChild(row);
      });
    }

    input.parentNode.appendChild(box);
    openDropdown = box;
  }

  /**
   * attach(input, opts)
   * opts.excludeId — a person id that must not be selectable (no self-parenting)
   */
  function attach(input, opts) {
    if (!input || input.dataset.pickerBound) return;
    input.dataset.pickerBound = '1';
    input.classList.add('rr-picker-input');
    opts = opts || {};

    // Wrapper so the dropdown can be positioned against the input.
    if (!input.parentNode.classList.contains('rr-picker-wrap')) {
      var wrap = document.createElement('div');
      wrap.className = 'rr-picker-wrap';
      input.parentNode.insertBefore(wrap, input);
      wrap.appendChild(input);
      var badge = document.createElement('span');
      badge.className = 'rr-picker-badge';
      wrap.appendChild(badge);
    }

    input.addEventListener('input', function () {
      // Editing the text breaks any existing link — the name no longer
      // necessarily refers to the person that was chosen.
      delete input.dataset.personId;
      updateBadge(input);
      showDropdown(input, opts.excludeId);
    });

    input.addEventListener('focus', function () {
      if (input.value.trim()) showDropdown(input, opts.excludeId);
    });

    updateBadge(input);
  }

  // Read the current value: { name, id }
  function value(input) {
    if (!input) return { name: null, id: null };
    var name = input.value.trim();
    return {
      name: name || null,
      id: input.dataset.personId || null
    };
  }

  // Preset a field when opening an edit form.
  function set(input, name, id) {
    if (!input) return;
    input.value = name || '';
    if (id) input.dataset.personId = id;
    else delete input.dataset.personId;
    updateBadge(input);
  }

  window.RRPicker = {
    setSource: setSource,
    attach: attach,
    value: value,
    set: set,
    closeAll: closeAll
  };
})();
