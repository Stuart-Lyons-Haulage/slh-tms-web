(function () {
  'use strict';

  if (!window.__SLH_LEGACY_TV__) { return; }

  var labelsByReference = {};
  var labelsByLoadId = {};

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

  function fallbackLabel(reference) {
    var raw = String(reference || '').trim();
    var match = /^PLAN-\d{8}-(.+)$/i.exec(raw);
    if (!match) { return raw; }
    var clean = String(match[1] || '').replace(/^RUN[\s_-]*/i, '').replace(/[_-]+/g, ' ').trim();
    return clean ? 'Run ' + clean : 'Run TBC';
  }

  function applyLabels() {
    var rows = document.querySelectorAll('#legacy-board tr[data-load-id]');
    var i;
    for (i = 0; i < rows.length; i += 1) {
      var loadId = String(rows[i].getAttribute('data-load-id') || '');
      var node = rows[i].querySelector('.run-name');
      if (!node) { continue; }
      var current = String(node.textContent || node.innerText || '').trim();
      var resolved = labelsByLoadId[loadId] || labelsByReference[current];
      if (!resolved && /^PLAN-/i.test(current)) { resolved = fallbackLabel(current); }
      if (resolved && resolved !== current) { node.textContent = resolved; }
    }
  }

  function refreshLabels() {
    var key = queryValue('key');
    if (!key) { applyLabels(); return; }

    var xhr;
    try { xhr = new XMLHttpRequest(); } catch (e) { applyLabels(); return; }
    xhr.open('GET', '/tms-api/api/v1/tv-display/run-labels?key=' + encodeURIComponent(key), true);
    xhr.setRequestHeader('Accept', 'application/json');
    // Paired TV keys are DB-backed display keys, not the old static wallboard key.
    // Carry both headers so this patch follows the same authentication contract as tv-legacy.js.
    xhr.setRequestHeader('X-TMS-TV-Key', key);
    xhr.setRequestHeader('X-TV-Display-Key', key);
    xhr.onreadystatechange = function () {
      if (xhr.readyState !== 4) { return; }
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          var data = JSON.parse(xhr.responseText || '{}');
          var labels = data && data.labels ? data.labels : [];
          var nextByReference = {};
          var nextByLoadId = {};
          var i;
          for (i = 0; i < labels.length; i += 1) {
            if (labels[i].reference && labels[i].displayReference) {
              nextByReference[String(labels[i].reference)] = String(labels[i].displayReference);
            }
            if (labels[i].loadId && labels[i].displayReference) {
              nextByLoadId[String(labels[i].loadId)] = String(labels[i].displayReference);
            }
          }
          labelsByReference = nextByReference;
          labelsByLoadId = nextByLoadId;
        } catch (e) { }
      }
      applyLabels();
    };
    try { xhr.send(); } catch (e) { applyLabels(); }
  }

  refreshLabels();
  window.setInterval(applyLabels, 1000);
  window.setInterval(refreshLabels, 60000);
}());