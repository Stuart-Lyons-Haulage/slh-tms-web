(function () {
  'use strict';

  var root = document.getElementById('root');
  if (!root) { return; }

  var PAGE_SIZE = 8;
  var ROTATE_MS = 30000;
  var REFRESH_MS = 20000;
  var pageIndex = 0;
  var state = { loads: [], assignments: [], progress: [], etas: [], error: '', refreshedAt: null };

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function queryValue(name) {
    var sources = [window.location.search || '', window.location.hash || ''];
    var i, j, text, parts, pair;
    for (i = 0; i < sources.length; i += 1) {
      text = sources[i].replace(/^[?#]/, '');
      if (!text) { continue; }
      parts = text.split('&');
      for (j = 0; j < parts.length; j += 1) {
        pair = parts[j].split('=');
        if (decodeURIComponent(pair[0] || '') === name) {
          return decodeURIComponent((pair.slice(1).join('=') || '').replace(/\+/g, ' '));
        }
      }
    }
    return '';
  }

  function pad(value) { return value < 10 ? '0' + value : String(value); }
  function lastSundayUtc(year, month) {
    var d = new Date(Date.UTC(year, month + 1, 0));
    return new Date(Date.UTC(year, month, d.getUTCDate() - d.getUTCDay(), 1, 0, 0));
  }
  function ukOffsetMinutes(date) {
    var year = date.getUTCFullYear();
    return date >= lastSundayUtc(year, 2) && date < lastSundayUtc(year, 9) ? 60 : 0;
  }
  function ukDate(value) {
    var date = value instanceof Date ? value : new Date(value);
    if (isNaN(date.getTime())) { return null; }
    return new Date(date.getTime() + ukOffsetMinutes(date) * 60000);
  }
  function todayIso() {
    var d = ukDate(new Date());
    return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate());
  }
  function formatTime(value) {
    var d = ukDate(value instanceof Date ? value : new Date(value));
    return d ? pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes()) : '--:--';
  }
  function formatDate(value) {
    var d = ukDate(value instanceof Date ? value : new Date(value));
    if (!d) { return ''; }
    var days = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
    var months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
    return days[d.getUTCDay()] + ' ' + pad(d.getUTCDate()) + ' ' + months[d.getUTCMonth()] + ' ' + d.getUTCFullYear();
  }

  function firstStop(load) {
    var stops = load && load.stops ? load.stops.slice(0) : [];
    stops.sort(function (a, b) { return Number(a.sequence || 0) - Number(b.sequence || 0); });
    return stops.length ? stops[0] : null;
  }
  function finalStop(load) {
    var stops = load && load.stops ? load.stops.slice(0) : [];
    stops.sort(function (a, b) { return Number(a.sequence || 0) - Number(b.sequence || 0); });
    return stops.length ? stops[stops.length - 1] : null;
  }
  function cleanStop(value) { return String(value || 'TBC').replace(/^Collect\s*[·:-]?\s*|^Deliver\s*[·:-]?\s*/i, ''); }

  function indexBy(items, field) {
    var result = {}, i;
    for (i = 0; i < (items || []).length; i += 1) { result[String(items[i][field])] = items[i]; }
    return result;
  }
  function etasByLoad(items) {
    var result = {}, i, id;
    for (i = 0; i < (items || []).length; i += 1) {
      id = String(items[i].loadId);
      if (!result[id]) { result[id] = []; }
      result[id].push(items[i]);
    }
    return result;
  }
  function finalEta(list) {
    var values = (list || []).slice(0);
    values.sort(function (a, b) { return Number(a.sequence || 0) - Number(b.sequence || 0); });
    return values.length ? values[values.length - 1] : null;
  }

  var key = queryValue('key');

  function pairScreen(message) {
    root.innerHTML = '<div class="tv2"><div class="tv2-pair"><img src="/lyons-logo.svg" alt="Lyons"><h1>Pair this TV</h1><p>' + esc(message || 'Enter the 6-digit code from TV Display in the signed-in TMS.') + '</p><form id="tv2-pair-form"><input id="tv2-pair-code" type="tel" inputmode="numeric" maxlength="6" placeholder="000000" autocomplete="off"><button type="submit">Pair TV</button></form><div id="tv2-pair-error" class="tv2-pair-error"></div></div></div>';
    var form = document.getElementById('tv2-pair-form');
    var code = document.getElementById('tv2-pair-code');
    var error = document.getElementById('tv2-pair-error');
    if (!form || !code) { return; }
    form.onsubmit = function (event) {
      if (event && event.preventDefault) { event.preventDefault(); }
      var value = String(code.value || '').replace(/\D/g, '').substr(0, 6);
      if (value.length !== 6) { if (error) { error.innerHTML = 'Enter all 6 digits.'; } return false; }
      var xhr = new XMLHttpRequest();
      xhr.open('POST', '/tms-api/api/v1/tv-display/pair', true);
      xhr.setRequestHeader('Content-Type', 'application/json');
      xhr.setRequestHeader('Accept', 'application/json');
      xhr.onreadystatechange = function () {
        if (xhr.readyState !== 4) { return; }
        var data = null;
        try { data = JSON.parse(xhr.responseText || 'null'); } catch (ignore) {}
        if (xhr.status >= 200 && xhr.status < 300 && data && data.key) {
          window.location.replace('/tv.html?key=' + encodeURIComponent(data.key));
        } else if (error) {
          error.innerHTML = esc((data && data.message) || 'That pairing code could not be accepted.');
        }
      };
      xhr.send(JSON.stringify({ code: value }));
      return false;
    };
  }

  if (!key) { pairScreen(); return; }

  root.innerHTML = '<div class="tv2"><header class="tv2-head"><img class="tv2-logo" src="/lyons-logo.svg" alt="Lyons"><div class="tv2-brand"><small>SLH OPERATIONS WALLBOARD</small><h1>Arrivals &amp; Departures</h1></div><div class="tv2-clock"><b id="tv2-clock"></b><span id="tv2-date"></span></div></header><section class="tv2-attention"><div class="tv2-attention-title">ATTENTION · NEEDS ACTION</div><div id="tv2-attention" class="tv2-attention-copy ok"><strong>Checking live operations…</strong></div></section><div id="tv2-error"></div><div id="tv2-coverage" class="tv2-coverage"></div><main id="tv2-table" class="tv2-table-wrap"></main><footer class="tv2-foot"><span><b>LIVE OPERATIONS</b> · earliest runs first · next rows every 30 seconds</span><span id="tv2-page"></span><span id="tv2-refresh"></span></footer></div>';

  function updateClock() {
    var now = new Date();
    var clock = document.getElementById('tv2-clock');
    var date = document.getElementById('tv2-date');
    if (clock) { clock.innerHTML = esc(formatTime(now)); }
    if (date) { date.innerHTML = esc(formatDate(now)); }
  }

  function request(path, callback) {
    var xhr = new XMLHttpRequest();
    var separator = path.indexOf('?') >= 0 ? '&' : '?';
    var url = '/tms-api' + path + separator + 'key=' + encodeURIComponent(key);
    xhr.open('GET', url, true);
    xhr.setRequestHeader('Accept', 'application/json');
    try { xhr.setRequestHeader('X-TV-Display-Key', key); } catch (ignore1) {}
    try { xhr.setRequestHeader('X-TMS-TV-Key', key); } catch (ignore2) {}
    xhr.timeout = 20000;
    xhr.onreadystatechange = function () {
      if (xhr.readyState !== 4) { return; }
      if (xhr.status >= 200 && xhr.status < 300) {
        try { callback(null, JSON.parse(xhr.responseText || 'null'), xhr.status); }
        catch (e) { callback(e, null, xhr.status); }
      } else {
        callback(new Error('TMS API returned ' + xhr.status), null, xhr.status);
      }
    };
    xhr.onerror = function () { callback(new Error('The TV could not reach the TMS API.'), null, 0); };
    xhr.ontimeout = function () { callback(new Error('The TMS API did not respond in time.'), null, 0); };
    try { xhr.send(); } catch (e) { callback(e, null, 0); }
  }

  function statusFor(load, assignment, progress, eta) {
    if (eta && String(eta.risk || '').toLowerCase() === 'late') { return { kind: 'late', label: 'LATE', detail: cleanStop(eta.stopName), priority: 100 }; }
    if (eta && /atrisk|at risk/i.test(String(eta.risk || ''))) { return { kind: 'risk', label: 'AT RISK', detail: cleanStop(eta.stopName), priority: 90 }; }
    var dwell = progress && progress.currentVisit ? Number(progress.currentVisit.liveDwellMinutes || progress.currentVisit.dwellMinutes || 0) : 0;
    if (dwell >= 60) { return { kind: 'risk', label: 'DWELL 1H+', detail: cleanStop(progress.currentVisit.geofenceName || progress.focusStop), priority: 85 }; }
    if (!assignment || !assignment.driver || !assignment.vehicle) { return { kind: 'risk', label: 'NEEDS ALLOCATION', detail: 'Driver or vehicle missing', priority: 80 }; }
    if (progress && (progress.geofenceOnSite || progress.currentVisit)) { return { kind: 'onsite', label: 'ON SITE', detail: cleanStop(progress.focusStop || (progress.currentVisit && progress.currentVisit.geofenceName)), priority: 50 }; }
    if (progress && (progress.trackingMoving || Number(progress.completedStops || 0) > 0)) { return { kind: 'route', label: 'ON ROUTE', detail: cleanStop(progress.focusStop || (progress.nextStop && progress.nextStop.name)), priority: 40 }; }
    if (/inprogress|dispatched/i.test(String(load.status || ''))) { return { kind: 'route', label: 'IN PROGRESS', detail: 'Awaiting next live update', priority: 35 }; }
    return { kind: 'scheduled', label: 'SCHEDULED', detail: 'Awaiting live movement', priority: 10 };
  }

  function buildRows() {
    var assignments = indexBy(state.assignments, 'loadId');
    var progress = indexBy(state.progress, 'loadId');
    var etaGroups = etasByLoad(state.etas);
    var rows = [], i;
    for (i = 0; i < state.loads.length; i += 1) {
      var load = state.loads[i];
      if (/cancelled|completed/i.test(String(load.status || ''))) { continue; }
      var first = firstStop(load);
      var last = finalStop(load);
      var assignment = assignments[String(load.id)] || null;
      var prog = progress[String(load.id)] || null;
      var eta = finalEta(etaGroups[String(load.id)]);
      var status = statusFor(load, assignment, prog, eta);
      var total = Number((prog && prog.totalStops) || (load.stops && load.stops.length) || 0);
      var completed = Math.min(total, Math.max(0, Number(prog && prog.completedStops || 0)));
      var percent = total > 0 ? Math.round((completed / total) * 100) : 0;
      rows.push({
        id: load.id,
        load: load,
        assignment: assignment,
        progress: prog,
        eta: eta,
        status: status,
        firstUtc: first && first.plannedArrivalUtc,
        firstMs: first && first.plannedArrivalUtc ? new Date(first.plannedArrivalUtc).getTime() : 9999999999999,
        run: assignment && assignment.loadReference ? assignment.loadReference : String(load.reference || 'Run TBC'),
        vehicle: assignment && assignment.vehicle ? assignment.vehicle.registration : 'VEHICLE TBC',
        trailer: assignment && assignment.trailerNumber ? assignment.trailerNumber : '',
        driver: assignment && assignment.driver ? assignment.driver.displayName : 'DRIVER TBC',
        finalName: cleanStop((eta && eta.stopName) || (last && last.name) || 'Final delivery'),
        finalTime: eta && eta.etaUtc ? eta.etaUtc : (last && last.plannedArrivalUtc),
        finalLabel: eta && eta.etaUtc ? (String(eta.source || '').toLowerCase() === 'live' ? 'LIVE FINAL ETA' : 'ESTIMATED FINAL ETA') : 'PLANNED FINAL',
        total: total,
        completed: completed,
        percent: percent
      });
    }
    rows.sort(function (a, b) { return a.firstMs - b.firstMs || String(a.run).localeCompare(String(b.run)); });
    return rows;
  }

  function renderAttention(rows) {
    var node = document.getElementById('tv2-attention');
    if (!node) { return; }
    var issues = rows.filter(function (row) { return row.status.priority >= 80; });
    issues.sort(function (a, b) { return b.status.priority - a.status.priority || a.firstMs - b.firstMs; });
    if (!issues.length) {
      node.className = 'tv2-attention-copy ok';
      node.innerHTML = '<strong>✓ No immediate exceptions</strong><span>Runs remain ordered by first collection time.</span>';
      return;
    }
    var first = issues[0];
    node.className = 'tv2-attention-copy ' + (first.status.kind === 'late' ? 'bad' : 'warn');
    node.innerHTML = '<strong>' + esc(issues.length + ' need attention') + '</strong><span>' + esc(first.run + ' · ' + first.status.label + ' · ' + first.status.detail) + '</span>';
  }

  function render() {
    var rows = buildRows();
    var pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
    if (pageIndex >= pages) { pageIndex = 0; }
    var start = pageIndex * PAGE_SIZE;
    var shown = rows.slice(start, start + PAGE_SIZE);
    var table = document.getElementById('tv2-table');
    var coverage = document.getElementById('tv2-coverage');
    var error = document.getElementById('tv2-error');
    var page = document.getElementById('tv2-page');
    var refreshed = document.getElementById('tv2-refresh');
    var i;

    renderAttention(rows);
    if (error) {
      if (state.error) { error.className = 'tv2-error'; error.innerHTML = esc(state.error); }
      else { error.className = ''; error.innerHTML = ''; }
    }
    if (coverage) {
      var stopCount = 0;
      for (i = 0; i < rows.length; i += 1) { stopCount += Number(rows[i].total || 0); }
      coverage.innerHTML = '<b>RUN VIEW</b><span>' + esc(rows.length + ' active runs') + '</span><span>' + esc(stopCount + ' physical stops') + '</span><span>Duplicate order lines at the same site are shown as one visit</span>';
    }
    if (page) { page.innerHTML = pages > 1 ? 'Rows ' + (start + 1) + '–' + Math.min(start + PAGE_SIZE, rows.length) + ' of ' + rows.length : rows.length + ' active runs'; }
    if (refreshed) { refreshed.innerHTML = state.refreshedAt ? 'Updated ' + esc(formatTime(state.refreshedAt)) : 'Updating…'; }
    if (!table) { return; }
    if (!shown.length) { table.innerHTML = '<div class="tv2-empty">No active runs to display.</div>'; return; }

    var html = '<table class="tv2-table"><thead><tr><th>FIRST COLLECTION</th><th>RUN</th><th>VEHICLE</th><th>DRIVER</th><th>PROGRESS</th><th>FINAL DELIVERY / ETA</th><th>STATUS</th></tr></thead><tbody>';
    for (i = 0; i < shown.length; i += 1) {
      var row = shown[i];
      var focus = row.progress && (row.progress.focusStop || (row.progress.nextStop && row.progress.nextStop.name));
      html += '<tr class="' + esc(row.status.kind) + '">' +
        '<td><b class="tv2-main tv2-time">' + esc(formatTime(row.firstUtc)) + '</b><small class="tv2-sub">first collection</small></td>' +
        '<td><b class="tv2-main">' + esc(row.run) + '</b><small class="tv2-sub">' + esc(cleanStop(focus || 'Planned route')) + '</small></td>' +
        '<td><b class="tv2-main">' + esc(row.vehicle) + '</b><small class="tv2-sub">' + esc(row.trailer ? 'Trailer ' + row.trailer : 'vehicle') + '</small></td>' +
        '<td><b class="tv2-main">' + esc(row.driver) + '</b><small class="tv2-sub">dispatch allocation</small></td>' +
        '<td><div class="tv2-progress"><i style="width:' + esc(row.percent) + '%"></i></div><b class="tv2-main">' + esc(row.completed + ' / ' + row.total) + '</b><small class="tv2-sub">physical stops completed</small></td>' +
        '<td><b class="tv2-main tv2-time tv2-eta">' + esc(formatTime(row.finalTime)) + '</b><small class="tv2-sub">' + esc(row.finalName + ' · ' + row.finalLabel) + '</small></td>' +
        '<td><span class="tv2-status ' + esc(row.status.kind) + '">' + esc(row.status.label) + '</span><small class="tv2-sub">' + esc(row.status.detail) + '</small></td>' +
        '</tr>';
    }
    html += '</tbody></table>';
    table.innerHTML = html;
  }

  function refresh() {
    var date = todayIso();
    var pending = 4;
    var coreUnauthorised = false;
    var coreErrors = [];
    var optionalErrors = [];
    function done(name, err, data, status) {
      if (err) {
        if ((name === 'loads' || name === 'assignments') && (status === 401 || status === 403)) { coreUnauthorised = true; }
        else if (name === 'loads' || name === 'assignments') { coreErrors.push(name + ': ' + err.message); }
        else { optionalErrors.push(name + ': ' + err.message); }
      } else if (name === 'loads') { state.loads = data || []; }
      else if (name === 'assignments') { state.assignments = data || []; }
      else if (name === 'progress') { state.progress = data && data.runs ? data.runs : (data && data.records ? data.records : []); }
      else if (name === 'etas') { state.etas = data && data.records ? data.records : []; }
      pending -= 1;
      if (pending === 0) {
        if (coreUnauthorised) { pairScreen('This TV access key is no longer valid. Generate a fresh 6-digit pairing code from TV Display in the signed-in TMS.'); return; }
        state.error = coreErrors.join(' ');
        state.refreshedAt = new Date();
        render();
      }
    }
    request('/api/v1/tv-display/planned-runs?date=' + encodeURIComponent(date), function (e, d, s) { done('loads', e, d, s); });
    request('/api/v1/tv-display/assignments?date=' + encodeURIComponent(date), function (e, d, s) { done('assignments', e, d, s); });
    request('/api/v1/tv-display/route-progress?date=' + encodeURIComponent(date), function (e, d, s) { done('progress', e, d, s); });
    request('/api/v1/operations/delivery-etas?date=' + encodeURIComponent(date), function (e, d, s) { done('etas', e, d, s); });
  }

  function rotate() {
    var rows = buildRows();
    var pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
    pageIndex = pages > 1 ? (pageIndex + 1) % pages : 0;
    render();
  }

  updateClock();
  window.setInterval(updateClock, 1000);
  refresh();
  window.setInterval(refresh, REFRESH_MS);
  window.setInterval(rotate, ROTATE_MS);
}());