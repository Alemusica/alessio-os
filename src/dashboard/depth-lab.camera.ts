/**
 * Depth Lab — Tessuto: Camera + DoF + Animazione
 *
 * PTI livello: tessuto
 * Ruolo: gestisce la telecamera virtuale, il depth-of-field,
 *        e il loop di animazione con attrazione organica per-item.
 * Dipende da: profile.* per cameraLerp, focalLerp, lerpBase, lerpNear.
 *             Variabili mutable fStop, maxBlur, PULL_FACTOR, MAX_RIPPLE
 *             sono sincronizzate da applyProfile().
 */

export function depthLabCameraJS(): string {
  return `
  // ═══════════════════════════════════════════
  // TESSUTO: CAMERA + DOF + ANIMAZIONE
  // ═══════════════════════════════════════════

  // ── CAMERA STATE ──
  // fStop, maxBlur, PULL_FACTOR, MAX_RIPPLE sono dichiarati nel main IIFE
  // e sincronizzati da applyProfile().
  var camera = { x: 0, y: 0, z: 0 };
  var target = { x: 0, y: 0, z: 0 };
  var baseTarget = { x: 0, y: 0, z: 0 };
  var hoverOffset = { x: 0, y: 0, z: 0 };
  var focalDistance = 0;
  var focalTarget = 0;
  var hoveredItem = null;

  // ── MOUSE TRACKING (per attrazione organica) ──
  var mouseX = window.innerWidth / 2;
  var mouseY = window.innerHeight / 2;

  // ═══════════════════════════════════════════
  // ORGANIC ATTRACTION — cuore del sistema
  // ═══════════════════════════════════════════
  function updateAttractions() {
    if (!hoveredItem || layoutTransitioning) {
      for (var i = 0; i < n; i++) {
        itemOffsetTarget[i].x = 0;
        itemOffsetTarget[i].y = 0;
      }
      startAnimate();
      return;
    }

    var hovIdx = parseInt(hoveredItem.dataset.index);
    var hovBase = itemBasePos[hovIdx];

    // PTI gerarchia: il mouse È il punto di vista, non la camera.
    // Pull = deformazione locale aggregato, ignora il piano camera.
    // Parallax muove il piano (livello superiore), pull deforma dentro (livello inferiore).
    // Nessuna sottrazione camera → zero feedback → zero pumping.
    var mx = mouseX - window.innerWidth / 2;
    var my = mouseY - window.innerHeight / 2;

    var MAX_OFFSET = 50; // cap offset per evitare movimenti esagerati

    for (var i = 0; i < n; i++) {
      var bp = itemBasePos[i];

      var dhx = bp.x - hovBase.x;
      var dhy = bp.y - hovBase.y;
      var dhz = bp.z - hovBase.z;
      var distHov = Math.sqrt(dhx * dhx + dhy * dhy + dhz * dhz);
      var ripple = Math.max(0, 1 - distHov / MAX_RIPPLE);
      ripple = ripple * ripple;

      var dx = mx - bp.x;
      var dy = my - bp.y;

      if (i === hovIdx) {
        itemOffsetTarget[i].x = 0;
        itemOffsetTarget[i].y = 0;
      } else {
        var ox = dx * PULL_FACTOR * ripple;
        var oy = dy * PULL_FACTOR * ripple;
        // Cap offset massimo
        var om = Math.sqrt(ox * ox + oy * oy);
        if (om > MAX_OFFSET) {
          ox = ox / om * MAX_OFFSET;
          oy = oy / om * MAX_OFFSET;
        }
        itemOffsetTarget[i].x = ox;
        itemOffsetTarget[i].y = oy;
      }
    }
    startAnimate();
  }

  // ── GLOBAL MOUSE TRACKING + HOVER DETECTION ──
  // Hover via elementFromPoint: cambia stato SOLO quando l'utente muove il mouse,
  // MAI come effetto collaterale del movimento della scena (elimina pumping).
  window.addEventListener('mousemove', function(e) {
    mouseX = e.clientX;
    mouseY = e.clientY;

    if (!layoutTransitioning) {
      var el = document.elementFromPoint(mouseX, mouseY);
      var itemEl = el ? el.closest('.d3-item') : null;

      if (itemEl !== hoveredItem) {
        if (itemEl) {
          // Hover enter
          hoveredItem = itemEl;
          var z = parseFloat(itemEl.dataset.z) || 0;
          focalTarget = z + camera.z;
          var bp = itemBasePos[parseInt(itemEl.dataset.index)];
          var ps = profile.parallaxStrength;
          hoverOffset.x = -bp.x * ps;
          hoverOffset.y = -bp.y * ps;
          hoverOffset.z = -z * ps;
        } else {
          // Hover leave
          hoveredItem = null;
          hoverOffset.x = 0;
          hoverOffset.y = 0;
          hoverOffset.z = 0;
        }
        updateAttractions();
      } else if (hoveredItem) {
        updateAttractions();
      }
      startAnimate();
    }
  });

  // ── ANIMATION LOOP ──
  var animating = false;
  function animate() {
    target.x = baseTarget.x + hoverOffset.x;
    target.y = baseTarget.y + hoverOffset.y;
    target.z = baseTarget.z + hoverOffset.z;

    var dx = target.x - camera.x;
    var dy = target.y - camera.y;
    var dz = target.z - camera.z;
    var cl = profile.cameraLerp;
    camera.x += dx * cl;
    camera.y += dy * cl;
    camera.z += dz * cl;

    var df = focalTarget - focalDistance;
    focalDistance += df * profile.focalLerp;

    scene.style.transform =
      'translate3d(' + camera.x + 'px, ' + camera.y + 'px, ' + camera.z + 'px)';

    // ── PER-ITEM ORGANIC OFFSETS ──
    var offsetMoving = false;
    if (!layoutTransitioning) {
      var hovIdx = hoveredItem ? parseInt(hoveredItem.dataset.index) : -1;
      var hovBase = hovIdx >= 0 ? itemBasePos[hovIdx] : null;

      for (var i = 0; i < n; i++) {
        var lerpSpeed = 0.04;
        if (hovBase) {
          var dhx = itemBasePos[i].x - hovBase.x;
          var dhy = itemBasePos[i].y - hovBase.y;
          var dhz = itemBasePos[i].z - hovBase.z;
          var d = Math.sqrt(dhx * dhx + dhy * dhy + dhz * dhz);
          var proximity = Math.max(0, 1 - d / MAX_RIPPLE);
          lerpSpeed = (profile.lerpBase + (profile.lerpNear - profile.lerpBase) * proximity) * itemSeed[i];
        }

        var odx = itemOffsetTarget[i].x - itemOffset[i].x;
        var ody = itemOffsetTarget[i].y - itemOffset[i].y;
        itemOffset[i].x += odx * lerpSpeed;
        itemOffset[i].y += ody * lerpSpeed;

        if (Math.abs(odx) > 0.1 || Math.abs(ody) > 0.1) offsetMoving = true;

        var bp = itemBasePos[i];
        items[i].style.transform = 'translate3d(' +
          (bp.x + itemOffset[i].x).toFixed(1) + 'px, ' +
          (bp.y + itemOffset[i].y).toFixed(1) + 'px, ' +
          bp.z + 'px) translate(-50%, -50%)';
      }
    }

    updateDoF();

    document.getElementById('hud-z').textContent = Math.round(-camera.z);
    document.getElementById('hud-focal').textContent = Math.round(focalDistance);

    var moving = Math.abs(dx) > 0.3 || Math.abs(dy) > 0.3 || Math.abs(dz) > 0.3 || Math.abs(df) > 0.5 || offsetMoving;
    if (moving) {
      requestAnimationFrame(animate);
    } else {
      animating = false;
      viewport.classList.remove('moving');
    }
  }

  function startAnimate() {
    if (!animating) {
      animating = true;
      viewport.classList.add('moving');
      animate();
    }
  }

  // ── DEPTH OF FIELD ──
  function updateDoF() {
    var focalZ = focalDistance;
    for (var i = 0; i < items.length; i++) {
      var itemZ = parseFloat(items[i].dataset.z) || 0;
      var relativeZ = itemZ + camera.z;
      var distance = Math.abs(relativeZ - focalZ);
      var blur = Math.min(distance / (fStop * 30), maxBlur);
      var opacity = Math.max(0.15, 1 - blur / (maxBlur * 1.5));

      items[i].style.filter = blur > 0.3 ? 'blur(' + blur.toFixed(1) + 'px)' : 'none';
      items[i].style.opacity = opacity.toFixed(2);

      if (blur < 1) {
        items[i].classList.add('in-focus');
      } else {
        items[i].classList.remove('in-focus');
      }
    }
  }`;
}
