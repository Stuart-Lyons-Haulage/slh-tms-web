(function () {
  'use strict';

  if (!window.__SLH_LEGACY_TV__) { return; }

  var labelsByReference = {};

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
    var match = /^PLAN-\d{8}-(.+)$/i.exec(String(reference || '').trim());
    if (!match) { return reference; }
    var clean = String(match[1] || '').replace(/^RUN[\s_-]*/i, '').replace(/[_-]+/g, ' ').trim();
    return clean ? 'Run ' + clean : 'Run TBC';
  }

  function applyLabels() {
    var nodes = document.getElementsByClassName('run-name');
    var i;
    for (i = 0; i < nodes.length; i += 1) {
      var current = String(nodes[i].textContent || nodes[i].innerText || '').trim();
      if (!/^PLAN-/i.test(current)) { continue; }
      nodes[i].textContent = labelsByReference[current] || fallbackLabel(current);
    }
  }

  function refreshLabels() {
    var key = queryValue('key');
    if (!key) { applyLabels(); return; }

    var xhr;
    try { xhr = new XMLHttpRequest(); } catch (e) { applyLabels(); return; }
    xhr.open('GET', '/tms-api/api/v1/tv-display/run-labels?key=' + encodeURIComponent(key), true);
    xhr.setRequestHeader('Accept', 'application/json');
    xhr.onreadystatechange = function () {
      if (xhr.readyState !== 4) { return; }
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          var data = JSON.parse(xhr.responseText || '{}');
          var labels = data && data.labels ? data.labels : [];
          var next = {};
          var i;
          for (i = 0; i < labels.length; i += 1) {
            if (labels[i].reference && labels[i].displayReference) {
              next[String(labels[i].reference)] = String(labels[i].displayReference);
            }
          }
          labelsByReference = next;
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
