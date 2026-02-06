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
 *   Usa camera (posizione reale renderizzata) → allineato con ciò che utente vede.
 *   hoverOffset calcolato DOPO hit-test → nessun feedback loop.
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
  // Usa camera (posizione renderizzata) → allineato con la vista utente.
  // ═══════════════════════════════════════════
  var itemAura = [];
  for (var _a = 0; _a < n; _a++) itemAura.push(0);

  function updateAttractions() {
    // Perspective origin: 50% 45%. Scene origin: left:50% top:50%.
    // Gap Y = 50% - 45% = 5% — items non a Z=0 vengono proiettati dal vanishing point
    // che è 5% sopra il centro scena. La proiezione deve tenerne conto.
    var perspX = window.innerWidth / 2;
    var perspY = window.innerHeight * 0.45;
    var sceneGapY = window.innerHeight * 0.05; // scene(50%) - perspective(45%)

    // ── FASE 1: proietta + aura con priorità Z ──
    // Usa camera (posizione reale) per allinearsi a ciò che l'utente vede
    var camX = camera.x;
    var camY = camera.y;
    var camZ = camera.z;
    var maxAura = 0;
    var maxAuraIdx = -1;
    for (var i = 0; i < n; i++) {
      var bp = itemBasePos[i];
      var relZ = bp.z + camZ;
      if (relZ >= PD) { itemAura[i] = 0; continue; }
      var scale = PD / (PD - relZ);
      // Proietta posizione VISIVA (base + offset attrazione)
      // Formula CSS: perspOrigin + (sceneOrigin + itemPos - perspOrigin) * scale
      // Per X: perspX = sceneOriginX → semplifica a perspX + visualX * scale
      // Per Y: sceneOriginY = perspY + sceneGapY → include il gap
      var visualX = bp.x + itemOffset[i].x + camX;
      var visualY = bp.y + itemOffset[i].y + camY;
      var screenX = perspX + visualX * scale;
      var screenY = perspY + (sceneGapY + visualY) * scale;
      // Box-distance: aura segue la forma dell'item (glow rettangolare)
      var halfW = itemHalfW[i] * scale;
      var halfH = itemHalfH[i] * scale;
      var edgeDx = Math.max(0, Math.abs(mouseX - screenX) - halfW);
      var edgeDy = Math.max(0, Math.abs(mouseY - screenY) - halfH);
      var d = Math.sqrt(edgeDx * edgeDx + edgeDy * edgeDy);
      // Aura: glow esterno dal bordo, falloff quadratico
      var auraRadius = HIT_RADIUS * scale;
      var aura = Math.max(0, 1 - d / auraRadius);
      aura = aura * aura;
      // Priorità Z: soft — sqrt per non sopraffare la distanza
      aura = aura * Math.sqrt(scale);
      itemAura[i] = aura;
      if (aura > maxAura) { maxAura = aura; maxAuraIdx = i; }
    }

    // ── FASE 2: hoveredItem = max aura CON ISTERESI ──
    // Per cambiare item, il nuovo deve avere aura > 30% in più del corrente.
    // Previene il bouncing tra item vicini in cluster densi.
    var prevHovered = hoveredItem;
    var prevIdx = prevHovered ? parseInt(prevHovered.dataset.index) : -1;
    var prevAura = prevIdx >= 0 ? itemAura[prevIdx] : 0;

    if (maxAuraIdx >= 0 && maxAura > 0.01) {
      // C'è un candidato con aura valida
      var shouldSwitch = !prevHovered || prevAura < 0.01 ||
        maxAuraIdx === prevIdx || maxAura > prevAura * 1.3;

      if (shouldSwitch) {
        hoveredItem = items[maxAuraIdx];
        if (hoveredItem !== prevHovered) {
          if (prevHovered) prevHovered.classList.remove('attracted');
          hoveredItem.classList.add('attracted');
        }
      }
      // else: ISTERESI — mantieni prevHovered, non toccare nulla

      // Focal target: segue SEMPRE l'item attivo (sia nuovo che mantenuto)
      if (hoveredItem) {
        var hovZ = parseFloat(hoveredItem.dataset.z) || 0;
        focalTarget = hovZ + camZ;
      }
    } else {
      // Nessun candidato → deseleziona
      if (prevHovered) prevHovered.classList.remove('attracted');
      hoveredItem = null;
      maxAuraIdx = -1;
    }

    // ── PROBE: aggiorna debug overlay ──
    if (window._probeOn) {
      var prMouse = document.getElementById('pr-mouse');
      var prBase = document.getElementById('pr-base');
      var prCam = document.getElementById('pr-cam');
      var prDelta = document.getElementById('pr-delta');
      var prHovered = document.getElementById('pr-hovered');
      var prAura = document.getElementById('pr-aura');
      var prScreen = document.getElementById('pr-screen');
      var prAuraR = document.getElementById('pr-aura-r');
      var prDist = document.getElementById('pr-dist');
      var prScale = document.getElementById('pr-scale');
      var prTop3 = document.getElementById('pr-top3');
      var dot = document.getElementById('probe-dot');
      var ring = document.getElementById('probe-ring');

      if (prMouse) prMouse.textContent = Math.round(mouseX) + ', ' + Math.round(mouseY);
      if (prBase) prBase.textContent = baseTarget.x.toFixed(0) + ', ' + baseTarget.y.toFixed(0) + ', ' + baseTarget.z.toFixed(0);
      if (prCam) prCam.textContent = camX.toFixed(0) + ', ' + camY.toFixed(0) + ', ' + camZ.toFixed(0);
      if (prDelta) prDelta.textContent = (camX - baseTarget.x).toFixed(1) + ', ' + (camY - baseTarget.y).toFixed(1);

      if (maxAuraIdx >= 0) {
        var hbp = itemBasePos[maxAuraIdx];
        var hRelZ = hbp.z + camZ;
        var hScale = (hRelZ >= PD) ? 1 : PD / (PD - hRelZ);
        var hScreenX = perspX + (hbp.x + itemOffset[maxAuraIdx].x + camX) * hScale;
        var hScreenY = perspY + (sceneGapY + hbp.y + itemOffset[maxAuraIdx].y + camY) * hScale;
        var hHalfW = itemHalfW[maxAuraIdx] * hScale;
        var hHalfH = itemHalfH[maxAuraIdx] * hScale;
        var hEdgeDx = Math.max(0, Math.abs(mouseX - hScreenX) - hHalfW);
        var hEdgeDy = Math.max(0, Math.abs(mouseY - hScreenY) - hHalfH);
        var hDist = Math.sqrt(hEdgeDx * hEdgeDx + hEdgeDy * hEdgeDy);
        var hAuraR = HIT_RADIUS * hScale;

        if (prHovered) prHovered.textContent = items[maxAuraIdx].dataset.project || maxAuraIdx;
        if (prAura) prAura.textContent = maxAura.toFixed(4);
        if (prScreen) prScreen.textContent = Math.round(hScreenX) + ', ' + Math.round(hScreenY);
        if (prAuraR) prAuraR.textContent = Math.round(hHalfW * 2) + 'x' + Math.round(hHalfH * 2) + '+' + hAuraR.toFixed(0) + 'px';
        if (prDist) prDist.textContent = hDist.toFixed(1) + 'px (edge)';
        if (prScale) prScale.textContent = hScale.toFixed(3);

        if (dot) { dot.style.left = hScreenX + 'px'; dot.style.top = hScreenY + 'px'; dot.style.display = ''; }
        // Ring diventa rettangolo (box aura)
        if (ring) {
          var ringW = (hHalfW + hAuraR) * 2;
          var ringH = (hHalfH + hAuraR) * 2;
          ring.style.left = hScreenX + 'px'; ring.style.top = hScreenY + 'px';
          ring.style.width = ringW + 'px'; ring.style.height = ringH + 'px';
          ring.style.borderRadius = hAuraR + 'px';
          ring.style.display = '';
        }
      } else {
        if (prHovered) prHovered.textContent = '—';
        if (prAura) prAura.textContent = '0';
        if (prScreen) prScreen.textContent = '—';
        if (dot) dot.style.display = 'none';
        if (ring) ring.style.display = 'none';
      }

      // Top 3 aura items
      if (prTop3) {
        var sorted = [];
        for (var t = 0; t < n; t++) if (itemAura[t] > 0.001) sorted.push({ i: t, a: itemAura[t] });
        sorted.sort(function(a, b) { return b.a - a.a; });
        var top = sorted.slice(0, 3).map(function(e) {
          return (items[e.i].dataset.project || e.i) + ':' + e.a.toFixed(3);
        }).join(' | ');
        prTop3.textContent = top || '—';
      }
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

      // De-proietta mouse nel piano Z di QUESTO item (usa camera = ciò che utente vede)
      var thisRelZ = bp.z + camZ;
      var thisScale = (thisRelZ >= PD) ? 1 : PD / (PD - thisRelZ);
      var sceneMouseX = (mouseX - perspX) / thisScale - camX;
      var sceneMouseY = (mouseY - perspY) / thisScale - sceneGapY - camY;

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
    // Focal snap: se c'è item evidenziato, lerp 3x più veloce
    var fl = hoveredItem ? Math.min(profile.focalLerp * 3, 0.5) : profile.focalLerp;
    focalDistance += df * fl;

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
  // Gerarchia: evidenziato VINCE → sempre nitido, blur 0.
  // DoF classico per tutto il resto, piano focale segue l'evidenziato.
  function updateDoF() {
    var focalZ = focalDistance;

    for (var i = 0; i < items.length; i++) {
      // Highlighted: SEMPRE nitido — staccato dal DoF
      if (items[i] === hoveredItem) {
        items[i].style.filter = 'none';
        items[i].style.opacity = '1';
        items[i].classList.add('in-focus');
        continue;
      }

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
