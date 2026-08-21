(function () {
  'use strict';

  var root = document.getElementById('root');
  if (!root) { return; }

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function queryValue(name) {
    var query = window.location.search || '';
    var parts = query.replace(/^\?/, '').split('&');
    var i;
    for (i = 0; i < parts.length; i += 1) {
      var pair = parts[i].split('=');
      if (decodeURIComponent(pair[0] || '') === name) {
        return decodeURIComponent((pair.slice(1).join('=') || '').replace(/\+/g, ' '));
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
    return days[d.getUTCDay()] + ', ' + pad(d.getUTCDate()) + ' ' + months[d.getUTCMonth()] + ' ' + d.getUTCFullYear();
  }
  function formatTime(value) { return value ? formatClock(value) : '--:--'; }

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
    for (i = 0; i < (items || []).length; i += 1) { result[items[i][field]] = items[i]; }
    return result;
  }
  function etasByLoad(items) {
    var result = {};
    var i;
    for (i = 0; i < (items || []).length; i += 1) {
      var id = items[i].loadId;
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

  function statusInfo(progress, eta) {
    if (progress && progress.currentVisit && progress.currentVisit.isDelayed) {
      return ['SITE DELAY', progress.currentVisit.geofenceName || progress.focusStop || 'On site', 'late', true];
    }
    if (eta && eta.source === 'Live' && eta.risk === 'Late') {
      return ['LATE ETA', eta.stopName || 'Delivery', 'late', true];
    }
    if (eta && eta.source === 'Live' && eta.risk === 'AtRisk') {
      return ['AT RISK', eta.stopName || 'Delivery', 'risk', false];
    }
    if (progress && progress.geofenceOnSite) {
      return ['ON SITE', progress.focusStop || 'Matched geofence', 'onsite', false];
    }
    if (progress && progress.trackingMoving) {
      return ['ON ROUTE', progress.focusStop || (eta ? eta.stopName : ''), 'route', false];
    }
    if (progress && progress.trackingFresh === false && progress.trackingAgeSeconds != null && progress.trackingAgeSeconds > 300) {
      return ['TRACKING STALE', progress.focusStop || (eta ? eta.stopName : ''), 'scheduled', false];
    }
    if ((progress && progress.completedStops > 0) || (eta && (eta.source === 'Live' || eta.source === 'Estimated'))) {
      return ['ON ROUTE', progress && progress.focusStop ? progress.focusStop : (eta ? eta.stopName : ''), 'route', false];
    }
    return ['SCHEDULED', eta ? eta.stopName : 'Awaiting live evidence', 'scheduled', false];
  }

  function shortName(value) {
    var text = String(value || 'Job').replace(/^Collect · |^Deliver · /i, '');
    return text.length > 30 ? text.substr(0, 28) + '…' : text;
  }

  function trackingAgeText(progress) {
    if (!progress || progress.trackingAgeSeconds == null) { return ''; }
    var seconds = Math.max(0, Number(progress.trackingAgeSeconds) || 0);
    if (progress.trackingFresh) {
      return seconds < 90 ? ' · live ' + Math.round(seconds) + 's' : ' · live ' + Math.max(1, Math.round(seconds / 60)) + 'm';
    }
    return ' · tracking ' + Math.max(1, Math.round(seconds / 60)) + 'm old';
  }

  function fallbackStops(load) {
    var stops = load && load.stops ? load.stops.slice(0) : [];
    stops.sort(function (a, b) { return (a.sequence || 0) - (b.sequence || 0); });
    return stops;
  }

  function timelineMarkup(load, progress, eta) {
    var stops = progress && progress.stops && progress.stops.length ? progress.stops.slice(0) : fallbackStops(load);
    stops.sort(function (a, b) { return (a.sequence || 0) - (b.sequence || 0); });
    var count = Math.max(stops.length, progress ? progress.totalStops || 0 : 0, 1);
    var done = progress ? progress.completedStops || 0 : 0;
    var dots = '';
    var i;
    for (i = 0; i < count; i += 1) {
      // 0% is an implicit journey START. Stop 1 follows it, so a vehicle heading to
      // its first job is never drawn beyond that job before the geofence is reached.
      var pct = ((i + 1) / count) * 100;
      var state = stops[i] && stops[i].state ? String(stops[i].state).toLowerCase() : '';
      var cls = '';
      if (state === 'completed' || (!state && i < done)) { cls = ' done'; }
      else if (state === 'onsite') { cls = ' onsite'; }
      else if (state === 'heading' || (!state && i === done)) { cls = ' next'; }
      dots += '<span class="timeline-dot' + cls + '" style="left:' + pct + '%"></span>';
    }

    var truckPct = progress && progress.truckPositionPercent != null ? Number(progress.truckPositionPercent) : null;
    if (truckPct == null || isNaN(truckPct)) {
      truckPct = Math.max(0, Math.min(100, (done / count) * 100));
    }
    truckPct = Math.max(0, Math.min(100, truckPct));
    var liveMarker = progress && progress.trackingFresh
      ? '<span class="timeline-vehicle' + (progress.trackingMoving ? ' moving' : '') + '" style="left:' + truckPct + '%"></span>'
      : '';
    var next = progress && progress.focusStop ? progress.focusStop : (eta ? eta.stopName : 'Next job TBC');
    var prefix = progress && progress.geofenceOnSite ? 'On site: ' : 'Next: ';
    var speed = progress && progress.trackingMoving && progress.speedKph != null ? ' · ' + Math.round(Number(progress.speedKph)) + ' km/h' : '';
    var freshness = trackingAgeText(progress);
    return '<div class="timeline"><span class="timeline-line"></span><span class="timeline-done" style="width:' + truckPct + '%"></span>' + dots + liveMarker + '</div><div class="next-job">' + esc(prefix + shortName(next) + speed + freshness) + '</div>';
  }

  var key = queryValue('key');
  var date = todayIso();
  var state = { loads: [], assignments: [], progress: [], etas: [], error: '' };

  root.innerHTML = '<div id="legacy-tv"><div class="legacy-head"><div><div class="legacy-brand">STUART LYONS HAULAGE</div><h1>Live Runs</h1></div><div class="legacy-clock"><b id="legacy-clock"></b><span id="legacy-date"></span></div></div><div id="legacy-message">Connecting to live TMS data…</div><div id="legacy-board"></div><div class="legacy-foot"><span>RoadTech ingest 1m · board update 60s</span><span id="legacy-refresh"></span></div></div>';

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
    if (key && requestPath.indexOf('/api/v1/tv-display/route-progress') === 0) {
      requestPath += (requestPath.indexOf('?') >= 0 ? '&' : '?') + 'key=' + encodeURIComponent(key);
    }
    try { xhr = new XMLHttpRequest(); } catch (e) { callback(e); return; }
    xhr.open('GET', '/tms-api' + requestPath, true);
    xhr.setRequestHeader('Accept', 'application/json');
    if (key) {
      xhr.setRequestHeader('X-TMS-TV-Key', key);
      if (requestPath.indexOf('/api/v1/tv-display/route-progress') === 0) { xhr.setRequestHeader('X-TV-Display-Key', key); }
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

  function render() {
    var board = document.getElementById('legacy-board');
    var message = document.getElementById('legacy-message');
    if (!board || !message) { return; }
    if (state.error) {
      message.className = 'legacy-error';
      message.innerHTML = '<b>Wallboard connection problem:</b> ' + esc(state.error);
    } else {
      message.className = 'legacy-ok';
      message.innerHTML = 'LIVE · ' + esc(state.loads.length) + ' runs';
    }

    var assignments = indexBy(state.assignments, 'loadId');
    var progress = indexBy(state.progress, 'loadId');
    var etaGroups = etasByLoad(state.etas);
    var rows = [];
    var i;
    for (i = 0; i < state.loads.length; i += 1) {
      var load = state.loads[i];
      if (load.status === 'Cancelled') { continue; }
      var prog = progress[load.id];
      if (prog && String(prog.phase).toLowerCase() === 'complete') { continue; }
      var assignment = assignments[load.id] || {};
      var eta = nextEta(etaGroups[load.id], prog);
      var status = statusInfo(prog, eta);
      var stop = firstStop(load);
      rows.push({ load: load, prog: prog, assignment: assignment, eta: eta, status: status, time: stop && stop.plannedArrivalUtc ? new Date(stop.plannedArrivalUtc).getTime() : 9999999999999 });
    }
    rows.sort(function (a, b) {
      if (a.status[3] && !b.status[3]) { return -1; }
      if (b.status[3] && !a.status[3]) { return 1; }
      return a.time - b.time;
    });

    var html = '<table><thead><tr><th>RUN</th><th>VEHICLE</th><th>DRIVER</th><th>TIMELINE</th><th>ETA / STATUS</th></tr></thead><tbody>';
    for (i = 0; i < rows.length; i += 1) {
      var row = rows[i];
      var vehicle = row.assignment.vehicle && row.assignment.vehicle.registration ? row.assignment.vehicle.registration : (row.eta && row.eta.vehicleRegistration ? row.eta.vehicleRegistration : 'TBC');
      var driver = row.assignment.driver && row.assignment.driver.displayName ? row.assignment.driver.displayName : (row.eta && row.eta.tachoDriverName ? row.eta.tachoDriverName : 'TBC');
      var planned = firstStop(row.load);
      var etaTime = row.eta && row.eta.etaUtc ? formatTime(row.eta.etaUtc) : '--:--';
      var etaSource = row.eta && row.eta.source ? String(row.eta.source).toUpperCase() : 'PENDING';
      var exceptionDetail = row.status[3] ? '<small class="exception-detail">' + esc(row.status[1]) + '</small>' : '';
      html += '<tr class="' + (row.status[3] ? 'exception' : '') + '">';
      html += '<td><b class="run-name">' + esc(runLabel(row.load.reference, planned ? planned.plannedArrivalUtc : '')) + '</b></td>';
      html += '<td><b>' + esc(vehicle) + '</b></td>';
      html += '<td><b>' + esc(driver) + '</b></td>';
      html += '<td>' + timelineMarkup(row.load, row.prog, row.eta) + '</td>';
      html += '<td><span class="eta">' + esc(etaTime) + '</span> <strong class="status ' + esc(row.status[2]) + '">' + esc(row.status[0]) + '</strong><small class="eta-sub">' + esc(etaSource + ' ETA') + '</small>' + exceptionDetail + '</td>';
      html += '</tr>';
    }
    html += '</tbody></table>';
    if (!rows.length && !state.error) { html = '<div class="legacy-empty">No active runs.</div>'; }
    board.innerHTML = html;
    var refreshed = document.getElementById('legacy-refresh');
    if (refreshed) { refreshed.innerHTML = 'Updated ' + esc(formatClock(new Date())); }
  }

  function refresh() {
    date = todayIso();
    if (!key) {
      state.error = 'This TV link has no access key. Open the dedicated keyed TV link.';
      render();
      return;
    }
    var pending = 4;
    var errors = [];
    function done(name, err, data) {
      if (err) {
        if (name !== 'progress') { errors.push(name + ': ' + err.message); }
      }
      else if (name === 'loads') { state.loads = data || []; }
      else if (name === 'assignments') { state.assignments = data || []; }
      else if (name === 'progress') { state.progress = data && data.runs ? data.runs : state.progress; }
      else if (name === 'etas') { state.etas = data && data.records ? data.records : []; }
      pending -= 1;
      if (pending === 0) { state.error = errors.join(' '); render(); }
    }
    request('/api/v1/loads?date=' + encodeURIComponent(date), function (e, d) { done('loads', e, d); });
    request('/api/v1/driver-assignments?from=' + encodeURIComponent(date) + '&to=' + encodeURIComponent(date), function (e, d) { done('assignments', e, d); });
    request('/api/v1/tv-display/route-progress?date=' + encodeURIComponent(date), function (e, d) { done('progress', e, d); });
    request('/api/v1/operations/delivery-etas?date=' + encodeURIComponent(date), function (e, d) { done('etas', e, d); });
  }

  updateClock();
  window.setInterval(updateClock, 1000);
  refresh();
  window.setInterval(refresh, 60000);
}());
