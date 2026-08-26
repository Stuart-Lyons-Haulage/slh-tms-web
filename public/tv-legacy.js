(function () {
  'use strict';

  var root = document.getElementById('root');
  if (!root) { return; }

  var MAX_ROWS = 10;
  var PINNED_EXCEPTIONS = 4;
  var ROTATE_MS = 15000;
  var REFRESH_MS = 60000;
  var normalOffset = 0;

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function queryValue(name) {
    var sources = [window.location.search || '', window.location.hash || ''];
    var i, text, parts, j, pair;
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
    var start = lastSundayUtc(year, 2);
    var end = lastSundayUtc(year, 9);
    return date >= start && date < end ? 60 : 0;
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
  function formatClock(value) {
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
  function formatTime(value) { return value ? formatClock(value) : '--:--'; }
  function formatDuration(minutes) {
    var value = Math.max(0, Math.round(Number(minutes) || 0));
    if (value < 60) { return value + 'm'; }
    return Math.floor(value / 60) + 'h ' + pad(value % 60) + 'm';
  }

  function firstStop(load) {
    var stops = load && load.stops ? load.stops.slice(0) : [];
    stops.sort(function (a, b) { return (a.sequence || 0) - (b.sequence || 0); });
    return stops.length ? stops[0] : null;
  }

  function runLabel(reference, plannedUtc) {
    var raw = String(reference || '').trim();
    var match = /^Run\s+(\d+)\s*(AM|PM)$/i.exec(raw);
    if (match) { return 'Run ' + parseInt(match[1], 10) + ' ' + match[2].toUpperCase(); }
    match = /^(\d+)\s*(AM|PM)$/i.exec(raw);
    if (match) { return 'Run ' + parseInt(match[1], 10) + ' ' + match[2].toUpperCase(); }
    match = /^L0*(\d+)$/i.exec(raw);
    if (match) {
      var n = parseInt(match[1], 10) || 1;
      var d = plannedUtc ? ukDate(plannedUtc) : null;
      var pm = d ? d.getUTCHours() >= 15 : false;
      return 'Run ' + (pm ? 49 + n : n) + ' ' + (pm ? 'PM' : 'AM');
    }
    match = /^(\d+)$/.exec(raw);
    if (match) {
      var direct = parseInt(match[1], 10) || 1;
      var planned = plannedUtc ? ukDate(plannedUtc) : null;
      var isPm = direct >= 50 || (planned && planned.getUTCHours() >= 15);
      return 'Run ' + direct + ' ' + (isPm ? 'PM' : 'AM');
    }
    return raw || 'Run TBC';
  }

  function indexBy(items, field) {
    var result = {};
    var i;
    for (i = 0; i < (items || []).length; i += 1) { result[String(items[i][field])] = items[i]; }
    return result;
  }
  function etasByLoad(items) {
    var result = {};
    var i;
    for (i = 0; i < (items || []).length; i += 1) {
      var id = String(items[i].loadId);
      if (!result[id]) { result[id] = []; }
      result[id].push(items[i]);
    }
    return result;
  }
  function nextEta(list, progress) {
    var values = (list || []).slice(0);
    values.sort(function (a, b) { return (a.sequence || 0) - (b.sequence || 0); });
    var seq = progress && progress.nextStop ? progress.nextStop.sequence : null;
    var nextId = progress && progress.nextStopId ? String(progress.nextStopId) : '';
    var i;
    if (nextId) {
      for (i = 0; i < values.length; i += 1) {
        if (String(values[i].stopId || values[i].loadStopId || '') === nextId) { return values[i]; }
      }
    }
    if (seq != null) {
      for (i = 0; i < values.length; i += 1) { if ((values[i].sequence || 0) >= seq) { return values[i]; } }
    }
    return values.length ? values[values.length - 1] : null;
  }

  function etaLateMinutes(eta) {
    if (!eta || !eta.etaUtc || !eta.deliveryWindowEndUtc) { return null; }
    var actual = new Date(eta.etaUtc).getTime();
    var end = new Date(eta.deliveryWindowEndUtc).getTime();
    if (isNaN(actual) || isNaN(end) || actual <= end) { return null; }
    return Math.max(1, Math.round((actual - end) / 60000));
  }

  function statusInfo(progress, eta, dwell) {
    if (eta && eta.source === 'Live' && eta.risk === 'Late') {
      return { label: 'LATE ETA', detail: eta.stopName || 'Delivery', cls: 'late', exception: true, priority: 1000, kind: 'late' };
    }
    if (dwell && Number(dwell.dwellMinutes) >= 60) {
      return { label: 'DWELL 1H+', detail: dwell.geofenceName || (progress ? progress.focusStop : 'On site'), cls: 'dwell', exception: true, priority: 950, kind: 'dwell' };
    }
    if (eta && eta.source === 'Live' && eta.risk === 'AtRisk') {
      return { label: 'AT RISK', detail: eta.stopName || 'Delivery', cls: 'risk', exception: true, priority: 900, kind: 'risk' };
    }
    if (progress && progress.trackingFresh === false && progress.trackingAgeSeconds != null && progress.trackingAgeSeconds > 300) {
      return { label: 'TRACKING STALE', detail: progress.focusStop || (eta ? eta.stopName : ''), cls: 'stale', exception: false, priority: 650, kind: 'tracking' };
    }
    if (progress && progress.geofenceOnSite) {
      return { label: 'ON SITE', detail: progress.focusStop || 'Matched geofence', cls: 'onsite', exception: false, priority: 500, kind: 'onsite' };
    }
    if (progress && progress.trackingMoving) {
      return { label: 'ON ROUTE', detail: progress.focusStop || (eta ? eta.stopName : ''), cls: 'route', exception: false, priority: 450, kind: 'route' };
    }
    if ((progress && progress.completedStops > 0) || (eta && (eta.source === 'Live' || eta.source === 'Estimated'))) {
      return { label: 'ON ROUTE', detail: progress && progress.focusStop ? progress.focusStop : (eta ? eta.stopName : ''), cls: 'route', exception: false, priority: 400, kind: 'route' };
    }
    return { label: 'UPCOMING', detail: eta ? eta.stopName : 'Awaiting live evidence', cls: 'scheduled', exception: false, priority: 100, kind: 'upcoming' };
  }

  function shortName(value) {
    var text = String(value || 'Job').replace(/^Collect · |^Deliver · /i, '');
    return text.length > 31 ? text.substr(0, 29) + '…' : text;
  }

  function trackingWarning(progress) {
    if (!progress || progress.trackingFresh !== false || progress.trackingAgeSeconds == null) { return ''; }
    return ' · tracking ' + Math.max(1, Math.round(Number(progress.trackingAgeSeconds) / 60)) + 'm old';
  }

  function fallbackStops(load) {
    var stops = load && load.stops ? load.stops.slice(0) : [];
    stops.sort(function (a, b) { return (a.sequence || 0) - (b.sequence || 0); });
    return stops;
  }

  function timelineMarkup(load, progress, eta, dwell) {
    var stops = progress && progress.stops && progress.stops.length ? progress.stops.slice(0) : fallbackStops(load);
    stops.sort(function (a, b) { return (a.sequence || 0) - (b.sequence || 0); });
    var count = Math.max(stops.length, progress ? progress.totalStops || 0 : 0, 1);
    var done = progress ? progress.completedStops || 0 : 0;
    var dots = '';
    var i;
    for (i = 0; i < count; i += 1) {
      var pct = ((i + 1) / count) * 100;
      var stateName = stops[i] && stops[i].state ? String(stops[i].state).toLowerCase() : '';
      var cls = '';
      if (stateName === 'completed' || (!stateName && i < done)) { cls = ' done'; }
      else if (stateName === 'onsite') { cls = ' onsite'; }
      else if (stateName === 'heading' || (!stateName && i === done)) { cls = ' next'; }
      dots += '<span class="timeline-dot' + cls + '" style="left:' + pct + '%"></span>';
    }

    var truckPct = progress && progress.truckPositionPercent != null ? Number(progress.truckPositionPercent) : null;
    if (truckPct == null || isNaN(truckPct)) { truckPct = Math.max(0, Math.min(100, (done / count) * 100)); }
    truckPct = Math.max(0, Math.min(100, truckPct));
    var donePct = Math.max(0, Math.min(100, (done / count) * 100));
    var fillPct = Math.max(donePct, truckPct);
    var liveMarker = progress && progress.trackingFresh
      ? '<span class="timeline-vehicle' + (progress.trackingMoving ? ' moving' : '') + '" style="left:' + truckPct + '%"></span>'
      : '';
    var next = progress && progress.focusStop ? progress.focusStop : (eta ? eta.stopName : 'Next job TBC');
    var helper;
    if (dwell && Number(dwell.dwellMinutes) > 0) {
      helper = 'On site: ' + shortName(dwell.geofenceName || next) + ' · ' + formatDuration(dwell.dwellMinutes);
    } else {
      helper = (progress && progress.geofenceOnSite ? 'On site: ' : 'Next: ') + shortName(next);
      if (progress && progress.trackingMoving && progress.speedKph != null) { helper += ' · ' + Math.round(Number(progress.speedKph)) + ' km/h'; }
      helper += trackingWarning(progress);
    }
    return '<div class="timeline"><span class="timeline-line"></span><span class="timeline-done" style="width:' + fillPct + '%"></span>' + dots + liveMarker + '</div><div class="next-job">' + esc(helper) + '</div>';
  }

  function isRunComplete(load, progress) {
    var loadStatus = String(load && load.status ? load.status : '').toLowerCase();
    if (loadStatus === 'completed' || loadStatus === 'complete') { return true; }
    var phase = String(progress && progress.phase ? progress.phase : '').toLowerCase();
    if (phase === 'completed' || phase === 'complete') { return true; }
    var total = progress && Number(progress.totalStops);
    var completed = progress && Number(progress.completedStops);
    return total > 0 && completed >= total;
  }

  function attentionMarkup(rows) {
    var exceptions = [];
    var i;
    for (i = 0; i < rows.length; i += 1) { if (rows[i].status.exception) { exceptions.push(rows[i]); } }
    exceptions.sort(function (a, b) { return b.status.priority - a.status.priority; });
    if (!exceptions.length) {
      return '<div class="attention-clear"><span class="clear-check">✓</span><b>No immediate exceptions</b><small>Late ETA, route risk and 1h+ geofence dwell are clear.</small></div>';
    }
    var html = '';
    for (i = 0; i < Math.min(4, exceptions.length); i += 1) {
      var row = exceptions[i];
      var detail = row.status.detail;
      var value = '';
      var sub = '';
      if (row.status.kind === 'late') {
        var late = etaLateMinutes(row.eta);
        value = late == null ? 'LATE' : '+' + late;
        sub = late == null ? '' : 'min';
      } else if (row.status.kind === 'dwell') {
        value = formatDuration(row.dwell ? row.dwell.dwellMinutes : 0);
        sub = 'dwell';
      } else if (row.status.kind === 'risk') {
        value = formatTime(row.eta ? row.eta.etaUtc : null);
        sub = 'ETA';
      }
      html += '<div class="attention-card ' + esc(row.status.cls) + '">' +
        '<span class="attention-icon">' + (row.status.kind === 'late' ? '!' : row.status.kind === 'dwell' ? '◷' : '▲') + '</span>' +
        '<div class="attention-copy"><b>' + esc(row.runName) + '</b><strong>' + esc(shortName(detail)) + '</strong><small>' + esc(row.status.label) + '</small></div>' +
        '<div class="attention-value"><b>' + esc(value) + '</b><small>' + esc(sub) + '</small></div></div>';
    }
    return html;
  }

  function kpi(label, value, cls, symbol) {
    return '<div class="kpi ' + cls + '"><span class="kpi-icon">' + esc(symbol) + '</span><div><small>' + esc(label) + '</small><b>' + esc(value) + '</b></div></div>';
  }

  var key = queryValue('key');
  var date = todayIso();
  var state = { loads: [], assignments: [], progress: [], etas: [], dwell: [], trackingSource: '', error: '' };

  root.innerHTML = '<div id="legacy-tv">' +
    '<div class="legacy-head"><div class="brand-wrap"><div class="brand-mark"><b>LYONS</b><span>HAULAGE</span></div><div class="head-divider"></div><h1>Live Operations</h1></div><div class="legacy-clock"><span id="legacy-date"></span><b id="legacy-clock"></b><small>● LIVE OFFICE WALLBOARD</small></div></div>' +
    '<div id="legacy-message">Connecting to live TMS data…</div>' +
    '<div id="legacy-kpis"></div>' +
    '<div class="board-grid"><div class="runs-panel"><div id="legacy-board"></div></div><aside class="attention-panel"><h2>ATTENTION · NEEDS ACTION</h2><div id="legacy-attention"></div></aside></div>' +
    '<div class="legacy-foot"><span><b>LIVE OPERATIONS</b> · active runs auto-rotate every 15s</span><span id="legacy-source"></span><span id="legacy-refresh"></span></div></div>';

  function updateClock() {
    var now = new Date();
    var clock = document.getElementById('legacy-clock');
    var dateNode = document.getElementById('legacy-date');
    if (clock) { clock.innerHTML = esc(formatClock(now)); }
    if (dateNode) { dateNode.innerHTML = esc(formatDate(now)); }
  }

  function request(path, callback) {
    var xhr;
    var requestPath = path;
    var isTvDisplay = requestPath.indexOf('/api/v1/tv-display/') === 0;
    if (key && isTvDisplay) {
      requestPath += (requestPath.indexOf('?') >= 0 ? '&' : '?') + 'key=' + encodeURIComponent(key);
    }
    try { xhr = new XMLHttpRequest(); } catch (e) { callback(e); return; }
    xhr.open('GET', '/tms-api' + requestPath, true);
    xhr.setRequestHeader('Accept', 'application/json');
    if (key) {
      xhr.setRequestHeader('X-TMS-TV-Key', key);
      if (isTvDisplay) { xhr.setRequestHeader('X-TV-Display-Key', key); }
    }
    xhr.onreadystatechange = function () {
      if (xhr.readyState !== 4) { return; }
      if (xhr.status >= 200 && xhr.status < 300) {
        try { callback(null, JSON.parse(xhr.responseText)); } catch (e) { callback(e); }
      } else {
        callback(new Error('TMS API returned ' + xhr.status + (xhr.status === 401 || xhr.status === 403 ? '. Check the TV access key.' : '.')));
      }
    };
    xhr.onerror = function () { callback(new Error('The TV could not reach the TMS API.')); };
    try { xhr.send(); } catch (e) { callback(e); }
  }

  function buildRows() {
    var assignments = indexBy(state.assignments, 'loadId');
    var progress = indexBy(state.progress, 'loadId');
    var dwellByLoad = indexBy(state.dwell, 'loadId');
    var etaGroups = etasByLoad(state.etas);
    var rows = [];
    var i;
    for (i = 0; i < state.loads.length; i += 1) {
      var load = state.loads[i];
      var prog = progress[String(load.id)];
      // A date reset can leave a cancelled live-table tombstone while the freshly
      // re-imported planning-register run is active. Route-progress is the execution
      // authority here: keep the row when it proves the same load is active.
      if (load.status === 'Cancelled' && !prog) { continue; }
      var complete = isRunComplete(load, prog);
      var assignment = assignments[String(load.id)] || {};
      var eta = nextEta(etaGroups[String(load.id)], prog);
      var dwell = dwellByLoad[String(load.id)] || null;
      var status = complete ? { label: 'COMPLETE', detail: 'Run complete', cls: 'complete', exception: false, priority: 0, kind: 'complete' } : statusInfo(prog, eta, dwell);
      var stop = firstStop(load);
      rows.push({
        load: load,
        prog: prog,
        assignment: assignment,
        eta: eta,
        dwell: dwell,
        status: status,
        complete: complete,
        time: stop && stop.plannedArrivalUtc ? new Date(stop.plannedArrivalUtc).getTime() : 9999999999999,
        runName: runLabel(load.reference, stop ? stop.plannedArrivalUtc : '')
      });
    }
    rows.sort(function (a, b) {
      if (a.complete !== b.complete) { return a.complete ? 1 : -1; }
      if (a.status.priority !== b.status.priority) { return b.status.priority - a.status.priority; }
      return a.time - b.time;
    });
    return rows;
  }

  function selectedRows(rows) {
    var active = [];
    var exceptions = [];
    var normals = [];
    var i;
    for (i = 0; i < rows.length; i += 1) {
      if (rows[i].complete) { continue; }
      active.push(rows[i]);
      if (rows[i].status.exception) { exceptions.push(rows[i]); } else { normals.push(rows[i]); }
    }
    exceptions.sort(function (a, b) { return b.status.priority - a.status.priority; });
    normals.sort(function (a, b) {
      if (a.status.priority !== b.status.priority) { return b.status.priority - a.status.priority; }
      return a.time - b.time;
    });
    var result = exceptions.slice(0, Math.min(PINNED_EXCEPTIONS, MAX_ROWS));
    var slots = MAX_ROWS - result.length;
    if (slots <= 0 || !normals.length) { return result.slice(0, MAX_ROWS); }
    if (normalOffset >= normals.length) { normalOffset = 0; }
    for (i = 0; i < slots && i < normals.length; i += 1) {
      result.push(normals[(normalOffset + i) % normals.length]);
    }
    return result;
  }

  function render() {
    var board = document.getElementById('legacy-board');
    var message = document.getElementById('legacy-message');
    var kpis = document.getElementById('legacy-kpis');
    var attention = document.getElementById('legacy-attention');
    if (!board || !message || !kpis || !attention) { return; }

    if (state.error) {
      message.className = 'legacy-error';
      message.innerHTML = '<b>Wallboard connection problem:</b> ' + esc(state.error);
    } else {
      message.className = 'legacy-ok';
      message.innerHTML = 'LIVE DATA · RoadTech + geofences + live ETA';
    }

    var rows = buildRows();
    var shown = selectedRows(rows);
    var activeCount = 0;
    var onSiteCount = 0;
    var riskCount = 0;
    var lateCount = 0;
    var dwellCount = 0;
    var i;
    for (i = 0; i < rows.length; i += 1) {
      var rowCount = rows[i];
      if (rowCount.complete) { continue; }
      activeCount += 1;
      if (rowCount.prog && rowCount.prog.geofenceOnSite) { onSiteCount += 1; }
      if (rowCount.status.kind === 'risk') { riskCount += 1; }
      if (rowCount.status.kind === 'late') { lateCount += 1; }
      if (rowCount.dwell && Number(rowCount.dwell.dwellMinutes) >= 60) { dwellCount += 1; }
    }

    kpis.innerHTML = kpi('STILL OUT', activeCount, 'active', '▣') +
      kpi('ON SITE', onSiteCount, 'onsite', '●') +
      kpi('AT RISK', riskCount, 'risk', '!') +
      kpi('LATE ETA', lateCount, 'late', '◷') +
      kpi('DWELL > 1 HOUR', dwellCount, 'dwell', '◴');

    var html = '<table><thead><tr><th>RUN</th><th>VEHICLE</th><th>DRIVER</th><th>JOURNEY PROGRESS</th><th>NEXT / ETA</th><th>STATUS</th></tr></thead><tbody>';
    for (i = 0; i < shown.length; i += 1) {
      var row = shown[i];
      var vehicle = row.assignment.vehicle && row.assignment.vehicle.registration ? row.assignment.vehicle.registration : (row.eta && row.eta.vehicleRegistration ? row.eta.vehicleRegistration : 'TBC');
      var driver = row.assignment.driver && row.assignment.driver.displayName ? row.assignment.driver.displayName : (row.eta && row.eta.tachoDriverName ? row.eta.tachoDriverName : 'TBC');
      var etaTime = row.eta && row.eta.etaUtc ? formatTime(row.eta.etaUtc) : '--:--';
      var next = row.prog && row.prog.focusStop ? row.prog.focusStop : (row.eta ? row.eta.stopName : 'Next job TBC');
      var rowClass = row.status.exception ? ' exception ' + row.status.cls : '';
      var detailBadge = '';
      if (row.status.kind === 'late') {
        var lateMinutes = etaLateMinutes(row.eta);
        detailBadge = '<small class="row-alert">' + esc(lateMinutes == null ? 'LIVE ETA LATE' : 'ETA +' + lateMinutes + ' MIN') + '</small>';
      } else if (row.status.kind === 'dwell') {
        detailBadge = '<small class="row-alert">DWELL ' + esc(formatDuration(row.dwell ? row.dwell.dwellMinutes : 0)) + '</small>';
      }
      html += '<tr class="' + rowClass + '">' +
        '<td><b class="run-name">' + esc(row.runName) + '</b></td>' +
        '<td><b>' + esc(vehicle) + '</b></td>' +
        '<td><b>' + esc(driver) + '</b></td>' +
        '<td>' + timelineMarkup(row.load, row.prog, row.eta, row.dwell) + '</td>' +
        '<td><b class="next-name">' + esc(shortName(next)) + '</b><span class="eta-time">' + esc(etaTime) + '</span>' + detailBadge + '</td>' +
        '<td><strong class="status ' + esc(row.status.cls) + '">' + esc(row.status.label) + '</strong></td></tr>';
    }
    html += '</tbody></table>';
    if (!shown.length && !state.error) { html = '<div class="legacy-empty">No active runs. Completed runs remain counted above.</div>'; }
    board.innerHTML = html;
    attention.innerHTML = attentionMarkup(rows);

    var source = document.getElementById('legacy-source');
    if (source) { source.innerHTML = esc(state.trackingSource ? 'Tracking: ' + state.trackingSource : 'Tracking connected'); }
    var refreshed = document.getElementById('legacy-refresh');
    if (refreshed) { refreshed.innerHTML = 'Updated ' + esc(formatClock(new Date())) + ' · ETAs refresh 60s'; }
  }

  function rotateRows() {
    var rows = buildRows();
    var normalCount = 0;
    var exceptionCount = 0;
    var i;
    for (i = 0; i < rows.length; i += 1) {
      if (rows[i].complete) { continue; }
      if (rows[i].status.exception) { exceptionCount += 1; } else { normalCount += 1; }
    }
    var slots = MAX_ROWS - Math.min(PINNED_EXCEPTIONS, exceptionCount);
    if (slots > 0 && normalCount > slots) {
      normalOffset = (normalOffset + slots) % normalCount;
      render();
    }
  }

  function refresh() {
    date = todayIso();
    if (!key) {
      state.error = 'This TV link has no access key. Open the dedicated keyed TV link.';
      render();
      return;
    }
    var pending = 5;
    var errors = [];
    function done(name, err, data) {
      if (err) {
        if (name !== 'progress' && name !== 'dwell' && name !== 'etas') { errors.push(name + ': ' + err.message); }
      } else if (name === 'loads') { state.loads = data || []; }
      else if (name === 'assignments') { state.assignments = data || []; }
      else if (name === 'progress') {
        state.progress = data && data.runs ? data.runs : state.progress;
        state.trackingSource = data && data.trackingSource ? data.trackingSource : state.trackingSource;
      }
      else if (name === 'etas') { state.etas = data && data.records ? data.records : []; }
      else if (name === 'dwell') { state.dwell = data && data.runs ? data.runs : []; }
      pending -= 1;
      if (pending === 0) {
        state.error = errors.join(' ');
        normalOffset = 0;
        render();
      }
    }
    request('/api/v1/loads?date=' + encodeURIComponent(date), function (e, d) { done('loads', e, d); });
    request('/api/v1/driver-assignments?from=' + encodeURIComponent(date) + '&to=' + encodeURIComponent(date), function (e, d) { done('assignments', e, d); });
    request('/api/v1/tv-display/route-progress?date=' + encodeURIComponent(date), function (e, d) { done('progress', e, d); });
    request('/api/v1/operations/delivery-etas?date=' + encodeURIComponent(date), function (e, d) { done('etas', e, d); });
    request('/api/v1/tv-display/dwell?date=' + encodeURIComponent(date), function (e, d) { done('dwell', e, d); });
  }

  updateClock();
  window.setInterval(updateClock, 1000);
  refresh();
  window.setInterval(refresh, REFRESH_MS);
  window.setInterval(rotateRows, ROTATE_MS);
}());
