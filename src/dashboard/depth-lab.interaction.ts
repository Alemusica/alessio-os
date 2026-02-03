/**
 * Depth Lab — Tessuto: Interazione (Hover/Drag/Scroll/Keyboard/Ctx)
 *
 * PTI livello: tessuto
 * Ruolo: gestisce tutti gli input utente, il pannello parametri,
 *        e l'API PTI window.depthLab per il futuro LLM interno.
 * Dipende da: profile.* per zoomSpeed, smartZoomPull, parallaxStrength.
 */

export function depthLabInteractionJS(): string {
  return `
  // ═══════════════════════════════════════════
  // TESSUTO: INTERAZIONE
  // ═══════════════════════════════════════════

  // ── SCROLL → Z + SMART ZOOM ──
  viewport.addEventListener('wheel', function(e) {
    e.preventDefault();
    if (e.ctrlKey) {
      fStop = Math.max(1.0, Math.min(16, fStop + e.deltaY * 0.02));
      profile.fStop = fStop;
      saveProfile();
      updateApertureUI();
      startAnimate();
      return;
    }
    var zoomAmount = e.deltaY * profile.zoomSpeed;
    baseTarget.z += zoomAmount;
    baseTarget.x -= e.deltaX * 1.5;
    if (hoveredItem) {
      var bp = itemBasePos[parseInt(hoveredItem.dataset.index)];
      var pull = Math.min(0.08, Math.abs(zoomAmount) * profile.smartZoomPull);
      baseTarget.x += (-bp.x - baseTarget.x) * pull;
      baseTarget.y += (-bp.y - baseTarget.y) * pull;
    }
    startAnimate();
  }, { passive: false });

  // ── DRAG ──
  var dragging = false;
  var dragStart = { x: 0, y: 0 };

  viewport.addEventListener('mousedown', function(e) {
    if (e.target.closest('.d3-controls') || e.target.closest('.d3-back') || e.target.closest('.d3-aperture') || e.target.closest('.d3-params')) return;
    dragging = true;
    dragStart.x = e.clientX;
    dragStart.y = e.clientY;
  });

  window.addEventListener('mousemove', function(e) {
    if (!dragging) return;
    baseTarget.x += (e.clientX - dragStart.x) * 1.2;
    baseTarget.y += (e.clientY - dragStart.y) * 1.2;
    dragStart.x = e.clientX;
    dragStart.y = e.clientY;
    startAnimate();
  });

  window.addEventListener('mouseup', function() { dragging = false; });

  // ── APERTURE SLIDER ──
  var slider = document.getElementById('fstop-slider');
  var fstopVal = document.getElementById('fstop-val');
  var iris = document.getElementById('iris');

  function updateApertureUI() {
    fstopVal.textContent = 'f/' + fStop.toFixed(1);
    slider.value = fStop;
    document.getElementById('hud-fstop').textContent = fStop.toFixed(1);
    var pct = 1 - (fStop - 1) / 15;
    iris.setAttribute('style',
      'width:' + (10 + pct * 8) + 'px;height:' + (10 + pct * 8) + 'px;' +
      'border-color:' + (pct > 0.5 ? 'var(--accent)' : 'var(--dim)'));
  }

  slider.addEventListener('input', function() {
    fStop = parseFloat(slider.value);
    profile.fStop = fStop;
    saveProfile();
    updateApertureUI();
    startAnimate();
  });

  // ── PULL FACTOR SLIDER ──
  var pullSlider = document.getElementById('pull-slider');
  var pullVal = document.getElementById('pull-val');

  function updatePullUI() {
    pullVal.textContent = PULL_FACTOR.toFixed(2);
    pullSlider.value = PULL_FACTOR;
    document.getElementById('hud-pull').textContent = PULL_FACTOR.toFixed(2);
  }

  pullSlider.addEventListener('input', function() {
    PULL_FACTOR = parseFloat(pullSlider.value);
    profile.pullFactor = PULL_FACTOR;
    saveProfile();
    updatePullUI();
    if (hoveredItem) updateAttractions();
  });

  // ═══════════════════════════════════════════
  // PARAMETERS PANEL
  // ═══════════════════════════════════════════
  var paramsPanel = document.getElementById('params-panel');
  var paramsPanelOpen = false;

  window.toggleParamsPanel = function() {
    paramsPanelOpen = !paramsPanelOpen;
    paramsPanel.classList.toggle('open', paramsPanelOpen);
    document.getElementById('btn-params').classList.toggle('active', paramsPanelOpen);
  };

  window.toggleSection = function(el) {
    var body = el.nextElementSibling;
    var open = body.style.display !== 'none';
    body.style.display = open ? 'none' : 'block';
    el.textContent = (open ? '▸ ' : '▾ ') + el.textContent.substring(2);
  };

  // Init sections collapsed
  document.querySelectorAll('.d3-params-body').forEach(function(body) {
    body.style.display = 'none';
  });

  // ── PARAM SLIDERS ──
  function updateParamsUI() {
    document.querySelectorAll('.d3-param-row input[data-key]').forEach(function(inp) {
      var key = inp.dataset.key;
      if (profile.hasOwnProperty(key)) {
        inp.value = profile[key];
        var val = inp.closest('.d3-param-row').querySelector('.d3-param-val');
        if (val) val.textContent = Number(profile[key]).toFixed(inp.step && inp.step.indexOf('.') >= 0 ? (inp.step.split('.')[1] || '').length : 0);
      }
    });
  }

  document.querySelectorAll('.d3-param-row input[data-key]').forEach(function(inp) {
    inp.addEventListener('input', function() {
      var key = inp.dataset.key;
      var v = parseFloat(inp.value);
      profile[key] = v;
      // Sync mutable vars
      if (key === 'fStop') { fStop = v; updateApertureUI(); }
      if (key === 'maxBlur') maxBlur = v;
      if (key === 'pullFactor') { PULL_FACTOR = v; updatePullUI(); }
      if (key === 'maxRipple') MAX_RIPPLE = v;
      // Update display
      var val = inp.closest('.d3-param-row').querySelector('.d3-param-val');
      if (val) val.textContent = v.toFixed(inp.step && inp.step.indexOf('.') >= 0 ? (inp.step.split('.')[1] || '').length : 0);
      // Re-layout for geometry params
      var geoKeys = ['fibonacciRadius','fibonacciZDepth','clusterRadius','clusterZGap','clusterZDepth','alphaColWidth','alphaZDepth','fontScaleBase','fontScaleLog','fontMax'];
      if (geoKeys.indexOf(key) >= 0 && layoutFns[currentLayout]) {
        layoutFns[currentLayout]();
      }
      saveProfile();
      startAnimate();
    });
  });

  // ── EXPORT / IMPORT ──
  window.promptExport = function() {
    var json = JSON.stringify(profile, null, 2);
    prompt('Profile JSON (copy):', json);
  };

  window.promptImport = function() {
    var json = prompt('Paste profile JSON:');
    if (json) {
      try {
        window.depthLab.importJSON(json);
      } catch(e) {
        alert('Invalid JSON');
      }
    }
  };

  // ═══════════════════════════════════════════
  // API PTI — window.depthLab
  // Espone l'intero profilo come API per il futuro LLM interno.
  // ═══════════════════════════════════════════
  window.depthLab = {
    getProfile: function() { return JSON.parse(JSON.stringify(profile)); },
    setProfile: function(partial) {
      for (var k in partial) {
        if (DEFAULTS.hasOwnProperty(k)) profile[k] = partial[k];
      }
      applyProfile();
      saveProfile();
    },
    setParam: function(key, val) {
      if (DEFAULTS.hasOwnProperty(key)) {
        profile[key] = val;
        applyProfile();
        saveProfile();
      }
    },
    getParam: function(key) { return profile[key]; },
    resetDefaults: function() {
      for (var k in DEFAULTS) profile[k] = DEFAULTS[k];
      applyProfile();
      saveProfile();
    },
    exportJSON: function() { return JSON.stringify(profile, null, 2); },
    importJSON: function(json) {
      var parsed = typeof json === 'string' ? JSON.parse(json) : json;
      for (var k in DEFAULTS) {
        if (parsed.hasOwnProperty(k)) profile[k] = parsed[k];
      }
      applyProfile();
      saveProfile();
    },
    getDefaults: function() { return JSON.parse(JSON.stringify(DEFAULTS)); },
    // PTI metadata
    _pti: {
      tipo: 'interfaccia',
      livello: 2,
      membrana: 'superficie',
      parametri: Object.keys(DEFAULTS)
    }
  };

  // ── CONTEXT MENU ──
  var ctxMenu = document.getElementById('ctx-menu');
  var ctxProject = null;

  function showCtx(x, y, projectName) {
    ctxProject = projectName;
    document.getElementById('ctx-title').textContent = projectName;
    var mw = ctxMenu.offsetWidth || 160;
    var mh = ctxMenu.offsetHeight || 180;
    if (x + mw > window.innerWidth) x = window.innerWidth - mw - 8;
    if (y + mh > window.innerHeight) y = window.innerHeight - mh - 8;
    ctxMenu.style.left = x + 'px';
    ctxMenu.style.top = y + 'px';
    ctxMenu.classList.add('open');
  }

  function hideCtx() {
    ctxMenu.classList.remove('open');
    ctxProject = null;
  }

  // ── PER-ITEM CLICK + CONTEXT MENU ──
  // Hover detection è in camera.ts via elementFromPoint sul mousemove globale.
  // Questo elimina il pumping: hover cambia SOLO quando l'utente muove il mouse,
  // MAI come effetto collaterale del parallax che sposta la scena.
  items.forEach(function(item) {
    item.addEventListener('contextmenu', function(e) {
      e.preventDefault();
      e.stopPropagation();
      showCtx(e.clientX, e.clientY, item.dataset.project);
    });

    item.addEventListener('click', function(e) {
      if (Math.abs(e.clientX - dragStart.x) > 5) return;
      hideCtx();
      showCtx(e.clientX + 10, e.clientY, item.dataset.project);
    });
  });

  // ── CONTEXT MENU ACTIONS ──
  document.querySelectorAll('.d3-ctx-item').forEach(function(el) {
    el.addEventListener('click', function() {
      var action = el.dataset.action;
      var proj = ctxProject;
      hideCtx();
      if (!proj) return;
      if (action === 'focus') {
        for (var i = 0; i < items.length; i++) {
          if (items[i].dataset.project === proj) {
            var iz = parseFloat(items[i].dataset.z) || 0;
            baseTarget.z = -iz;
            focalTarget = 0;
            startAnimate();
            break;
          }
        }
      } else {
        var views = { open: '', chat: 'chat', sessions: 'sessions', graph: 'graph' };
        var v = views[action] || '';
        window.location.href = '/?project=' + encodeURIComponent(proj) + (v ? '&view=' + v : '');
      }
    });
  });

  document.addEventListener('click', function(e) {
    if (!e.target.closest('.d3-ctx')) hideCtx();
  });

  viewport.addEventListener('contextmenu', function(e) {
    if (!e.target.closest('.d3-item')) { e.preventDefault(); hideCtx(); }
  });

  // ── KEYBOARD ──
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') { hideCtx(); return; }
    if (e.key === 'p' || e.key === 'P') { window.toggleParamsPanel(); return; }
    var step = e.shiftKey ? 300 : 100;
    if (e.key === 'ArrowUp') { baseTarget.z += step; e.preventDefault(); }
    if (e.key === 'ArrowDown') { baseTarget.z -= step; e.preventDefault(); }
    if (e.key === 'ArrowLeft') { baseTarget.x += step; e.preventDefault(); }
    if (e.key === 'ArrowRight') { baseTarget.x -= step; e.preventDefault(); }
    if (e.key === '[') { fStop = Math.max(1.0, fStop - 0.5); profile.fStop = fStop; saveProfile(); updateApertureUI(); }
    if (e.key === ']') { fStop = Math.min(16, fStop + 0.5); profile.fStop = fStop; saveProfile(); updateApertureUI(); }
    if (e.key === '-') { PULL_FACTOR = Math.max(0, +(PULL_FACTOR - 0.01).toFixed(2)); profile.pullFactor = PULL_FACTOR; saveProfile(); updatePullUI(); }
    if (e.key === '=' || e.key === '+') { PULL_FACTOR = Math.min(0.20, +(PULL_FACTOR + 0.01).toFixed(2)); profile.pullFactor = PULL_FACTOR; saveProfile(); updatePullUI(); }
    if (e.key === 'r') { baseTarget.x = 0; baseTarget.y = 0; baseTarget.z = 0; focalTarget = 0; }
    if (e.key === '1') window.switchLayout('fibonacci');
    if (e.key === '2') window.switchLayout('cluster');
    if (e.key === '3') window.switchLayout('alpha');
    startAnimate();
  });

  // ── THEME ──
  window.setTheme = function(name) {
    var classes = ['night', 'primavera', 'estate', 'ellenica', 'benessere'];
    classes.forEach(function(c) { document.documentElement.classList.remove(c); });
    if (name !== 'default') document.documentElement.classList.add(name);
    profile.theme = name;
    saveProfile();
  };`;
}
