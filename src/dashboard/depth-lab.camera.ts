/**
 * Depth Lab — Tessuto: Camera + DoF + Animazione
 *
 * PTI livello: tessuto
 * Ruolo: gestisce la telecamera virtuale, il depth-of-field,
 *        e il loop di animazione con attrazione organica per-item.
 * Contiene: camera state, organic attraction (updateAttractions),
 *           animate loop (rAF), DoF blur calculation.
 * Dipende da: variabili globali IIFE (items, n, itemBasePos, itemOffset,
 *             itemOffsetTarget, itemSeed, hoveredItem, etc.)
 */

export function depthLabCameraJS(): string {
  return `
  // ═══════════════════════════════════════════
  // TESSUTO: CAMERA + DOF + ANIMAZIONE
  // ═══════════════════════════════════════════

  // ── CAMERA STATE ──
  var camera = { x: 0, y: 0, z: 0 };
  var target = { x: 0, y: 0, z: 0 };
  var baseTarget = { x: 0, y: 0, z: 0 };
  var hoverOffset = { x: 0, y: 0, z: 0 };
  var focalDistance = 0;
  var focalTarget = 0;
  var fStop = 2.8;
  var maxBlur = 12;
  var hoveredItem = null;

  // ── MOUSE TRACKING (per attrazione organica) ──
  var mouseX = window.innerWidth / 2;
  var mouseY = window.innerHeight / 2;

  // ═══════════════════════════════════════════
  // ORGANIC ATTRACTION — cuore del sistema
  // Ogni item si muove indipendentemente verso il cursore,
  // modulato dalla distanza dall'item in hover (ripple/onda).
  // Items vicini all'hover reagiscono forte e veloce,
  // items lontani reagiscono piano e poco — come un organismo.
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

    // Posizione del mouse nello spazio della scena
    var mx = mouseX - window.innerWidth / 2 - camera.x;
    var my = mouseY - window.innerHeight / 2 - camera.y;

    for (var i = 0; i < n; i++) {
      var bp = itemBasePos[i];

      // ── RIPPLE: distanza euclidea 3D dall'item in hover ──
      var dhx = bp.x - hovBase.x;
      var dhy = bp.y - hovBase.y;
      var dhz = bp.z - hovBase.z;
      var distHov = Math.sqrt(dhx * dhx + dhy * dhy + dhz * dhz);
      var ripple = Math.max(0, 1 - distHov / MAX_RIPPLE);
      ripple = ripple * ripple; // ease quadratico

      // ── ATTRAZIONE: direzione verso il cursore ──
      var dx = mx - bp.x;
      var dy = my - bp.y;

      // L'item in hover NON si muove — evita flicker cursore/hitbox.
      if (i === hovIdx) {
        itemOffsetTarget[i].x = 0;
        itemOffsetTarget[i].y = 0;
      } else {
        itemOffsetTarget[i].x = dx * PULL_FACTOR * ripple;
        itemOffsetTarget[i].y = dy * PULL_FACTOR * ripple;
      }
    }
    startAnimate();
  }

  // ── GLOBAL MOUSE TRACKING ──
  window.addEventListener('mousemove', function(e) {
    mouseX = e.clientX;
    mouseY = e.clientY;
    if (hoveredItem && !layoutTransitioning) {
      updateAttractions();
    }
  });

  // ── ANIMATION LOOP ──
  var animating = false;
  function animate() {
    // Camera: compone base + hover parallax
    target.x = baseTarget.x + hoverOffset.x;
    target.y = baseTarget.y + hoverOffset.y;
    target.z = baseTarget.z + hoverOffset.z;

    var dx = target.x - camera.x;
    var dy = target.y - camera.y;
    var dz = target.z - camera.z;
    camera.x += dx * 0.08;
    camera.y += dy * 0.08;
    camera.z += dz * 0.08;

    // Interpolazione focale morbida
    var df = focalTarget - focalDistance;
    focalDistance += df * 0.12;

    scene.style.transform =
      'translate3d(' + camera.x + 'px, ' + camera.y + 'px, ' + camera.z + 'px)';

    // ── PER-ITEM ORGANIC OFFSETS ──
    var offsetMoving = false;
    if (!layoutTransitioning) {
      var hovIdx = hoveredItem ? parseInt(hoveredItem.dataset.index) : -1;
      var hovBase = hovIdx >= 0 ? itemBasePos[hovIdx] : null;

      for (var i = 0; i < n; i++) {
        // Velocità variabile: distanza 3D + seed per-item (temperamento)
        // PTI: ogni cellula ha identità propria
        var lerpSpeed = 0.04;
        if (hovBase) {
          var dhx = itemBasePos[i].x - hovBase.x;
          var dhy = itemBasePos[i].y - hovBase.y;
          var dhz = itemBasePos[i].z - hovBase.z;
          var d = Math.sqrt(dhx * dhx + dhy * dhy + dhz * dhz);
          var proximity = Math.max(0, 1 - d / MAX_RIPPLE);
          lerpSpeed = (0.03 + 0.12 * proximity) * itemSeed[i];
        }

        var odx = itemOffsetTarget[i].x - itemOffset[i].x;
        var ody = itemOffsetTarget[i].y - itemOffset[i].y;
        itemOffset[i].x += odx * lerpSpeed;
        itemOffset[i].y += ody * lerpSpeed;

        if (Math.abs(odx) > 0.1 || Math.abs(ody) > 0.1) offsetMoving = true;

        // Applica posizione combinata: base + offset organico + centering
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
