/**
 * Depth Lab — Tessuto: Camera + DoF + Animazione
 *
 * PTI livello: tessuto
 * Ruolo: gestisce la telecamera virtuale, il depth-of-field,
 *        il loop di animazione, e l'attrazione elastica per-item.
 * Dipende da: profile.* per cameraLerp, focalLerp, lerpBase, lerpNear,
 *             parallaxStrength.
 *             Variabili mutable fStop, maxBlur, PULL_FACTOR, MAX_RIPPLE,
 *             HIT_RADIUS, MAX_OFFSET sono sincronizzate da applyProfile().
 *
 * Hit-test: proiezione prospettica manuale (stessa formula di CSS perspective).
 *   Il mouse vive in 2D sullo schermo. Gli item vivono nel volume 3D.
 *   Per ogni mousemove, proiettiamo ogni itemBasePos sullo schermo,
 *   troviamo il più vicino al mouse, e de-proiettiamo il mouse nel piano Z
 *   dell'item per calcolare il vettore attrazione.
 *   Usa baseTarget (non camera) → immune al parallax → zero feedback loop.
 */

export function depthLabCameraJS(): string {
  return `
  // ═══════════════════════════════════════════
  // TESSUTO: CAMERA + DOF + ANIMAZIONE
  // ═══════════════════════════════════════════

  // ── CAMERA STATE ──
  // fStop, maxBlur, PULL_FACTOR, MAX_RIPPLE, HIT_RADIUS, MAX_OFFSET
  // sono dichiarati nel main IIFE e sincronizzati da applyProfile().
  var camera = { x: 0, y: 0, z: 0 };
  var target = { x: 0, y: 0, z: 0 };
  var baseTarget = { x: 0, y: 0, z: 0 };
  var hoverOffset = { x: 0, y: 0, z: 0 };
  var focalDistance = 0;
  var focalTarget = 0;
  var hoveredItem = null;

  // ── PERSPECTIVE CONSTANTS ──
  // Matches CSS: perspective: 1400px, perspective-origin: 50% 45%
  var PD = 1400;

  // ── MOUSE TRACKING ──
  var mouseX = window.innerWidth / 2;
  var mouseY = window.innerHeight / 2;

  // ═══════════════════════════════════════════
  // ELASTIC LATTICE — Aura 2D (hit-test) + Ripple 3D (propagazione)
  //
  // Fase 1: proietta ogni item sullo schermo, calcola aura con priorità Z
  //         (front items vincono quando sovrapposti).
  // Fase 2: hoveredItem = max aura → CSS .attracted + focalTarget.
  // Fase 3: hovered item si attrae verso mouse (aura piena).
  //         Vicini seguono via ripple 3D (distanza dall'hoverato).
  //         Items lontani in 3D non reagiscono → zero caos.
  //
  // Usa baseTarget (non camera) → immune al parallax.
  // ═══════════════════════════════════════════
  var itemAura = [];
  for (var _a = 0; _a < n; _a++) itemAura.push(0);

  function updateAttractions() {
    var originX = window.innerWidth / 2;
    var originY = window.innerHeight * 0.45;

    // ── FASE 1: proietta + aura con priorità Z ──
    var maxAura = 0;
    var maxAuraIdx = -1;
    for (var i = 0; i < n; i++) {
      var bp = itemBasePos[i];
      var relZ = bp.z + baseTarget.z;
      if (relZ >= PD) { itemAura[i] = 0; continue; }
      var scale = PD / (PD - relZ);
      var screenX = originX + (bp.x + baseTarget.x) * scale;
      var screenY = originY + (bp.y + baseTarget.y) * scale;
      var dx = mouseX - screenX;
      var dy = mouseY - screenY;
      var d = Math.sqrt(dx * dx + dy * dy);
      // Aura: raggio scalato per prospettiva, falloff quadratico
      var auraRadius = HIT_RADIUS * 3.0 * scale;
      var aura = Math.max(0, 1 - d / auraRadius);
      aura = aura * aura;
      // Priorità Z: front items (scale > 1) vincono su back items (scale < 1)
      aura = aura * scale;
      itemAura[i] = aura;
      if (aura > maxAura) { maxAura = aura; maxAuraIdx = i; }
    }

    // ── FASE 2: hoveredItem = max aura ──
    var prevHovered = hoveredItem;
    if (maxAuraIdx >= 0 && maxAura > 0.01) {
      hoveredItem = items[maxAuraIdx];
      if (hoveredItem !== prevHovered) {
        if (prevHovered) prevHovered.classList.remove('attracted');
        hoveredItem.classList.add('attracted');
      }
      // Focal target: aggiornare SEMPRE (non solo al cambio)
      var hovZ = parseFloat(hoveredItem.dataset.z) || 0;
      focalTarget = hovZ + baseTarget.z;
    } else {
      if (prevHovered) prevHovered.classList.remove('attracted');
      hoveredItem = null;
      maxAuraIdx = -1;
    }

    // ── PARALLAX: hoverOffset → camera verso l'item hoverato ──
    if (maxAuraIdx >= 0) {
      var hovBp = itemBasePos[maxAuraIdx];
      hoverOffset.x = -hovBp.x * profile.parallaxStrength;
      hoverOffset.y = -hovBp.y * profile.parallaxStrength;
    } else {
      hoverOffset.x = 0;
      hoverOffset.y = 0;
    }

    // ── FASE 3: attrazione ibrida — aura per hovered, ripple 3D per vicini ──
    if (maxAuraIdx < 0 || layoutTransitioning) {
      for (var i = 0; i < n; i++) {
        itemOffsetTarget[i].x = 0;
        itemOffsetTarget[i].y = 0;
      }
      startAnimate();
      return;
    }

    var hovBase = itemBasePos[maxAuraIdx];

    for (var i = 0; i < n; i++) {
      var bp = itemBasePos[i];

      // De-proietta mouse nel piano Z di QUESTO item
      var thisRelZ = bp.z + baseTarget.z;
      var thisScale = (thisRelZ >= PD) ? 1 : PD / (PD - thisRelZ);
      var sceneMouseX = (mouseX - originX) / thisScale - baseTarget.x;
      var sceneMouseY = (mouseY - originY) / thisScale - baseTarget.y;

      // Vettore da QUESTO item verso la proiezione del mouse nel suo piano Z
      var toMouseX = sceneMouseX - bp.x;
      var toMouseY = sceneMouseY - bp.y;

      // Intensità: l'hoverato usa aura piena, gli altri usano ripple 3D
      var intensity;
      if (i === maxAuraIdx) {
        intensity = 1.0;
      } else {
        // Ripple: falloff quadratico dalla distanza 3D all'hoverato
        var dhx = bp.x - hovBase.x;
        var dhy = bp.y - hovBase.y;
        var dhz = bp.z - hovBase.z;
        var distToHovered = Math.sqrt(dhx * dhx + dhy * dhy + dhz * dhz);
        intensity = Math.max(0, 1 - distToHovered / MAX_RIPPLE);
        intensity = intensity * intensity;
      }

      if (intensity < 0.001) {
        itemOffsetTarget[i].x = 0;
        itemOffsetTarget[i].y = 0;
        continue;
      }

      // Offset = tira verso il mouse, scalato per intensità
      var ox = toMouseX * PULL_FACTOR * intensity;
      var oy = toMouseY * PULL_FACTOR * intensity;

      // Cap offset
      var om = Math.sqrt(ox * ox + oy * oy);
      if (om > MAX_OFFSET) {
        ox = ox / om * MAX_OFFSET;
        oy = oy / om * MAX_OFFSET;
      }

      itemOffsetTarget[i].x = ox;
      itemOffsetTarget[i].y = oy;
    }
    startAnimate();
  }

  // ── GLOBAL MOUSE TRACKING + HIT-TEST ──
  // Sempre attivo: hit-test su ogni mousemove, non dipende da DOM events.
  window.addEventListener('mousemove', function(e) {
    mouseX = e.clientX;
    mouseY = e.clientY;
    if (!layoutTransitioning) {
      updateAttractions();
    }
  });

  // ── ANIMATION LOOP ──
  var animating = false;
  function animate() {
    // Camera: target = baseTarget + hoverOffset (parallax)
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
        // lerpSpeed: più vicino all'hoverato in 3D → più rapido
        var lerpSpeed = profile.lerpBase * itemSeed[i];
        if (hovBase) {
          var dhx = itemBasePos[i].x - hovBase.x;
          var dhy = itemBasePos[i].y - hovBase.y;
          var dhz = itemBasePos[i].z - hovBase.z;
          var d3 = Math.sqrt(dhx * dhx + dhy * dhy + dhz * dhz);
          var proximity = Math.max(0, 1 - d3 / MAX_RIPPLE);
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
