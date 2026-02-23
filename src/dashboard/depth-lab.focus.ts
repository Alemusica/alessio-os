/**
 * Depth Lab — Tessuto: Focus Mode 3D
 *
 * PTI livello: tessuto
 * Ruolo: macchina a stati per focus mode.
 *        Click item → scatter + 3D text panel + chat input.
 *        ESC / click fuori → restore.
 *
 * SALTI:
 *   enterFocus(idx) → scatter items, camera reset, create 3D text, show chat
 *   exitFocus()     → restore positions, camera, remove 3D text, hide chat
 *
 * Dipende da: itemBasePos, items, n, DATA, scene, baseTarget, hoverOffset,
 *             focalTarget, startAnimate, hideCtx, classifyProject, breathPour,
 *             PHI, GOLDEN_ANGLE, profile, saveProfile
 */

export function depthLabFocusJS(): string {
  return `
  // ═══════════════════════════════════════════
  // TESSUTO: FOCUS MODE 3D
  // ═══════════════════════════════════════════

  var focusState = 'idle'; // idle | entering | focused | exiting
  var focusedIdx = -1;
  var focusSavedPos = [];
  var focusSavedCamera = { x: 0, y: 0, z: 0 };
  var focusTextEl = null;
  var focusMsgContainer = null;

  // ── PORTFOLIO DESCRIPTIONS ──
  var PROJ_DESC = {
    'alessio-os': 'Personal operating system. TypeScript dashboard with 3D depth-lab, PTI architecture, real-time agent orchestration.',
    'phonon-ui': 'UI framework built on phonon principles. Concrete pour rendering, recitative rhythm, spatial typography.',
    'nico': 'Causal discovery engine. Python-based, explores causal relationships in complex datasets.',
    'rememberance': 'Multi-objective memory system. NSGA-II optimization meets LLM for selective recall.',
    'innesti': 'Digital garden. React/Vite/TS, living portfolio of interconnected ideas and projects.',
    'monade-geodensa': 'Contextual compression paradigm. From metacodec to geometric codec. 7 versions, 19 iterations. Patent pending.',
    'dag-consulting': 'HSE consulting website for DAG Consulting. Cloudflare Pages, safety courses catalog.',
    'phi-docs': 'Golden ratio document system. Printable docs with Swiss typography and Fibonacci proportions.',
    'natale-order-manager': 'Christmas order management for MareMio SRL. React/TS/Supabase, 262 orders in production.',
    'pti': 'Paradigma Tissutale Interconnesso. Code as relationships, not sequences. The LLM is the first non-local reader.',
    'home': 'The root session. General conversations and system orchestration.'
  };

  function getFocusDesc(name) {
    var nm = name.toLowerCase().replace(/[^a-z0-9-]/g, '');
    for (var key in PROJ_DESC) {
      if (nm === key || nm.indexOf(key) >= 0 || key.indexOf(nm) >= 0) return PROJ_DESC[key];
    }
    return '';
  }

  // ── ENTER FOCUS ──
  function enterFocus(idx) {
    assert(typeof idx === 'number', 'enterFocus: idx deve essere numero');
    if (focusState !== 'idle' || idx < 0 || idx >= n) return;
    focusState = 'entering';
    focusedIdx = idx;
    hideCtx();

    // Save original state
    focusSavedPos = [];
    for (var i = 0; i < n; i++) {
      focusSavedPos.push({ x: itemBasePos[i].x, y: itemBasePos[i].y, z: itemBasePos[i].z });
    }
    focusSavedCamera = { x: baseTarget.x, y: baseTarget.y, z: baseTarget.z };

    // CSS transitions for smooth scatter
    for (var i = 0; i < n; i++) {
      items[i].style.transition = 'transform 1.2s cubic-bezier(0.16,1,0.3,1), filter 0.6s ease, opacity 0.6s ease';
      itemOffset[i].x = 0; itemOffset[i].y = 0;
      itemOffsetTarget[i].x = 0; itemOffsetTarget[i].y = 0;
    }

    // ── FOCUSED ITEM: present position (left-center, Z=0) ──
    var presentX = -(window.innerWidth * 0.15);
    itemBasePos[idx] = { x: presentX, y: 0, z: 0 };
    items[idx].dataset.z = '0';
    items[idx].style.transform = 'translate3d(' + presentX.toFixed(0) + 'px, 0px, 0px) translate(-50%, -50%)';

    // ── SCATTER: push others radially + deeper Z ──
    var fPos = focusSavedPos[idx];
    for (var i = 0; i < n; i++) {
      if (i === idx) continue;
      var orig = focusSavedPos[i];
      var dx = orig.x - fPos.x;
      var dy = orig.y - fPos.y;
      var dist = Math.sqrt(dx * dx + dy * dy);
      var dirX, dirY;
      if (dist < 10) {
        // Same position: use golden angle distribution
        var angle = i * GOLDEN_ANGLE;
        dirX = Math.cos(angle);
        dirY = Math.sin(angle);
      } else {
        dirX = dx / dist;
        dirY = dy / dist;
      }
      var pushDist = 300 + Math.random() * 200;
      var pushZ = -(200 + Math.random() * 400);
      var newX = orig.x + dirX * pushDist;
      var newY = orig.y + dirY * pushDist;
      var newZ = orig.z + pushZ;
      itemBasePos[i] = { x: newX, y: newY, z: newZ };
      items[i].dataset.z = String(Math.round(newZ));
      items[i].style.transform = 'translate3d(' + newX.toFixed(0) + 'px, ' + newY.toFixed(0) + 'px, ' + newZ.toFixed(0) + 'px) translate(-50%, -50%)';
    }

    // ── CAMERA: reset to frame focused item ──
    baseTarget.x = 0; baseTarget.y = 0; baseTarget.z = 0;
    hoverOffset.x = 0; hoverOffset.y = 0; hoverOffset.z = 0;
    focalTarget = 0; // focused item at Z=0

    // ── 3D TEXT PANEL ──
    createFocusText(idx);

    // ── CHAT INPUT ──
    var chatWrap = document.getElementById('chat-input-wrap');
    if (chatWrap) chatWrap.classList.add('visible');

    document.body.classList.add('d3-focus-active');
    startAnimate();

    setTimeout(function() {
      focusState = 'focused';
      for (var i = 0; i < n; i++) items[i].style.transition = '';
    }, 1300);
  }

  // ── EXIT FOCUS ──
  function exitFocus() {
    if (focusState !== 'focused') return;
    focusState = 'exiting';

    // CSS transitions for smooth restore
    for (var i = 0; i < n; i++) {
      items[i].style.transition = 'transform 1.2s cubic-bezier(0.16,1,0.3,1), filter 0.6s ease, opacity 0.6s ease';
    }

    // Restore original positions
    for (var i = 0; i < n; i++) {
      var p = focusSavedPos[i];
      itemBasePos[i] = { x: p.x, y: p.y, z: p.z };
      items[i].dataset.z = String(p.z);
      items[i].style.transform = 'translate3d(' + p.x.toFixed(0) + 'px, ' + p.y.toFixed(0) + 'px, ' + p.z + 'px) translate(-50%, -50%)';
    }

    // Restore camera
    baseTarget.x = focusSavedCamera.x;
    baseTarget.y = focusSavedCamera.y;
    baseTarget.z = focusSavedCamera.z;

    // Remove 3D text
    removeFocusText();

    // Hide chat + clear messages
    var chatWrap = document.getElementById('chat-input-wrap');
    if (chatWrap) chatWrap.classList.remove('visible');
    clearChatMessages();

    document.body.classList.remove('d3-focus-active');
    startAnimate();

    setTimeout(function() {
      focusState = 'idle';
      focusedIdx = -1;
      for (var i = 0; i < n; i++) items[i].style.transition = '';
    }, 1300);
  }

  // ── 3D TEXT CREATION ──
  function createFocusText(idx) {
    var name = DATA[idx].name;
    var desc = getFocusDesc(name);
    var count = DATA[idx].count;
    var cat = classifyProject(name).toUpperCase();

    // Position: right of scene center, same Z as focused item (Z=0 = sharp)
    var textX = -(window.innerWidth * 0.15) + window.innerWidth * 0.22;

    focusTextEl = document.createElement('div');
    focusTextEl.className = 'd3-focus-text';
    focusTextEl.style.transform = 'translate3d(' + textX.toFixed(0) + 'px, -55px, 0px)';
    focusTextEl.innerHTML =
      '<div class="d3-focus-name">' + name + '</div>' +
      '<div class="d3-focus-cat">' + cat + ' &middot; ' + count + ' messages</div>' +
      (desc ? '<div class="d3-focus-desc" id="focus-desc"></div>' : '');
    scene.appendChild(focusTextEl);

    // Messages container (3D, for chat responses)
    focusMsgContainer = document.createElement('div');
    focusMsgContainer.className = 'd3-focus-messages';
    focusMsgContainer.id = 'focus-messages';
    var msgY = desc ? 55 : 13;
    focusMsgContainer.style.transform = 'translate3d(' + textX.toFixed(0) + 'px, ' + msgY + 'px, 0px)';
    scene.appendChild(focusMsgContainer);

    // Animate in (double-rAF: paint initial state, then trigger transitions)
    requestAnimationFrame(function() {
      requestAnimationFrame(function() {
        if (focusTextEl) focusTextEl.classList.add('visible');
        if (desc && typeof breathPour === 'function') {
          breathPour('focus-desc', desc);
        }
      });
    });
  }

  // ── 3D TEXT REMOVAL ──
  function removeFocusText() {
    if (focusTextEl) {
      focusTextEl.classList.remove('visible');
      var el = focusTextEl;
      setTimeout(function() { if (el.parentNode) el.parentNode.removeChild(el); }, 600);
      focusTextEl = null;
    }
    if (focusMsgContainer) {
      focusMsgContainer.style.opacity = '0';
      focusMsgContainer.style.transition = 'opacity 0.4s ease';
      var mc = focusMsgContainer;
      setTimeout(function() { if (mc.parentNode) mc.parentNode.removeChild(mc); }, 600);
      focusMsgContainer = null;
    }
  }

  function clearChatMessages() {
    if (typeof chatHistory !== 'undefined') chatHistory.length = 0;
    var mc = document.getElementById('focus-messages');
    if (mc) mc.innerHTML = '';
  }

  // ── DEPTHLAB API EXTENSIONS ──
  window.depthLab.focusProject = function(name) {
    assert(typeof name === 'string', 'focusProject: name deve essere stringa');
    for (var i = 0; i < n; i++) {
      if (DATA[i].name.toLowerCase() === name.toLowerCase()) {
        (function(capturedIdx) {
          if (focusState === 'focused') {
            exitFocus();
            setTimeout(function() { enterFocus(capturedIdx); }, 1400);
          } else if (focusState === 'idle') {
            enterFocus(capturedIdx);
          }
        })(i);
        return true;
      }
    }
    return false;
  };

  window.depthLab.unfocus = function() {
    if (focusState === 'focused') exitFocus();
  };

  window.depthLab.getFocusState = function() {
    return { state: focusState, idx: focusedIdx, project: focusedIdx >= 0 ? DATA[focusedIdx].name : null };
  };`;
}
