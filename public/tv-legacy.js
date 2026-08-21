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
  function todayIso() {
    var d = new Date();
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }
  function formatClock(date) { return pad(date.getHours()) + ':' + pad(date.getMinutes()); }
  function formatDate(date) {
    var days = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
    var months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
    return days[date.getDay()] + ', ' + pad(date.getDate()) + ' ' + months[date.getMonth()] + ' ' + date.getFullYear();
  }
  function formatTime(value) {
    if (!value) { return '--:--'; }
    var d = new Date(value);
    if (isNaN(d.getTime())) { return '--:--'; }
    return formatClock(d);
  }
  function firstStop(load) {
    var stops = load && load.stops ? load.stops.slice(0) : [];
    stops.sort(function (a, b) { return (a.sequence || 0) - (b.sequence || 0); });
    return stops.length ? stops[0] : null;
  }
  function runLabel(reference, plannedUtc) {
    var text = String(reference || 'RUN TBC').replace(/^Run\s+/i, '').trim();
    var match = /^L0*(\d+)$/i.exec(text);
    if (match) {
      var n = parseInt(match[1], 10) || 1;
      var d = plannedUtc ? new Date(plannedUtc) : null;
      var pm = d && !isNaN(d.getTime()) ? d.getHours() >= 15 : false;
      return 'Run ' + (pm ? 49 + n : n) + (pm ? ' PM' : ' AM');
    }
    if (/^\d+\s*(AM|PM)$/i.test(text)) { return 'Run ' + text.toUpperCase(); }
    if (/^\d+$/.test(text)) { return 'Run ' + text; }
    return /^RUN\b/i.test(String(reference || '')) ? String(reference) : 'Run ' + text;
  }
  function routeText(load) {
    var stops = load && load.stops ? load.stops.slice(0) : [];
    stops.sort(function (a, b) { return (a.sequence || 0) - (b.sequence || 0); });
    if (!stops.length) { return 'Route not confirmed'; }
    var names = [];
    var i;
    for (i = 0; i < stops.length; i += 1) {
      names.push(String(stops[i].name || '').replace(/^Collect · |^Deliver · /i, ''));
    }
    return names.join(' → ');
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
    var i;
    if (seq != null) {
      for (i = 0; i < values.length; i += 1) { if ((values[i].sequence || 0) >= seq) { return values[i]; } }
    }
    return values.length ? values[values.length - 1] : null;
  }
  function statusInfo(progress, eta) {
    if (progress && progress.currentVisit) {
      if (progress.currentVisit.isDelayed) { return ['SITE DELAY', progress.currentVisit.geofenceName || 'On site', 'late']; }
      return ['ON SITE', progress.currentVisit.geofenceName || 'Matched geofence', 'onsite'];
    }
    if (eta && eta.source === 'Live' && eta.risk === 'Late') { return ['LATE ETA', eta.stopName || 'Delivery', 'late']; }
    if (eta && eta.source === 'Live' && eta.risk === 'AtRisk') { return ['AT RISK', eta.stopName || 'Delivery', 'risk']; }
    if ((progress && progress.completedStops > 0) || (eta && (eta.source === 'Live' || eta.source === 'Estimated'))) {
      return ['ON ROUTE', progress && progress.nextStop ? progress.nextStop.name : (eta ? eta.stopName : ''), 'route'];
    }
    return ['SCHEDULED', eta ? eta.stopName : 'Awaiting tracker/geofence evidence', 'scheduled'];
  }

  var key = queryValue('key');
  var date = todayIso();
  var state = { loads: [], assignments: [], progress: [], etas: [], error: '' };

  root.innerHTML = '<div id="legacy-tv"><div class="legacy-head"><div><div class="legacy-brand">STUART LYONS HAULAGE</div><h1>Arrivals &amp; Departures</h1></div><div class="legacy-clock"><b id="legacy-clock"></b><span id="legacy-date"></span></div></div><div id="legacy-message">Connecting to live TMS data…</div><div id="legacy-board"></div><div class="legacy-foot"><span>Auto refresh every 20 seconds</span><span id="legacy-refresh"></span></div></div>';

  function updateClock() {
    var now = new Date();
    var clock = document.getElementById('legacy-clock');
    var dateNode = document.getElementById('legacy-date');
    if (clock) { clock.innerHTML = esc(formatClock(now)); }
    if (dateNode) { dateNode.innerHTML = esc(formatDate(now)); }
  }

  function request(path, callback) {
    var xhr;
    try { xhr = new XMLHttpRequest(); } catch (e) { callback(e); return; }
    xhr.open('GET', '/tms-api' + path, true);
    xhr.setRequestHeader('Accept', 'application/json');
    if (key) { xhr.setRequestHeader('X-TMS-TV-Key', key); }
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
      message.innerHTML = 'LIVE OPERATIONS · ' + esc(state.loads.length) + ' runs loaded';
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
      if (prog && prog.runState === 'Completed') { continue; }
      var assignment = assignments[load.id] || {};
      var eta = nextEta(etaGroups[load.id], prog);
      var status = statusInfo(prog, eta);
      var stop = firstStop(load);
      rows.push({ load: load, prog: prog, assignment: assignment, eta: eta, status: status, time: stop && stop.plannedArrivalUtc ? new Date(stop.plannedArrivalUtc).getTime() : 9999999999999 });
    }
    rows.sort(function (a, b) { return a.time - b.time; });
    var html = '<table><thead><tr><th>RUN</th><th>VEHICLE</th><th>DRIVER</th><th>PROGRESS</th><th>ETA</th><th>STATUS</th></tr></thead><tbody>';
    for (i = 0; i < rows.length; i += 1) {
      var row = rows[i];
      var total = row.prog ? row.prog.totalStops || 0 : (row.load.stops ? row.load.stops.length : 0);
      var done = row.prog ? row.prog.completedStops || 0 : 0;
      var pct = total ? Math.round((done / total) * 100) : 0;
      var vehicle = row.assignment.vehicle && row.assignment.vehicle.registration ? row.assignment.vehicle.registration : (row.eta && row.eta.vehicleRegistration ? row.eta.vehicleRegistration : 'VEHICLE TBC');
      var trailer = row.assignment.trailerNumber ? 'Trailer ' + row.assignment.trailerNumber : '';
      var driver = row.assignment.driver && row.assignment.driver.displayName ? row.assignment.driver.displayName : (row.eta && row.eta.tachoDriverName ? row.eta.tachoDriverName : 'DRIVER TBC');
      var planned = firstStop(row.load);
      var etaTime = row.eta && row.eta.etaUtc ? formatTime(row.eta.etaUtc) : (planned ? formatTime(planned.plannedArrivalUtc) : '--:--');
      html += '<tr><td><b>' + esc(runLabel(row.load.reference, planned ? planned.plannedArrivalUtc : '')) + '</b><small>' + esc(routeText(row.load)) + '</small></td>';
      html += '<td><b>' + esc(vehicle) + '</b><small>' + esc(trailer) + '</small></td>';
      html += '<td><b>' + esc(driver) + '</b></td>';
      html += '<td><b>' + esc(done + ' of ' + total + ' stops') + '</b><div class="bar"><i style="width:' + pct + '%"></i></div><small>' + pct + '% complete</small></td>';
      html += '<td><b>' + esc(etaTime) + '</b><small>' + esc(row.eta && row.eta.source ? row.eta.source + ' ETA' : 'planned') + '</small></td>';
      html += '<td><strong class="status ' + esc(row.status[2]) + '">' + esc(row.status[0]) + '</strong><small>' + esc(row.status[1]) + '</small></td></tr>';
    }
    html += '</tbody></table>';
    if (!rows.length && !state.error) { html = '<div class="legacy-empty">No active runs are currently available for ' + esc(date) + '.</div>'; }
    board.innerHTML = html;
    var refreshed = document.getElementById('legacy-refresh');
    if (refreshed) { refreshed.innerHTML = 'Last refresh ' + esc(formatClock(new Date())); }
  }

  function refresh() {
    if (!key) {
      state.error = 'This TV link has no access key. Open the dedicated keyed TV link.';
      render();
      return;
    }
    var pending = 4;
    var errors = [];
    function done(name, err, data) {
      if (err) { errors.push(name + ': ' + err.message); }
      else if (name === 'loads') { state.loads = data || []; }
      else if (name === 'assignments') { state.assignments = data || []; }
      else if (name === 'progress') { state.progress = data && data.records ? data.records : []; }
      else if (name === 'etas') { state.etas = data && data.records ? data.records : []; }
      pending -= 1;
      if (pending === 0) { state.error = errors.join(' '); render(); }
    }
    request('/api/v1/loads?date=' + encodeURIComponent(date), function (e, d) { done('loads', e, d); });
    request('/api/v1/driver-assignments?from=' + encodeURIComponent(date) + '&to=' + encodeURIComponent(date), function (e, d) { done('assignments', e, d); });
    request('/api/v1/run-progress?date=' + encodeURIComponent(date), function (e, d) { done('progress', e, d); });
    request('/api/v1/operations/delivery-etas?date=' + encodeURIComponent(date), function (e, d) { done('etas', e, d); });
  }

  updateClock();
  window.setInterval(updateClock, 1000);
  refresh();
  window.setInterval(refresh, 20000);
}());
