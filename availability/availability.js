/*
 * Desert Sage Rentals — unlisted availability page (Sep 30 2026).
 *
 * Data: GET https://tasks.desertsagerentals.com/api/public/availability
 *   { today:'YYYY-MM-DD' (Pacific), from:'YYYY-MM-DD' (= yesterday), days:N,
 *     data_as_of, generated_at, stale?, properties:[{ id, name, image, nights }] }
 *   nights[i] is '1' when the night of (from + i) is booked or blocked.
 *
 * The API's property list is the ONLY source of which homes appear, so a new
 * listing shows up here on its own. /properties.json (same site) only decorates
 * a home it already knows about with a nicer name and a local photo.
 *
 * Dates never go through the browser's clock or local timezone: "today" comes
 * from the server, and every date is a UTC day number built from 'YYYY-MM-DD'.
 * Anything the page cannot read is drawn as "not published", never as open.
 */
(function () {
  'use strict';

  var LOCAL = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  // On a local preview, read a fixture instead (production CORS only admits
  // desertsagerentals.com). The fixture is gitignored and never deployed.
  var API_URL = LOCAL ? '/availability/_dev-sample.json'
                      : 'https://tasks.desertsagerentals.com/api/public/availability';
  var TIMEOUT_MS = 12000;
  var GRID_DAYS = 120;
  var MONTHS_FIRST = 6;
  var REFRESH_AFTER_MS = 10 * 60 * 1000;
  var SUMMARY_DAYS = 90;

  var DAY = 86400000;
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var WD1 = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

  var $ = function (id) { return document.getElementById(id); };
  var el = {
    select: $('av-home'), copy: $('av-copy'), status: $('av-status'),
    all: $('av-all'), one: $('av-one'), updated: $('av-updated'), toast: $('av-toast'),
    share: $('av-share'), shareInput: $('av-share-input'), shareClose: $('av-share-close')
  };

  var state = { data: null, homes: [], byId: Object.create(null), fromDay: 0, todayIdx: 1, days: 0,
                months: MONTHS_FIRST, gridDays: GRID_DAYS, loadedAt: 0, loading: false };

  // ------------------------------------------------------------ helpers
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function dayNum(ymd) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd || ''));
    if (!m) return null;
    return Math.round(Date.UTC(+m[1], +m[2] - 1, +m[3]) / DAY);
  }
  function parts(dn) {
    var d = new Date(dn * DAY);
    return { y: d.getUTCFullYear(), m: d.getUTCMonth(), d: d.getUTCDate(), wd: d.getUTCDay() };
  }
  function longDate(dn) {
    var p = parts(dn);
    return WD[p.wd] + ', ' + MON[p.m] + ' ' + p.d + ', ' + p.y;
  }
  function shortDate(dn) {
    var p = parts(dn);
    return MON[p.m] + ' ' + p.d;
  }
  function slugify(s) {
    return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  }
  function safeImage(u) {
    if (typeof u !== 'string') return null;
    if (/^https:\/\/[^\s"'<>]+$/.test(u)) return u;
    if (/^\/[A-Za-z0-9_\-./]+$/.test(u) && u.indexOf('..') === -1) return u;
    return null;
  }
  function own(obj, key) { return Object.prototype.hasOwnProperty.call(obj, key); }

  // Status of calendar day `dn` for a home: the morning belongs to the night
  // before, the evening to that night.
  //   'o'  open all day        'b'  booked or blocked both nights
  //   'co' guests leave that morning, open after   'ci' open until guests arrive
  //   'past' before today      'na' not published / unreadable
  function nightAt(home, i) {
    var c = home.nights.charAt(i);
    return c === '1' ? 1 : c === '0' ? 0 : -1;
  }
  function dayState(home, dn) {
    var i = dn - state.fromDay;
    if (i < state.todayIdx) return 'past';
    if (i >= state.days) return 'na';
    var eve = nightAt(home, i);
    var morn = i > 0 ? nightAt(home, i - 1) : 0;
    if (eve < 0 || morn < 0) return 'na';
    if (morn && eve) return 'b';
    if (morn) return 'co';
    if (eve) return 'ci';
    return 'o';
  }
  var STATE_TEXT = {
    o: 'open', b: 'booked or blocked', co: 'guests leave in the morning, open after',
    ci: 'open until guests arrive in the afternoon', past: 'past', na: 'not published yet'
  };

  function linkFor(home) {
    var base = location.origin + location.pathname;
    return home ? base + '?p=' + encodeURIComponent(home.id) : base;
  }

  function toast(msg) {
    // The element stays rendered (only faded), so screen readers announce it.
    el.toast.textContent = '';
    el.toast.classList.add('is-on');
    setTimeout(function () { el.toast.textContent = msg; }, 30);
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { el.toast.classList.remove('is-on'); }, 2600);
  }

  // Last resort when nothing can copy: a panel with the link selected, which the
  // person can copy or long-press by hand. It stays until they close it.
  function showSharePanel(text) {
    el.shareInput.value = text;
    el.share.hidden = false;
    el.shareInput.focus();
    try { el.shareInput.setSelectionRange(0, text.length); } catch (e) { el.shareInput.select(); }
  }

  function tryExecCopy(text) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed'; ta.style.top = '-1000px'; ta.style.fontSize = '16px';
    document.body.appendChild(ta);
    ta.focus();
    try { ta.setSelectionRange(0, text.length); } catch (e) { ta.select(); }
    var ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    document.body.removeChild(ta);
    return ok;
  }

  function shareLink(text, home) {
    var label = home ? 'Link to ' + home.name : 'Link to all homes';
    // On phones the share sheet is how a link gets to a contractor.
    var touch = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
    if (touch && navigator.share) {
      navigator.share({ title: (home ? home.name + ' availability' : 'Desert Sage availability'), url: text })
        .catch(function (err) { if (!err || err.name !== 'AbortError') showSharePanel(text); });
      return;
    }
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(function () { toast(label + ' copied'); }, function () {
        if (tryExecCopy(text)) toast(label + ' copied'); else showSharePanel(text);
      });
      return;
    }
    if (tryExecCopy(text)) toast(label + ' copied'); else showSharePanel(text);
  }

  // ------------------------------------------------------------ data
  function fetchJson(url, timeoutMs, fresh) {
    var ctrl = typeof AbortController === 'function' ? new AbortController() : null;
    var t = ctrl ? setTimeout(function () { ctrl.abort(); }, timeoutMs) : null;
    var opts = {};
    if (ctrl) opts.signal = ctrl.signal;
    if (fresh) opts.cache = 'no-cache';
    return fetch(url, opts)
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .finally(function () { if (t) clearTimeout(t); });
  }

  function loadDecorations() {
    // Optional: curated names + local photos. Failure is fine.
    return fetchJson('/properties.json', 8000, false).then(function (j) {
      var list = Array.isArray(j) ? j : (j && Array.isArray(j.properties) ? j.properties : []);
      var map = Object.create(null);
      list.forEach(function (p) { if (p && p.id != null) map[String(p.id)] = p; });
      return map;
    }).catch(function () { return Object.create(null); });
  }

  function normalise(data, deco) {
    if (!data || typeof data !== 'object') throw new Error('bad payload');
    var fromDay = dayNum(data.from);
    var todayDay = dayNum(data.today);
    var days = Number(data.days);
    if (fromDay === null || todayDay === null || !(days > 0) || days > 2000) throw new Error('bad window');
    var homes = [];
    var seen = Object.create(null);
    (Array.isArray(data.properties) ? data.properties : []).forEach(function (p) {
      if (!p || p.id == null || typeof p.nights !== 'string') return;
      var id = String(p.id);
      if (seen[id]) return;
      seen[id] = true;
      var d = deco[id] || {};
      var name = (typeof d.name === 'string' && d.name.trim()) ? d.name.trim() : String(p.name || 'Desert Sage home');
      var img = safeImage(d.image ? '/' + String(d.image).replace(/^\/+/, '') : null) || safeImage(p.image);
      // Anything short or unreadable becomes 'x', which draws as "not published", never as open.
      var nights = p.nights.slice(0, days).replace(/[^01]/g, 'x');
      while (nights.length < days) nights += 'x';
      homes.push({ id: id, name: name, slug: slugify(name), image: img, nights: nights });
    });
    homes.sort(function (a, b) { return a.name.localeCompare(b.name); });
    // Curated names from properties.json could collide; keep every option distinct.
    var count = Object.create(null);
    homes.forEach(function (h) {
      var k = h.name.toLowerCase();
      count[k] = (count[k] || 0) + 1;
      if (count[k] > 1) { h.name = h.name + ' (' + count[k] + ')'; h.slug = slugify(h.name); }
    });
    state.data = data;
    state.homes = homes;
    state.byId = Object.create(null);
    homes.forEach(function (h) { state.byId[h.id] = h; });
    state.fromDay = fromDay;
    state.todayIdx = todayDay - fromDay;
    state.days = days;
  }

  function findHome(key) {
    if (!key) return null;
    key = String(key).trim();
    if (own(state.byId, key)) return state.byId[key];
    // Tolerate links pasted into a sentence: "…?p=745455." or "…?p=745455)".
    var digits = key.replace(/[^0-9]/g, '');
    if (/^\d+\W*$/.test(key) && own(state.byId, digits)) return state.byId[digits];
    var s = slugify(key);
    var hit = null;
    for (var i = 0; i < state.homes.length; i++) {
      if (state.homes[i].slug === s) { if (hit) return null; hit = state.homes[i]; }
    }
    return hit;
  }

  // ------------------------------------------------------------ render
  function renderUpdated() {
    var d = state.data;
    var when = '';
    if (d.data_as_of) {
      try {
        when = new Date(d.data_as_of).toLocaleString('en-US', { timeZone: 'America/Los_Angeles', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
      } catch (e) { when = ''; }
    }
    var text = when ? 'Updated ' + when + ' PT' : 'Update time unknown';
    if (d.stale) text += '. May be out of date.';
    el.updated.textContent = text;
    el.updated.classList.toggle('is-stale', !!d.stale);
  }

  function renderSelect(current) {
    var html = '<option value="">All homes</option>';
    state.homes.forEach(function (h) {
      html += '<option value="' + esc(h.id) + '"' + (current && current.id === h.id ? ' selected' : '') + '>' + esc(h.name) + '</option>';
    });
    el.select.innerHTML = html;
    el.select.disabled = false;
    el.copy.disabled = false;
  }

  function renderAll() {
    var start = state.fromDay + state.todayIdx;
    var count = Math.max(1, Math.min(state.gridDays, state.days - state.todayIdx));
    var monthRow = '<tr class="m"><th class="corner" scope="col"><span class="av-sr">Home</span></th>';
    var dayRow = '<tr class="dn"><th class="corner" aria-hidden="true"></th>';
    var run = 0, runMonth = null, runYear = null;
    function flush() {
      if (!run) return;
      // A month with only a day or two showing gets no label (it would force
      // those columns wide); the day header carries the month instead.
      var label = run >= 3 ? MONTHS[runMonth] + (runYear !== parts(start).y ? ' ' + runYear : '') : '';
      monthRow += '<th colspan="' + run + '" scope="colgroup">' + (label ? esc(label) : '<span class="av-sr">' + esc(MONTHS[runMonth] + ' ' + runYear) + '</span>') + '</th>';
    }
    for (var k = 0; k < count; k++) {
      var p = parts(start + k);
      if (p.m !== runMonth) { flush(); run = 0; runMonth = p.m; runYear = p.y; }
      run++;
      var small = (k === 0 || p.d === 1) ? MON[p.m] : WD1[p.wd];
      dayRow += '<th scope="col"' + (k === 0 ? ' class="is-today"' : (p.d === 1 ? ' class="is-first"' : '')) + ' title="' + esc(longDate(start + k)) + '">' + p.d + '<small>' + small + '</small></th>';
    }
    flush();
    monthRow += '</tr>'; dayRow += '</tr>';

    var body = '';
    state.homes.forEach(function (h) {
      body += '<tr><th scope="row"><button type="button" class="av-name-btn" data-open="' + esc(h.id) + '">' + esc(h.name) + '<span class="av-chev" aria-hidden="true"> ›</span></button>' +
        '<button type="button" class="av-link" data-copy="' + esc(h.id) + '">Share link</button></th>';
      for (var k = 0; k < count; k++) {
        var dn = start + k;
        var s = dayState(h, dn);
        var label = longDate(dn) + ': ' + STATE_TEXT[s];
        body += '<td><div class="d d-' + s + '" role="img" aria-label="' + esc(label) + '" title="' + esc(label) + '"></div></td>';
      }
      body += '</tr>';
    });

    var more = '';
    var remaining = state.days - state.todayIdx - count;
    if (remaining > 0) more = '<button type="button" class="av-btn av-btn--ghost av-more" data-more-days="1">Show ' + Math.min(GRID_DAYS, remaining) + ' more days</button>';

    el.all.innerHTML = '<p class="av-hint">Tap a home’s name for its full calendar. Scroll sideways for later dates.</p>' +
      '<div class="av-scroll" tabindex="0" role="region" aria-label="Availability for every home. Scrolls sideways."><table class="av-grid"><caption class="av-sr">Open and booked days for every home.</caption><thead>' +
      monthRow + dayRow + '</thead><tbody>' + body + '</tbody></table></div>' + more;
  }

  // "Open stretches" for the next SUMMARY_DAYS nights, as text: the fastest way
  // for a contractor to find a window, and the screen-reader version of the grid.
  function openStretches(h) {
    var out = [];
    var startI = state.todayIdx;
    var endI = Math.min(state.days, state.todayIdx + SUMMARY_DAYS);
    var i = startI;
    while (i < endI) {
      if (nightAt(h, i) === 0) {
        var s = i;
        while (i < endI && nightAt(h, i) === 0) i++;
        var a = state.fromDay + s, b = state.fromDay + i - 1;
        var nights = i - s;
        out.push((a === b ? 'night of ' + shortDate(a) : shortDate(a) + ' to ' + shortDate(b + 1)) + ' (' + nights + (nights === 1 ? ' night' : ' nights') + (i >= endI ? '+' : '') + ')');
      } else i++;
    }
    return out;
  }

  function renderOne(h) {
    var todayDn = state.fromDay + state.todayIdx;
    var tp = parts(todayDn);
    var lastDn = state.fromDay + state.days - 1;
    var lp = parts(lastDn);
    var totalMonths = (lp.y - tp.y) * 12 + (lp.m - tp.m) + 1;
    var show = Math.min(state.months, totalMonths);

    var months = '';
    for (var k = 0; k < show; k++) {
      var y = tp.y + Math.floor((tp.m + k) / 12);
      var m = (tp.m + k) % 12;
      var first = Math.round(Date.UTC(y, m, 1) / DAY);
      var dim = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
      // In the current month, skip whole weeks that are already over.
      var startDn = first;
      if (k === 0) {
        var weekStart = todayDn - parts(todayDn).wd;
        if (weekStart > first) startDn = weekStart;
      }
      var cells = '';
      for (var w = 0; w < 7; w++) cells += '<div class="wd" aria-hidden="true">' + WD1[w] + '</div>';
      for (var b = 0; b < parts(startDn).wd; b++) cells += '<div class="blank" aria-hidden="true"></div>';
      for (var dn = startDn; dn < first + dim; dn++) {
        var s = dayState(h, dn);
        var label = longDate(dn) + ': ' + STATE_TEXT[s];
        cells += '<div class="d d-' + s + (dn === todayDn ? ' is-today' : '') + '" role="img" aria-label="' + esc(label) + '" title="' + esc(label) + '"><span aria-hidden="true">' + parts(dn).d + '</span></div>';
      }
      months += '<div class="av-month"><h3 tabindex="-1" data-month="' + k + '">' + esc(MONTHS[m] + ' ' + y) + '</h3><div class="av-cal">' + cells + '</div></div>';
    }
    var more = show < totalMonths
      ? '<button type="button" class="av-btn av-btn--ghost av-more" data-more-months="1">Show more months</button>' : '';

    var stretches = openStretches(h);
    var summary = stretches.length
      ? '<ul class="av-open">' + stretches.slice(0, 12).map(function (t) { return '<li>' + esc(t) + '</li>'; }).join('') + '</ul>' +
        (stretches.length > 12 ? '<p class="av-small">and ' + (stretches.length - 12) + ' more. See the calendar below.</p>' : '')
      : '<p class="av-small">No open nights in the next ' + SUMMARY_DAYS + ' days.</p>';

    var img = h.image ? '<img src="' + esc(h.image) + '" alt="" loading="lazy" referrerpolicy="no-referrer">' : '';
    el.one.setAttribute('aria-label', h.name);
    el.one.innerHTML = '<div class="av-home-head">' + img + '<div><h2 tabindex="-1">' + esc(h.name) + '</h2>' +
      '<button type="button" class="av-link" data-copy="' + esc(h.id) + '">Share link to this home</button></div></div>' +
      '<div class="av-open-box"><h3>Open in the next ' + SUMMARY_DAYS + ' days</h3>' + summary + '</div>' +
      '<div class="av-months">' + months + '</div>' + more;
  }

  function show(home, opts) {
    opts = opts || {};
    el.status.hidden = true;
    if (home) {
      el.all.hidden = true;
      renderOne(home);
      el.one.hidden = false;
    } else {
      el.one.hidden = true;
      renderAll();
      el.all.hidden = false;
    }
    if (el.select.value !== (home ? home.id : '')) el.select.value = home ? home.id : '';
    if (opts.push !== false) {
      try { history.replaceState(null, '', home ? '?p=' + encodeURIComponent(home.id) : location.pathname); } catch (e) { /* sandboxed */ }
    }
    document.title = (home ? home.name + ' availability' : 'Availability') + ' | Desert Sage Rentals';
    if (opts.focus) {
      var target = home ? el.one.querySelector('h2') : el.select;
      if (target) {
        try { target.focus({ preventScroll: true }); } catch (e) { target.focus(); }
        (home ? el.one : el.all).scrollIntoView({ block: 'start' });
      }
    }
  }

  function setStatus(html, isError) {
    el.status.innerHTML = html;
    el.status.classList.toggle('is-error', !!isError);
    el.status.hidden = false;
    el.all.hidden = true;
    el.one.hidden = true;
  }

  // ------------------------------------------------------------ events
  el.select.addEventListener('change', function () {
    state.months = MONTHS_FIRST;
    show(findHome(el.select.value));
  });
  el.copy.addEventListener('click', function () {
    var h = findHome(el.select.value);
    shareLink(linkFor(h), h);
  });
  el.shareClose.addEventListener('click', function () { el.share.hidden = true; el.copy.focus(); });
  document.addEventListener('click', function (e) {
    var t = e.target.closest ? e.target.closest('[data-open],[data-copy],[data-more-days],[data-more-months],[data-retry]') : null;
    if (!t) return;
    if (t.hasAttribute('data-open')) {
      state.months = MONTHS_FIRST;
      show(findHome(t.getAttribute('data-open')), { focus: true });
    } else if (t.hasAttribute('data-copy')) {
      var h = findHome(t.getAttribute('data-copy'));
      if (h) shareLink(linkFor(h), h);
    } else if (t.hasAttribute('data-more-days')) {
      var sc = el.all.querySelector('.av-scroll');
      var left = sc ? sc.scrollLeft : 0;
      state.gridDays += GRID_DAYS;
      renderAll();
      var sc2 = el.all.querySelector('.av-scroll');
      if (sc2) sc2.scrollLeft = left;
      var btn = el.all.querySelector('[data-more-days]');
      (btn || sc2 || el.select).focus();
    } else if (t.hasAttribute('data-more-months')) {
      var before = state.months;
      state.months += 6;
      renderOne(findHome(el.select.value));
      var h3 = el.one.querySelector('h3[data-month="' + before + '"]');
      if (h3) h3.focus();
    } else if (t.hasAttribute('data-retry')) {
      load(false);
    }
  });

  // ------------------------------------------------------------ boot
  function requested() {
    var q = null;
    try { q = new URLSearchParams(location.search).get('p'); } catch (e) { q = null; }
    if (!q && location.hash) {
      try { q = decodeURIComponent(location.hash.slice(1)); } catch (e) { q = location.hash.slice(1); }
    }
    return q;
  }

  // quiet = refresh in the background (tab came back into view): keep the
  // current view on screen and only flag it if the refresh fails.
  function load(quiet) {
    if (state.loading) return;
    state.loading = true;
    if (!quiet) setStatus('Loading availability…', false);
    var fresh = !!state.loadedAt;
    Promise.all([fetchJson(API_URL, TIMEOUT_MS, fresh), loadDecorations()])
      .then(function (r) {
        var current = quiet ? findHome(el.select.value) : null;
        normalise(r[0], r[1]);
        state.loadedAt = Date.now();
        renderUpdated();
        if (!state.homes.length) {
          setStatus('No homes are listed right now.', false);
          return;
        }
        var want = quiet ? (current && current.id) : requested();
        var home = findHome(want);
        renderSelect(home);
        try {
          show(home, { push: false });
        } catch (err) {
          // A rendering problem with one home must not take the page down.
          console.error('[availability] render failed', err);
          show(null, { push: false });
        }
        if (!quiet && want && !home) toast('That home is not listed right now. Showing all homes.');
      })
      .catch(function (err) {
        console.error('[availability] load failed', err);
        if (quiet && state.data) {
          el.updated.classList.add('is-stale');
          return;
        }
        el.select.disabled = true;
        el.copy.disabled = true;
        setStatus('We couldn’t load availability right now.<br><button type="button" class="av-btn" data-retry="1">Try again</button>', true);
      })
      .finally(function () { state.loading = false; });
  }

  function maybeRefresh() {
    if (document.visibilityState === 'hidden') return;
    if (state.loadedAt && Date.now() - state.loadedAt > REFRESH_AFTER_MS) load(true);
  }
  document.addEventListener('visibilitychange', maybeRefresh);
  window.addEventListener('pageshow', function (e) { if (e.persisted) maybeRefresh(); });

  load(false);
})();
