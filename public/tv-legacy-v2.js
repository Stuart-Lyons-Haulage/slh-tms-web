(function () {
  'use strict';
  var root = document.getElementById('root');
  if (!root) { return; }

  var MAX_ROWS = 10;
  var ROTATE_MS = 15000;
  var REFRESH_MS = 20000;
  var offset = 0;
  var state = { live: null, progress: [], source: '', error: '', stale: false };

  function esc(v) { return String(v == null ? '' : v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
  function param(name) {
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
  function pad(v){return v<10?'0'+v:String(v);}
  function lastSundayUtc(y,m){var d=new Date(Date.UTC(y,m+1,0));return new Date(Date.UTC(y,m,d.getUTCDate()-d.getUTCDay(),1,0,0));}
  function ukOffset(d){var y=d.getUTCFullYear();return d>=lastSundayUtc(y,2)&&d<lastSundayUtc(y,9)?60:0;}
  function ukDate(v){var d=v instanceof Date?v:new Date(v);return isNaN(d.getTime())?null:new Date(d.getTime()+ukOffset(d)*60000);}
  function today(){var d=ukDate(new Date());return d.getUTCFullYear()+'-'+pad(d.getUTCMonth()+1)+'-'+pad(d.getUTCDate());}
  function time(v){var d=v?ukDate(v):null;return d?pad(d.getUTCHours())+':'+pad(d.getUTCMinutes()):'--:--';}
  function dateText(){var d=ukDate(new Date()),days=['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'],months=['January','February','March','April','May','June','July','August','September','October','November','December'];return days[d.getUTCDay()]+' '+pad(d.getUTCDate())+' '+months[d.getUTCMonth()]+' '+d.getUTCFullYear();}
  function by(items,field){var r={},i;for(i=0;i<(items||[]).length;i+=1){r[String(items[i][field])]=items[i];}return r;}
  function runLabel(ref,planned){var raw=String(ref||'').trim(),m=/^Run\s+(\d+)\s*(AM|PM)$/i.exec(raw);if(m)return 'Run '+parseInt(m[1],10)+' '+m[2].toUpperCase();m=/^L0*(\d+)$/i.exec(raw);if(m){var n=parseInt(m[1],10)||1,d=planned?ukDate(planned):null,pm=d?d.getUTCHours()>=15:false;return 'Run '+(pm?49+n:n)+' '+(pm?'PM':'AM');}return raw||'Run TBC';}
  function stateClass(value) {
    var s = String(value || '').toUpperCase();
    if (s.indexOf('DELAY') >= 0) { return 'dwell'; }
    if (s.indexOf('LATE') >= 0) { return 'late'; }
    if (s.indexOf('RISK') >= 0) { return 'risk'; }
    if (s.indexOf('SITE') >= 0 || s.indexOf('ARRIV') >= 0) { return 'onsite'; }
    if (s.indexOf('MOV') >= 0 || s.indexOf('ROUTE') >= 0) { return 'route'; }
    if (s.indexOf('STALE') >= 0) { return 'stale'; }
    if (s.indexOf('COMPLETE') >= 0 || s.indexOf('AVAILABLE') >= 0) { return 'complete'; }
    return 'scheduled';
  }
  function xhr(path,key,cb){
    var x=new XMLHttpRequest();
    x.open('GET','/tms-api'+path,true);
    x.timeout = 85000;
    x.setRequestHeader('Accept','application/json');
    if(key){x.setRequestHeader('X-TMS-TV-Key',key);x.setRequestHeader('X-TV-Display-Key',key);}
    x.onreadystatechange=function(){if(x.readyState!==4)return;if(x.status>=200&&x.status<300){try{cb(null,JSON.parse(x.responseText));}catch(e){cb(e);}}else cb(new Error('TMS API '+x.status));};
    x.onerror=function(){cb(new Error('TMS API unavailable'));};
    x.ontimeout=function(){cb(new Error('TMS API timeout'));};
    x.send();
  }
  function progressBar(row){
    var p=row.progress||{},total=p.totalStops||1,done=p.completedStops||0,pct=p.truckPositionPercent!=null?Number(p.truckPositionPercent):Math.round(done/total*100);
    pct=Math.max(0,Math.min(100,pct));
    return '<div class="timeline"><span class="timeline-line"></span><span class="timeline-done" style="width:'+pct+'%"></span><span class="timeline-vehicle'+(p.trackingMoving?' moving':'')+'" style="left:'+pct+'%"></span></div><div class="next-job">'+esc(done+' of '+total+' stops · '+(p.focusStop||row.nextStopName||'Journey in progress'))+'</div>';
  }
  function rows(){
    var progressByLoad = by(state.progress, 'loadId');
    var source = state.live && state.live.runs ? state.live.runs : [];
    var out = [], i, item, p, cls, complete, priority, arrival, display, label;
    for (i = 0; i < source.length; i += 1) {
      item = source[i];
      p = progressByLoad[String(item.loadId)] || {};
      cls = stateClass(item.state);
      complete = cls === 'complete' || (p.totalStops > 0 && p.completedStops >= p.totalStops);
      priority = Number(item.priority == null ? 0 : item.priority);
      arrival = item.siteArrivalUtc || (p.currentVisit && (p.currentVisit.siteArrivalUtc || p.currentVisit.enteredAtUtc));
      display = complete ? 'AVAILABLE' : arrival ? time(arrival) : item.etaUtc ? time(item.etaUtc) : '--:--';
      label = complete ? 'AVAILABLE' : arrival ? 'ARRIVED' : item.etaSource === 'Live' ? 'LIVE ETA' : item.etaSource || 'TRACKING';
      out.push({
        loadId: item.loadId,
        reference: item.reference,
        runName: runLabel(item.reference, item.firstPlannedUtc),
        vehicle: item.vehicleRegistration || 'Vehicle TBC',
        driver: item.driverName || 'Driver TBC',
        nextStopName: item.nextStopName || p.focusStop || 'Next stop',
        display: display,
        label: label,
        state: item.state || 'SCHEDULED',
        detail: item.stateDetail || item.tracking || p.focusStop || '',
        tracking: item.linkageException || item.tracking || '',
        progress: p,
        cls: cls,
        complete: complete,
        priority: priority,
        sortTime: item.firstPlannedUtc ? new Date(item.firstPlannedUtc).getTime() : 9999999999999
      });
    }
    out.sort(function(a,b){if(a.complete!==b.complete)return a.complete?1:-1;if(a.priority!==b.priority)return b.priority-a.priority;return a.sortTime-b.sortTime;});
    return out;
  }
  function selected(items){var out=[],i;if(items.length<=MAX_ROWS)return items;for(i=0;i<MAX_ROWS;i+=1)out.push(items[(offset+i)%items.length]);return out;}
  function kpi(label,value,cls,symbol){return '<div class="kpi '+cls+'"><span class="kpi-icon">'+esc(symbol)+'</span><div><small>'+esc(label)+'</small><b>'+esc(value)+'</b></div></div>';}
  function render(){
    var all=rows(), shown=selected(all), board=document.getElementById('legacy-board'), msg=document.getElementById('legacy-message'), kp=document.getElementById('legacy-kpis'), att=document.getElementById('legacy-attention'), i,on=0,risk=0,late=0,available=0,html,r;
    if(!board)return;
    if(state.error && !all.length){msg.className='legacy-error';msg.innerHTML='<b>Wallboard connection problem:</b> '+esc(state.error);}
    else if(state.error){msg.className='legacy-error';msg.innerHTML='<b>Latest refresh issue:</b> '+esc(state.error)+' · showing last good TV feed';}
    else{msg.className='legacy-ok';msg.innerHTML='LIVE DATA · TV tracking feed · arrival replaces ETA';}
    for(i=0;i<all.length;i+=1){if(all[i].complete)available+=1;else if(all[i].cls==='onsite')on+=1;if(all[i].cls==='risk')risk+=1;if(all[i].cls==='late'||all[i].cls==='dwell')late+=1;}
    kp.innerHTML=kpi('RUNS ON BOARD',all.length,'active','▣')+kpi('ON SITE',on,'onsite','●')+kpi('AT RISK',risk,'risk','!')+kpi('LATE / DELAY',late,'late','◷')+kpi('AVAILABLE',available,'complete','✓');
    html='<table><thead><tr><th>RUN</th><th>VEHICLE</th><th>DRIVER</th><th>JOURNEY PROGRESS</th><th>ETA / ARRIVAL</th><th>STATUS</th></tr></thead><tbody>';
    for(i=0;i<shown.length;i+=1){r=shown[i];html+='<tr class="'+esc((r.cls==='late'||r.cls==='dwell'||r.cls==='risk')?'exception '+r.cls:r.cls)+'"><td><b class="run-name">'+esc(r.runName)+'</b></td><td><b>'+esc(r.vehicle)+'</b></td><td><b>'+esc(r.driver)+'</b></td><td>'+progressBar(r)+'</td><td><b class="next-name">'+esc(r.nextStopName)+'</b><span class="eta-time">'+esc(r.display)+'</span><small>'+esc(r.label)+'</small></td><td><strong class="status '+esc(r.cls)+'">'+esc(r.state)+'</strong></td></tr>';}
    html+='</tbody></table>';
    board.innerHTML=all.length?html:'<div class="legacy-empty">No runs are planned for today.</div>';
    att.innerHTML=late+risk?'<div class="attention-card risk"><div class="attention-copy"><b>LIVE EXCEPTIONS</b><strong>'+esc(late+risk)+' run(s) need attention</strong><small>Late ETA, site delay or route risk</small></div></div>':'<div class="attention-clear"><span class="clear-check">✓</span><b>No immediate exceptions</b><small>Live ETA and geofence exceptions are clear.</small></div>';
    document.getElementById('legacy-source').innerHTML=esc(state.source?'Tracking: '+state.source:'Tracking connected');
    document.getElementById('legacy-refresh').innerHTML='Updated '+esc(time(new Date()))+' · refresh 20s';
  }

  var key=param('key');
  root.innerHTML='<div id="legacy-tv"><div class="legacy-head"><div class="brand-wrap"><div class="brand-mark"><b>LYONS</b><span>HAULAGE</span></div><div class="head-divider"></div><h1>Live Operations</h1></div><div class="legacy-clock"><span id="legacy-date"></span><b id="legacy-clock"></b><small>● LIVE OFFICE WALLBOARD</small></div></div><div id="legacy-message">Connecting to live TMS data...</div><div id="legacy-kpis"></div><div class="board-grid"><div class="runs-panel"><div id="legacy-board"></div></div><aside class="attention-panel"><h2>ATTENTION · NEEDS ACTION</h2><div id="legacy-attention"></div></aside></div><div class="legacy-foot"><span><b>LIVE OPERATIONS</b> · all journeys rotate automatically</span><span id="legacy-source"></span><span id="legacy-refresh"></span></div></div>';
  function clock(){document.getElementById('legacy-clock').innerHTML=esc(time(new Date()));document.getElementById('legacy-date').innerHTML=esc(dateText());}
  function refresh(){
    var d=today(),pending=2,errors=[];
    if(!key){state.error='This TV link has no access key.';render();return;}
    function done(name,e,data){
      if(e){errors.push(name+': '+e.message);}
      else if(name==='live'){state.live=data;}
      else if(name==='progress'){state.progress=data&&data.runs?data.runs:state.progress;state.source=data&&data.trackingSource?data.trackingSource:state.source;}
      pending-=1;
      if(!pending){state.error=errors.join(' ');render();}
    }
    xhr('/api/v1/tv-display/live-runs?date='+encodeURIComponent(d),key,function(e,x){done('live',e,x);});
    xhr('/api/v1/tv-display/route-progress?date='+encodeURIComponent(d),key,function(e,x){done('progress',e,x);});
  }
  clock();window.setInterval(clock,1000);refresh();window.setInterval(refresh,REFRESH_MS);window.setInterval(function(){var all=rows();if(all.length>MAX_ROWS){offset=(offset+MAX_ROWS)%all.length;render();}},ROTATE_MS);
}());
