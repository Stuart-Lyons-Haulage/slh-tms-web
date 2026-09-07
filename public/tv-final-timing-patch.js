(function () {
  'use strict';

  var REFRESH_MS = 30000;
  var latestTiming = null;
  var latestLoads = null;
  var applying = false;
  var acceptedFinalEtas = {};

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

  function londonParts(date, options) {
    try {
      if (window.Intl && Intl.DateTimeFormat) {
        var parts = new Intl.DateTimeFormat('en-GB', options).formatToParts(date);
        var result = {};
        var i;
        for (i = 0; i < parts.length; i += 1) { result[parts[i].type] = parts[i].value; }
        return result;
      }
    } catch (e) {}
    return null;
  }

  function todayIso() {
    var now = new Date();
    var parts = londonParts(now, { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' });
    if (parts) { return parts.year + '-' + parts.month + '-' + parts.day; }
    return now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate());
  }

  function formatTime(value) {
    if (!value) { return '--:--'; }
    var date = new Date(value);
    if (isNaN(date.getTime())) { return '--:--'; }
    var parts = londonParts(date, { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    if (parts) { return parts.hour + ':' + parts.minute; }
    return pad(date.getHours()) + ':' + pad(date.getMinutes());
  }

  function normalise(value) { return String(value || '').replace(/\s+/g, ' ').trim().toUpperCase(); }
  function stripPrefix(value) { return String(value || 'Final job').replace(/^(Collect|Collection|Deliver|Delivery)\s*·?\s*/i, ''); }

  // Reset/re-import can expose the same run as PLAN-YYYYMMDD-23 in /loads while
  // run-timing deliberately presents the operational label Run 23 AM. The legacy TV
  // table also renders the display label, so exact reference-text matching loses the
  // final ETA even though all three refer to the same run. The run number is unique
  // within the planning date and is therefore the stable cross-feed display key here.
  function runKey(value) {
    var text = normalise(value);
    var plan = text.match(/PLAN-\d{8}-(\d+)/);
    var run = text.match(/\bRUN\s*(\d+)/);
    var number = plan ? plan[1] : run ? run[1] : '';
    if (!number) { return text; }
    number = number.replace(/^0+/, '');
    return number || '0';
  }

  function finalStop(load) {
    var stops = load && load.stops ? load.stops.slice(0) : [];
    stops.sort(function (a, b) { return Number(a.sequence || 0) - Number(b.sequence || 0); });
    var delivery = null;
    var i;
    for (i = stops.length - 1; i >= 0; i -= 1) {
      if (/^Deliver\b/i.test(String(stops[i].name || '')) || stops[i].orderId) {
        delivery = stops[i];
        break;
      }
    }
    return delivery || (stops.length ? stops[stops.length - 1] : null);
  }

  function request(path, callback) {
    var xhr;
    var key = queryValue('key');
    try { xhr = new XMLHttpRequest(); } catch (e) { callback(e); return; }
    xhr.open('GET', '/tms-api' + path, true);
    xhr.setRequestHeader('Accept', 'application/json');
    if (key) {
      xhr.setRequestHeader('X-TMS-TV-Key', key);
      xhr.setRequestHeader('X-TV-Display-Key', key);
    }
    xhr.onreadystatechange = function () {
      if (xhr.readyState !== 4) { return; }
      if (xhr.status >= 200 && xhr.status < 300) {
        try { callback(null, JSON.parse(xhr.responseText)); } catch (e) { callback(e); }
      } else {
        callback(new Error('TMS API returned ' + xhr.status));
      }
    };
    xhr.onerror = function () { callback(new Error('TMS API unavailable')); };
    try { xhr.send(); } catch (e) { callback(e); }
  }

  function riskFor(record, stop) {
    if (!record || !record.finalEtaUtc || !stop || !stop.plannedArrivalUtc) { return null; }
    var eta = new Date(record.finalEtaUtc).getTime();
    var deadline = new Date(stop.plannedArrivalUtc).getTime();
    if (isNaN(eta) || isNaN(deadline)) { return null; }
    var buffer = Math.floor((deadline - eta) / 60000);
    if (buffer < 0) {
      return {
        kind: record.finalEtaSource === 'GeofenceEstimated' ? 'risk' : 'late',
        label: record.finalEtaSource === 'GeofenceEstimated' ? 'FINAL ETA AT RISK' : 'LATE FINAL ETA',
        detail: Math.abs(buffer) + 'm after delivery latest time'
      };
    }
    if (buffer <= 15) {
      return { kind: 'risk', label: 'FINAL ETA AT RISK', detail: buffer + 'm delivery buffer' };
    }
    return { kind: 'ok', label: 'ON ROUTE', detail: buffer + 'm delivery buffer' };
  }

  function dateKey(value) {
    if (!value) { return ''; }
    var timestamp = new Date(value).getTime();
    return isNaN(timestamp) ? '' : new Date(timestamp).toISOString().slice(0, 10);
  }

  function stableFinalEta(loadId, candidate, fallback, deadline) {
    var candidateMs = candidate ? new Date(candidate).getTime() : NaN;
    if (isNaN(candidateMs)) { return acceptedFinalEtas[loadId] || fallback || ''; }
    var deadlineDay = dateKey(deadline);
    var candidateDay = dateKey(candidate);
    var fallbackDay = dateKey(fallback);
    var previous = acceptedFinalEtas[loadId] || '';
    var previousDay = dateKey(previous);
    var fallbackMs = fallback ? new Date(fallback).getTime() : NaN;
    if (deadlineDay && candidateDay !== deadlineDay && (fallbackDay === deadlineDay || previousDay === deadlineDay)) {
      return previous && previousDay === deadlineDay ? previous : fallback;
    }
    if (!isNaN(fallbackMs) && fallbackMs > Date.now() && candidateMs < Date.now() - 15 * 60 * 1000) {
      return previous || fallback;
    }
    acceptedFinalEtas[loadId] = candidate;
    return candidate;
  }

  function setText(node, value) {
    if (node && node.textContent !== value) { node.textContent = value; }
  }

  function setKpi(label, value) {
    var nodes = document.querySelectorAll('#legacy-kpis .kpi');
    var i, small, number;
    for (i = 0; i < nodes.length; i += 1) {
      small = nodes[i].querySelector('small');
      if (small && normalise(small.textContent) === normalise(label)) {
        number = nodes[i].querySelector('b');
        setText(number, String(value));
        return;
      }
    }
  }

  function applyTiming() {
    if (applying || !latestTiming || !latestLoads) { return; }
    applying = true;
    try {
      var timingByKey = {};
      var timingByLoadId = {};
      var loadByKey = {};
      var loadById = {};
      var i;
      var records = latestTiming.records || [];
      var loads = latestLoads || [];
      for (i = 0; i < records.length; i += 1) {
        timingByKey[runKey(records[i].loadReference)] = records[i];
        if (records[i].loadId) { timingByLoadId[String(records[i].loadId)] = records[i]; }
      }
      for (i = 0; i < loads.length; i += 1) {
        loadByKey[runKey(loads[i].reference)] = loads[i];
        if (loads[i].id) { loadById[String(loads[i].id)] = loads[i]; }
      }

      var header = document.querySelector('#legacy-board thead th:nth-child(6)');
      setText(header, 'FINAL DELIVERY / ETA');

      var rows = document.querySelectorAll('#legacy-board tbody tr');
      for (i = 0; i < rows.length; i += 1) {
        var runNode = rows[i].querySelector('.run-name');
        var key = runKey(runNode ? runNode.textContent : '');
        var rowLoadId = rows[i].getAttribute('data-load-id') || '';
        var timing = timingByLoadId[rowLoadId] || timingByKey[key];
        var load = loadById[rowLoadId] || loadByKey[key];
        if (!timing || !load) { continue; }

        // Completed runs remain on the board. The Operations Wallboard is an operating
        // picture for the whole day; completion changes state to AVAILABLE rather than
        // deleting the row during a later refresh.
        rows[i].style.display = '';

        var stop = finalStop(load);
        var acceptedEta = stableFinalEta(rowLoadId || key, timing.finalEtaUtc, stop && stop.plannedArrivalUtc, stop && stop.plannedArrivalUtc);
        var effectiveTiming = timing;
        if (acceptedEta && acceptedEta !== timing.finalEtaUtc) {
          effectiveTiming = {};
          for (var timingKey in timing) {
            if (Object.prototype.hasOwnProperty.call(timing, timingKey)) { effectiveTiming[timingKey] = timing[timingKey]; }
          }
          effectiveTiming.finalEtaUtc = acceptedEta;
        }
        var etaCell = rows[i].cells && rows[i].cells.length > 5 ? rows[i].cells[5] : null;
        var nameNode = etaCell ? etaCell.querySelector('.next-name') : null;
        var timeNode = etaCell ? etaCell.querySelector('.eta-time') : null;
        setText(nameNode, stripPrefix(stop ? stop.name : 'Final job'));
        setText(timeNode, effectiveTiming.finalEtaUtc ? formatTime(effectiveTiming.finalEtaUtc) : '--:--');

        var oldAlert = etaCell ? etaCell.querySelector('.row-alert') : null;
        if (oldAlert && oldAlert.parentNode) { oldAlert.parentNode.removeChild(oldAlert); }

        var statusNode = rows[i].querySelector('strong.status');
        if (timing.completed && statusNode) {
          statusNode.className = 'status complete';
          setText(statusNode, 'AVAILABLE');
          rows[i].className = '';
        } else {
          var risk = riskFor(effectiveTiming, stop);
          if (risk && statusNode) {
            var current = normalise(statusNode.textContent);
            if (risk.kind === 'late') {
              statusNode.className = 'status late';
              setText(statusNode, risk.label);
              rows[i].className = 'exception late';
            } else if (risk.kind === 'risk') {
              statusNode.className = 'status risk';
              setText(statusNode, risk.label);
              rows[i].className = 'exception risk';
            } else if (current === 'LATE ETA' || current === 'AT RISK' || current === 'UPCOMING' || current === 'LATE FINAL ETA' || current === 'FINAL ETA AT RISK') {
              statusNode.className = 'status route';
              setText(statusNode, timing.currentGeofenceName ? 'ON SITE' : 'ON ROUTE');
              rows[i].className = '';
            }
          }
        }
      }

      var active = 0;
      var onSite = 0;
      var riskCount = 0;
      var lateCount = 0;
      for (i = 0; i < records.length; i += 1) {
        if (records[i].completed) { continue; }
        active += 1;
        if (records[i].currentGeofenceName) { onSite += 1; }
        var linkedLoad = loadByKey[runKey(records[i].loadReference)] || null;
        var linkedRisk = riskFor(records[i], finalStop(linkedLoad));
        if (linkedRisk && linkedRisk.kind === 'late') { lateCount += 1; }
        else if (linkedRisk && linkedRisk.kind === 'risk') { riskCount += 1; }
      }
      setKpi('STILL OUT', active);
      setKpi('ON SITE', onSite);
      setKpi('AT RISK', riskCount);
      setKpi('LATE ETA', lateCount);

      var refresh = document.getElementById('legacy-refresh');
      if (refresh) { setText(refresh, 'Final ETA updated ' + formatTime(new Date()) + ' · 30s'); }
    } finally {
      applying = false;
    }
  }

  function refreshTiming() {
    var date = todayIso();
    var pending = 2;
    function complete() {
      pending -= 1;
      if (pending === 0) { applyTiming(); }
    }
    request('/api/v1/run-timing?date=' + encodeURIComponent(date), function (error, data) {
      if (!error && data && data.records) { latestTiming = data; }
      complete();
    });
    request('/api/v1/tv-display/planned-runs?date=' + encodeURIComponent(date), function (error, data) {
      if (!error && data) { latestLoads = data; }
      complete();
    });
  }

  var board = document.getElementById('legacy-board');
  if (board && window.MutationObserver) {
    var observer = new MutationObserver(function () { if (!applying) { window.setTimeout(applyTiming, 0); } });
    observer.observe(board, { childList: true, subtree: true });
  }

  refreshTiming();
  window.setInterval(refreshTiming, REFRESH_MS);
}());
