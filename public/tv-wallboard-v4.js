(function () {
  'use strict';

  var root = document.getElementById('root');
  if (!root) { return; }

  var PAGE_SIZE = 8;
  var ROTATE_MS = 60 * 1000;
  var REFRESH_MS = 5 * 60 * 1000;
  var pageIndex = 0;
  var state = {
    loads: [], assignments: [], progress: [], route: [], etas: [], timing: [],
    error: '', refreshedAt: null
  };

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
  function cleanStop(value) {
    return String(value || 'TBC').replace(/^Collect\s*[·:-]?\s*|^Deliver\s*[·:-]?\s*/i, '');
  }
  function orderedStops(load) {
    var stops = load && load.stops ? load.stops.slice(0) : [];
    stops.sort(function (a, b) { return Number(a.sequence || 0) - Number(b.sequence || 0); });
    return stops;
  }
  function firstStop(load) {
    var stops = orderedStops(load);
    return stops.length ? stops[0] : null;
  }
  function finalStop(load) {
    var stops = orderedStops(load);
    var i;
    for (i = stops.length - 1; i >= 0; i -= 1) {
      if (/^Deliver\b/i.test(String(stops[i].name || '')) || stops[i].orderId) { return stops[i]; }
    }
    return stops.length ? stops[stops.length - 1] : null;
  }
  function indexBy(items, field) {
    var out = {}, i;
    for (i = 0; i < (items || []).length; i += 1) { out[String(items[i][field])] = items[i]; }
    return out;
  }
  function etaGroups(items) {
    var out = {}, i, id;
    for (i = 0; i < (items || []).length; i += 1) {
      id = String(items[i].loadId);
      if (!out[id]) { out[id] = []; }
      out[id].push(items[i]);
    }
    return out;
  }
  function finalEta(list) {
    var values = (list || []).slice(0), i, candidate = null;
    values.sort(function (a, b) { return Number(a.sequence || 0) - Number(b.sequence || 0); });
    for (i = values.length - 1; i >= 0; i -= 1) {
      if (values[i].isFinalDestination || /^Deliver\b/i.test(String(values[i].stopName || '')) || values[i].orderReference || values[i].customerCode || values[i].deliveryWindowEndUtc) {
        candidate = values[i]; break;
      }
    }
    return candidate || (values.length ? values[values.length - 1] : null);
  }
  function stopEvidenceScore(stops) {
    var score = 0, i, s;
    for (i = 0; i < (stops || []).length; i += 1) {
      s = String(stops[i].state || '').toLowerCase();
      score += s === 'departed' || s === 'completed' || s === 'exited' ? 3 : s === 'onsite' ? 2 : 1;
    }
    return score;
  }
  function routeToRecord(route) {
    return {
      loadId: route.loadId,
      loadReference: route.reference,
      loadStatus: route.phase,
      runState: route.phase === 'Complete' ? 'Completed' : (route.geofenceOnSite || route.phase === 'On site' ? 'OnSiteConfirmed' : (route.trackingMoving || Number(route.completedStops || 0) > 0 ? 'InProgress' : route.phase)),
      totalStops: Number(route.totalStops || 0),
      completedStops: Number(route.completedStops || 0),
      progressPercent: Number(route.truckPositionPercent || 0),
      nextStop: null,
      currentVisit: route.currentVisit || null,
      stopDwell: route.stopDwell || null,
      phase: route.phase,
      focusStop: route.focusStop,
      geofenceOnSite: route.geofenceOnSite,
      trackingFresh: route.trackingFresh,
      trackingMoving: route.trackingMoving,
      ignitionOn: route.ignitionOn,
      driverCardPresent: route.driverCardPresent,
      trackingAgeSeconds: route.trackingAgeSeconds,
      speedKph: route.speedKph,
      tacho: route.tacho || null
    };
  }
  function mergeOneProgress(base, route) {
    if (!base) { return routeToRecord(route); }
    if (!route) { return base; }
    var total = Math.max(Number(base.totalStops || 0), Number(route.totalStops || 0));
    var completed = Math.max(Number(base.completedStops || 0), Number(route.completedStops || 0));
    var routeScore = stopEvidenceScore(route.stopDwell);
    var baseScore = stopEvidenceScore(base.stopDwell);
    var routeAhead = Number(route.completedStops || 0) > Number(base.completedStops || 0) || route.currentVisit || route.geofenceOnSite;
    var baseAhead = Number(base.completedStops || 0) > Number(route.completedStops || 0) || base.currentVisit || base.geofenceOnSite;
    var useRouteGeo = routeAhead && !baseAhead;
    var useRouteTracking = route.trackingFresh === true || base.trackingFresh !== true;
    var nextStop = base.nextStop || null;
    var i, rstop;
    if (route.nextStopId && route.stops) {
      for (i = 0; i < route.stops.length; i += 1) {
        if (String(route.stops[i].id) === String(route.nextStopId)) { rstop = route.stops[i]; break; }
      }
    }
    if (!rstop && route.stops) {
      for (i = 0; i < route.stops.length; i += 1) {
        if (/heading|upcoming/i.test(String(route.stops[i].state || ''))) { rstop = route.stops[i]; break; }
      }
    }
    if (Number(route.completedStops || 0) > Number(base.completedStops || 0) && rstop) { nextStop = rstop; }
    return {
      loadId: base.loadId,
      loadReference: base.loadReference || route.reference,
      loadStatus: base.loadStatus || route.phase,
      runState: base.runState === 'Completed' || (total > 0 && completed >= total) || route.phase === 'Complete'
        ? 'Completed'
        : (useRouteGeo ? (route.geofenceOnSite || route.currentVisit ? 'OnSiteConfirmed' : route.trackingMoving ? 'InProgress' : route.phase) : base.runState),
      totalStops: total,
      completedStops: completed,
      progressPercent: Math.max(Number(base.progressPercent || 0), Number(route.truckPositionPercent || 0)),
      nextStop: nextStop,
      currentVisit: route.currentVisit || base.currentVisit || null,
      lastDeparture: base.lastDeparture || null,
      stopDwell: routeScore > baseScore ? route.stopDwell : (base.stopDwell || route.stopDwell),
      phase: useRouteGeo ? route.phase : (base.phase || route.phase),
      focusStop: useRouteGeo ? route.focusStop : (base.focusStop || route.focusStop),
      geofenceOnSite: Boolean(base.geofenceOnSite || base.currentVisit || route.geofenceOnSite || route.currentVisit),
      trackingFresh: useRouteTracking ? (route.trackingFresh != null ? route.trackingFresh : base.trackingFresh) : base.trackingFresh,
      trackingMoving: Boolean(base.trackingMoving || route.trackingMoving),
      ignitionOn: useRouteTracking && route.ignitionOn != null ? route.ignitionOn : base.ignitionOn,
      driverCardPresent: useRouteTracking && route.driverCardPresent != null ? route.driverCardPresent : base.driverCardPresent,
      trackingAgeSeconds: useRouteTracking && route.trackingAgeSeconds != null ? route.trackingAgeSeconds : base.trackingAgeSeconds,
      speedKph: useRouteTracking && route.speedKph != null ? route.speedKph : base.speedKph,
      tacho: route.tacho || base.tacho || null
    };
  }
  function mergedProgress() {
    var base = indexBy(state.progress, 'loadId');
    var route = indexBy(state.route, 'loadId');
    var out = [], seen = {}, id;
    for (id in base) {
      if (Object.prototype.hasOwnProperty.call(base, id)) {
        out.push(mergeOneProgress(base[id], route[id])); seen[id] = true;
      }
    }
    for (id in route) {
      if (Object.prototype.hasOwnProperty.call(route, id) && !seen[id]) { out.push(routeToRecord(route[id])); }
    }
    return out;
  }
  function finalArrivalUtc(progress, timing, load) {
    if (timing && String(timing.finalEtaSource || '').toLowerCase() === 'geofence' && timing.finalEtaUtc) { return timing.finalEtaUtc; }
    if (!progress) { return null; }
    var total = Number(progress.totalStops || 0);
    var final = finalStop(load);
    var dwell = progress.stopDwell || [];
    var i, stop, sequence;
    for (i = 0; i < dwell.length; i += 1) {
      stop = dwell[i]; sequence = Number(stop.sequence || 0);
      if ((total > 0 && sequence === total) || (final && String(stop.stopId || '') === String(final.id || ''))) {
        if (/onsite|departed|completed|exited/i.test(String(stop.state || ''))) { return stop.siteArrivalUtc || null; }
      }
    }
    if (progress.currentVisit) {
      if (final && progress.currentVisit.loadStopId && String(progress.currentVisit.loadStopId) === String(final.id || '')) {
        return progress.currentVisit.enteredAtUtc || progress.currentVisit.siteArrivalUtc || null;
      }
      if (total > 0 && Number(progress.completedStops || 0) === total - 1) {
        return progress.currentVisit.enteredAtUtc || progress.currentVisit.siteArrivalUtc || null;
      }
    }
    return null;
  }
  function isCompleted(progress, timing, load) {
    if (finalArrivalUtc(progress, timing, load)) { return true; }
    if (timing && timing.completed === true) { return true; }
    if (!progress) { return false; }
    if (/complete/i.test(String(progress.phase || progress.runState || progress.loadStatus || ''))) { return true; }
    var total = Number(progress.totalStops || 0), completed = Number(progress.completedStops || 0);
    return total > 0 && completed >= total;
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

  var key = queryValue('key');
  function pairScreen(message) {
    root.innerHTML = '<div class="tv2"><div class="tv2-pair"><img src="/lyons-logo.svg" alt="Lyons"><h1>Pair this TV</h1><p>' + esc(message || 'Enter the 6-digit code from TV Display in the signed-in TMS.') + '</p><form id="tv2-pair-form"><input id="tv2-pair-code" type="tel" inputmode="numeric" maxlength="6" placeholder="000000" autocomplete="off"><button type="submit">Pair TV</button></form><div id="tv2-pair-error" class="tv2-pair-error"></div></div></div>';
    var form = document.getElementById('tv2-pair-form'), code = document.getElementById('tv2-pair-code'), error = document.getElementById('tv2-pair-error');
    if (!form || !code) { return; }
    form.onsubmit = function (event) {
      if (event && event.preventDefault) { event.preventDefault(); }
      var value = String(code.value || '').replace(/\D/g, '').substr(0, 6);
      if (value.length !== 6) { if (error) { error.innerHTML = 'Enter all 6 digits.'; } return false; }
      var xhr = new XMLHttpRequest();
      xhr.open('POST', '/tms-api/api/v1/tv-display/pair?_ts=' + new Date().getTime(), true);
      xhr.setRequestHeader('Content-Type', 'application/json'); xhr.setRequestHeader('Accept', 'application/json');
      xhr.onreadystatechange = function () {
        if (xhr.readyState !== 4) { return; }
        var data = null; try { data = JSON.parse(xhr.responseText || 'null'); } catch (ignore) {}
        if (xhr.status >= 200 && xhr.status < 300 && data && data.key) {
          window.location.replace('/tv.html?key=' + encodeURIComponent(data.key) + '&_boot=' + new Date().getTime());
        } else if (error) { error.innerHTML = esc((data && data.message) || 'That pairing code could not be accepted.'); }
      };
      xhr.send(JSON.stringify({ code: value })); return false;
    };
  }
  if (!key) { pairScreen(); return; }

  root.innerHTML = '<div class="tv2"><header class="tv2-head"><img class="tv2-logo" src="/lyons-logo.svg" alt="Lyons"><div class="tv2-brand"><small>SLH OPERATIONS WALLBOARD</small><h1>Arrivals &amp; Departures</h1></div><div class="tv2-clock"><b id="tv2-clock"></b><span id="tv2-date"></span></div></header><section class="tv2-attention"><div class="tv2-attention-title">ATTENTION · NEEDS ACTION</div><div id="tv2-attention" class="tv2-attention-copy ok"><strong>Checking live operations…</strong></div></section><div id="tv2-error"></div><div id="tv2-coverage" class="tv2-coverage"></div><main id="tv2-table" class="tv2-table-wrap"></main><footer class="tv2-foot"><span><b>LIVE OPERATIONS</b> · earliest runs first · next rows every 30 seconds</span><span id="tv2-page"></span><span id="tv2-refresh"></span></footer></div>';
  function updateClock() {
    var now = new Date(), clock = document.getElementById('tv2-clock'), date = document.getElementById('tv2-date');
    if (clock) { clock.innerHTML = esc(formatTime(now)); }
    if (date) { date.innerHTML = esc(formatDate(now)); }
  }
  function request(path, callback) {
    var xhr = new XMLHttpRequest(), separator = path.indexOf('?') >= 0 ? '&' : '?';
    var url = '/tms-api' + path + separator + 'key=' + encodeURIComponent(key) + '&_ts=' + new Date().getTime();
    xhr.open('GET', url, true); xhr.setRequestHeader('Accept', 'application/json');
    try { xhr.setRequestHeader('Cache-Control', 'no-cache, no-store, must-revalidate'); } catch (ignore0) {}
    try { xhr.setRequestHeader('Pragma', 'no-cache'); } catch (ignore00) {}
    try { xhr.setRequestHeader('X-TV-Display-Key', key); } catch (ignore1) {}
    try { xhr.setRequestHeader('X-TMS-TV-Key', key); } catch (ignore2) {}
    xhr.timeout = 30000;
    xhr.onreadystatechange = function () {
      if (xhr.readyState !== 4) { return; }
      if (xhr.status >= 200 && xhr.status < 300) {
        try { callback(null, JSON.parse(xhr.responseText || 'null'), xhr.status); } catch (e) { callback(e, null, xhr.status); }
      } else { callback(new Error('TMS API returned ' + xhr.status), null, xhr.status); }
    };
    xhr.onerror = function () { callback(new Error('The TV could not reach the TMS API.'), null, 0); };
    xhr.ontimeout = function () { callback(new Error('The TMS API did not respond in time.'), null, 0); };
    try { xhr.send(); } catch (e) { callback(e, null, 0); }
  }
  function buildRows() {
    var assignments = indexBy(state.assignments, 'loadId');
    var progress = indexBy(mergedProgress(), 'loadId');
    var timings = indexBy(state.timing, 'loadId');
    var etaByLoad = etaGroups(state.etas);
    var rows = [], i;
    for (i = 0; i < state.loads.length; i += 1) {
      var load = state.loads[i], prog = progress[String(load.id)] || null, timing = timings[String(load.id)] || null;
      if (/cancelled|completed/i.test(String(load.status || '')) || isCompleted(prog, timing, load)) { continue; }
      var first = firstStop(load), last = finalStop(load), assignment = assignments[String(load.id)] || null;
      var eta = finalEta(etaByLoad[String(load.id)]), status = statusFor(load, assignment, prog, eta);
      var total = Math.max(Number(prog && prog.totalStops || 0), Number(load.stops && load.stops.length || 0));
      var completed = Math.min(total, Math.max(0, Number(prog && prog.completedStops || 0)));
      var timingEta = timing && timing.finalEtaUtc ? timing.finalEtaUtc : null;
      var finalTime = timingEta || (eta && eta.etaUtc ? eta.etaUtc : (last && last.plannedArrivalUtc));
      var timingSource = String(timing && timing.finalEtaSource || '').toLowerCase();
      var finalLabel = timingEta ? (timingSource === 'geofence' ? 'ARRIVED' : 'ESTIMATED FINAL ETA')
        : eta && eta.etaUtc ? (String(eta.source || '').toLowerCase() === 'live' ? 'LIVE FINAL ETA' : 'ESTIMATED FINAL ETA') : 'PLANNED FINAL';
      rows.push({
        id: load.id, load: load, progress: prog, eta: eta, status: status,
        firstUtc: first && first.plannedArrivalUtc,
        firstMs: first && first.plannedArrivalUtc ? new Date(first.plannedArrivalUtc).getTime() : 9999999999999,
        run: assignment && assignment.loadReference ? assignment.loadReference : String(load.reference || 'Run TBC'),
        vehicle: assignment && assignment.vehicle ? assignment.vehicle.registration : 'VEHICLE TBC',
        trailer: assignment && assignment.trailerNumber ? assignment.trailerNumber : '',
        driver: assignment && assignment.driver ? assignment.driver.displayName : 'DRIVER TBC',
        finalName: cleanStop((timing && timing.finalDestinationName) || (eta && eta.stopName) || (last && last.name) || 'Final delivery'),
        currentStop: cleanStop(prog && prog.currentVisit && (prog.currentVisit.geofenceName || prog.currentVisit.stopName) || ''),
        nextStop: cleanStop(prog && prog.nextStop && prog.nextStop.name || prog && prog.focusStop || ''),
        finalTime: finalTime, finalLabel: finalLabel, total: total, completed: completed,
        percent: total > 0 ? Math.round((completed / total) * 100) : 0
      });
    }
    rows.sort(function (a, b) { return a.firstMs - b.firstMs || String(a.run).localeCompare(String(b.run)); });
    return rows;
  }
  function renderAttention(rows) {
    var node = document.getElementById('tv2-attention'); if (!node) { return; }
    var issues = rows.filter(function (row) { return row.status.priority >= 80; });
    issues.sort(function (a, b) { return b.status.priority - a.status.priority || a.firstMs - b.firstMs; });
    if (!issues.length) {
      node.className = 'tv2-attention-copy ok';
      node.innerHTML = '<strong>✓ No immediate exceptions</strong><span>Runs remain ordered by first collection time.</span>'; return;
    }
    var first = issues[0];
    node.className = 'tv2-attention-copy ' + (first.status.kind === 'late' ? 'bad' : 'warn');
    node.innerHTML = '<strong>' + esc(issues.length + ' need attention') + '</strong><span>' + esc(first.run + ' · ' + first.status.label + ' · ' + first.status.detail) + '</span>';
  }
  function render() {
    var rows = buildRows(), pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
    if (pageIndex >= pages) { pageIndex = 0; }
    var start = pageIndex * PAGE_SIZE, shown = rows.slice(start, start + PAGE_SIZE);
    var table = document.getElementById('tv2-table'), coverage = document.getElementById('tv2-coverage'), error = document.getElementById('tv2-error');
    var page = document.getElementById('tv2-page'), refreshed = document.getElementById('tv2-refresh'), i;
    renderAttention(rows);
    if (error) {
      if (state.error) { error.className = 'tv2-error'; error.innerHTML = esc(state.error); }
      else { error.className = ''; error.innerHTML = ''; }
    }
    if (coverage) {
      var stopCount = 0; for (i = 0; i < rows.length; i += 1) { stopCount += Number(rows[i].total || 0); }
      coverage.innerHTML = '<b>RUN VIEW</b><span>' + esc(rows.length + ' active runs') + '</span><span>' + esc(stopCount + ' physical stops') + '</span><span>Same live progress feed as the TMS · completed final destinations removed automatically</span>';
    }
    if (page) { page.innerHTML = pages > 1 ? 'Rows ' + (start + 1) + '–' + Math.min(start + PAGE_SIZE, rows.length) + ' of ' + rows.length : rows.length + ' active runs'; }
    if (refreshed) { refreshed.innerHTML = state.refreshedAt ? 'Updated ' + esc(formatTime(state.refreshedAt)) : 'Updating…'; }
    if (!table) { return; }
    if (!shown.length) { table.innerHTML = '<div class="tv2-empty">No active runs to display.</div>'; return; }
    var html = '<table class="tv2-table"><thead><tr><th>FIRST COLLECTION</th><th>RUN</th><th>VEHICLE</th><th>DRIVER</th><th>PROGRESS</th><th>FINAL DELIVERY / ETA</th><th>STATUS</th></tr></thead><tbody>';
    for (i = 0; i < shown.length; i += 1) {
      var row = shown[i], focus = row.progress && (row.progress.focusStop || (row.progress.nextStop && row.progress.nextStop.name));
      var stopSummary = row.currentStop ? 'Current: ' + row.currentStop : (row.nextStop ? 'Next: ' + row.nextStop : 'Planned route');
      if (row.currentStop && row.nextStop && row.currentStop !== row.nextStop) { stopSummary += ' · Next: ' + row.nextStop; }
      html += '<tr class="' + esc(row.status.kind) + '">' +
        '<td><b class="tv2-main tv2-time">' + esc(formatTime(row.firstUtc)) + '</b><small class="tv2-sub">first collection</small></td>' +
        '<td><b class="tv2-main">' + esc(row.run) + '</b><small class="tv2-sub">' + esc(stopSummary) + '</small></td>' +
        '<td><b class="tv2-main">' + esc(row.vehicle) + '</b><small class="tv2-sub">' + esc(row.trailer ? 'Trailer ' + row.trailer : 'vehicle') + '</small></td>' +
        '<td><b class="tv2-main">' + esc(row.driver) + '</b><small class="tv2-sub">dispatch allocation</small></td>' +
        '<td><div class="tv2-progress"><i style="width:' + esc(row.percent) + '%"></i></div><b class="tv2-main">' + esc(row.completed + ' / ' + row.total) + '</b><small class="tv2-sub">' + esc(row.completed + ' of ' + row.total + ' geofences exited') + '</small></td>' +
        '<td><b class="tv2-main tv2-time tv2-eta">' + esc(formatTime(row.finalTime)) + '</b><small class="tv2-sub">' + esc(row.finalName + ' · ' + row.finalLabel) + '</small></td>' +
        '<td><span class="tv2-status ' + esc(row.status.kind) + '">' + esc(row.status.label) + '</span><small class="tv2-sub">' + esc(row.status.detail) + '</small></td>' +
        '</tr>';
    }
    html += '</tbody></table>'; table.innerHTML = html;
  }
  function refresh() {
    var date = todayIso(), pending = 6, coreUnauthorised = false, coreErrors = [], optionalErrors = [];
    function done(name, err, data, status) {
      if (err) {
        if ((name === 'loads' || name === 'assignments') && (status === 401 || status === 403)) { coreUnauthorised = true; }
        else if (name === 'loads' || name === 'assignments') { coreErrors.push(name); }
        else { optionalErrors.push(name); }
      } else if (name === 'loads') { state.loads = data || []; }
      else if (name === 'assignments') { state.assignments = data || []; }
      else if (name === 'progress') { if (data && data.records) { state.progress = data.records; } }
      else if (name === 'route') { if (data && data.runs) { state.route = data.runs; } }
      else if (name === 'etas') { if (data && data.records) { state.etas = data.records; } }
      else if (name === 'timing') { if (data && data.records) { state.timing = data.records; } }
      pending -= 1;
      if (pending === 0) {
        if (coreUnauthorised) { pairScreen('This TV access key is no longer valid. Generate a fresh 6-digit pairing code from TV Display in the signed-in TMS.'); return; }
        state.error = coreErrors.length ? 'Live run or allocation refresh failed — retaining the last confirmed board.'
          : optionalErrors.length ? 'Live enrichment delayed (' + optionalErrors.join(', ') + ') — retaining the last confirmed values for those feeds.' : '';
        state.refreshedAt = new Date(); render();
      }
    }
    request('/api/v1/tv-display/planned-runs?date=' + encodeURIComponent(date), function (e, d, s) { done('loads', e, d, s); });
    request('/api/v1/driver-assignments?from=' + encodeURIComponent(date) + '&to=' + encodeURIComponent(date), function (e, d, s) { done('assignments', e, d, s); });
    request('/api/v1/tv-display/wallboard-proxy/run-progress?date=' + encodeURIComponent(date), function (e, d, s) { done('progress', e, d, s); });
    request('/api/v1/tv-display/route-progress?date=' + encodeURIComponent(date), function (e, d, s) { done('route', e, d, s); });
    request('/api/v1/tv-display/wallboard-proxy/delivery-etas?date=' + encodeURIComponent(date), function (e, d, s) { done('etas', e, d, s); });
    request('/api/v1/run-timing?date=' + encodeURIComponent(date), function (e, d, s) { done('timing', e, d, s); });
  }
  function rotate() {
    var rows = buildRows(), pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
    pageIndex = pages > 1 ? (pageIndex + 1) % pages : 0; render();
  }
  updateClock(); window.setInterval(updateClock, 1000);
  refresh(); window.setInterval(refresh, REFRESH_MS);
  window.setInterval(rotate, ROTATE_MS);
}());
