/**
 * Depth Lab — Tessuto: Interazione (Hover/Drag/Scroll/Keyboard/Ctx)
 *
 * PTI livello: tessuto
 * Ruolo: gestisce tutti gli input utente e li traduce in
 *        movimenti camera, cambi layout, zoom, context menu.
 * Contiene: scroll+smart zoom, drag, hover+parallax, keyboard, aperture/pull sliders,
 *           context menu, theme switching.
 * Dipende da: variabili globali IIFE (items, viewport, hoveredItem, baseTarget,
 *             hoverOffset, focalTarget, PULL_FACTOR, etc.)
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
      updateApertureUI();
      startAnimate();
      return;
    }
    var zoomAmount = e.deltaY * 2;
    baseTarget.z += zoomAmount;
    baseTarget.x -= e.deltaX * 1.5;
    // Smart zoom: se c'è un item in hover, tira la vista verso di lui
    if (hoveredItem) {
      var bp = itemBasePos[parseInt(hoveredItem.dataset.index)];
      var pull = Math.min(0.08, Math.abs(zoomAmount) * 0.003);
      baseTarget.x += (-bp.x - baseTarget.x) * pull;
      baseTarget.y += (-bp.y - baseTarget.y) * pull;
    }
    startAnimate();
  }, { passive: false });

  // ── DRAG ──
  var dragging = false;
  var dragStart = { x: 0, y: 0 };

  viewport.addEventListener('mousedown', function(e) {
    if (e.target.closest('.d3-controls') || e.target.closest('.d3-back') || e.target.closest('.d3-aperture')) return;
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
    updatePullUI();
    if (hoveredItem) updateAttractions();
  });

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

  // ── PER-ITEM HOVER + CLICK + CONTEXT MENU ──
  items.forEach(function(item) {
    item.addEventListener('mouseenter', function() {
      hoveredItem = item;
      var z = parseFloat(item.dataset.z) || 0;
      focalTarget = z + camera.z;

      // Parallax INVERTITO: scena opposta all'item → item si avvicina visivamente
      var bp = itemBasePos[parseInt(item.dataset.index)];
      hoverOffset.x = -bp.x * 0.10;
      hoverOffset.y = -bp.y * 0.10;
      hoverOffset.z = -z * 0.10;

      updateAttractions();
      startAnimate();
    });

    item.addEventListener('mouseleave', function() {
      if (hoveredItem === item) {
        hoveredItem = null;
        hoverOffset.x = 0;
        hoverOffset.y = 0;
        hoverOffset.z = 0;
        updateAttractions();
        startAnimate();
      }
    });

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
    var step = e.shiftKey ? 300 : 100;
    if (e.key === 'ArrowUp') { baseTarget.z += step; e.preventDefault(); }
    if (e.key === 'ArrowDown') { baseTarget.z -= step; e.preventDefault(); }
    if (e.key === 'ArrowLeft') { baseTarget.x += step; e.preventDefault(); }
    if (e.key === 'ArrowRight') { baseTarget.x -= step; e.preventDefault(); }
    if (e.key === '[') { fStop = Math.max(1.0, fStop - 0.5); updateApertureUI(); }
    if (e.key === ']') { fStop = Math.min(16, fStop + 0.5); updateApertureUI(); }
    if (e.key === '-') { PULL_FACTOR = Math.max(0, +(PULL_FACTOR - 0.01).toFixed(2)); updatePullUI(); }
    if (e.key === '=' || e.key === '+') { PULL_FACTOR = Math.min(0.20, +(PULL_FACTOR + 0.01).toFixed(2)); updatePullUI(); }
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
  };`;
}
