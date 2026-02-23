/**
 * Depth Lab — Tessuto: LLM Chat
 *
 * PTI livello: tessuto
 * Ruolo: integrazione LLM client-side con Anthropic API.
 *        Streaming, esecuzione azioni, messaggi 3D nella scena.
 *
 * SALTI:
 *   sendChatMessage(text) → API call → streaming → breathPour / action execution
 *   executeActions(text)  → window.depthLab API → LLM manipola lo spazio
 *
 * Dipende da: focusedIdx, focusState, DATA, getFocusDesc, profile, camera,
 *             currentLayout, baseTarget, startAnimate, breathPour,
 *             window.setTheme, window.switchLayout, window.depthLab
 */

export function depthLabChatJS(): string {
  return `
  // ═══════════════════════════════════════════
  // TESSUTO: LLM CHAT
  // ═══════════════════════════════════════════

  var chatHistory = [];
  var chatStreaming = false;
  var chatMsgCount = 0;

  // ── API KEY MANAGEMENT ──
  function getApiKey() {
    return localStorage.getItem('depth-lab-api-key') || '';
  }

  function setApiKey(key) {
    localStorage.setItem('depth-lab-api-key', key);
  }

  function showApiKeyOverlay() {
    var overlay = document.getElementById('api-key-overlay');
    if (overlay) overlay.classList.add('visible');
    var inp = document.getElementById('api-key-input');
    if (inp) setTimeout(function() { inp.focus(); }, 100);
  }

  function hideApiKeyOverlay() {
    var overlay = document.getElementById('api-key-overlay');
    if (overlay) overlay.classList.remove('visible');
  }

  // ── SYSTEM PROMPT ──
  function getChatSystemPrompt() {
    var focusedName = focusedIdx >= 0 ? DATA[focusedIdx].name : 'none';
    var state = {
      theme: profile.theme,
      layout: currentLayout,
      focusedProject: focusedName,
      fStop: profile.fStop,
      cameraZ: camera.z.toFixed(0)
    };

    return 'You are an AI guide inside Alessio Cazzaniga\\'s interactive 3D portfolio (Depth Lab). ' +
      'The user is exploring projects in a depth-of-field 3D space. ' +
      'Currently focused on: ' + focusedName + '. ' +
      'Current visual state: ' + JSON.stringify(state) + '.\\n\\n' +
      'Available projects:\\n' + DATA.map(function(d) {
        var desc = getFocusDesc(d.name);
        return '- ' + d.name + ' (' + d.count + ' msgs)' + (desc ? ': ' + desc : '');
      }).join('\\n') + '\\n\\n' +
      'You can execute visual actions by including them in your response as:\\n' +
      '[ACTION:{"fn":"functionName","args":["arg1"]}]\\n\\n' +
      'Available actions:\\n' +
      '- switchTheme(name): default, night, primavera, estate, ellenica, benessere\\n' +
      '- switchLayout(name): fibonacci, cluster, alpha\\n' +
      '- focusProject(name): focus on a specific project\\n' +
      '- unfocus(): return to browse mode\\n' +
      '- setParam(key, value): adjust visual parameters (fStop, maxBlur, pullFactor, etc.)\\n' +
      '- setCameraZ(z): move camera depth\\n\\n' +
      'Keep responses concise and evocative. You are part of the space, not outside it. ' +
      'Respond in the same language the user writes in. ' +
      'When suggesting projects, prefer using focusProject action rather than just naming them.';
  }

  // ── 3D MESSAGE RENDERING ──
  function addChat3DMessage(text, isUser) {
    var container = document.getElementById('focus-messages');
    if (!container) return null;

    var msgEl = document.createElement('div');
    msgEl.className = 'd3-chat-msg' + (isUser ? ' user' : ' assistant');
    var msgId = 'chat-msg-' + (++chatMsgCount);
    msgEl.id = msgId;

    // Stack messages vertically with slight Z progression
    var msgIndex = container.children.length;
    var yOff = msgIndex * 34;
    var zOff = -msgIndex * 5;
    msgEl.style.transform = 'translate3d(0px, ' + yOff + 'px, ' + zOff + 'px)';

    container.appendChild(msgEl);

    if (isUser) {
      msgEl.textContent = text;
      requestAnimationFrame(function() {
        requestAnimationFrame(function() {
          msgEl.classList.add('visible');
        });
      });
    }

    return msgId;
  }

  // ── ACTION EXECUTION ──
  var ACTION_RE = /\\[ACTION:(\\{[^\\]]+\\})\\]/g;

  function executeActions(text) {
    var match;
    ACTION_RE.lastIndex = 0;
    while ((match = ACTION_RE.exec(text)) !== null) {
      try {
        var action = JSON.parse(match[1]);
        var fn = action.fn;
        var args = action.args || [];
        if (fn === 'switchTheme' && typeof window.setTheme === 'function') {
          window.setTheme(args[0]);
        } else if (fn === 'switchLayout' && typeof window.switchLayout === 'function') {
          window.switchLayout(args[0]);
        } else if (fn === 'focusProject' && window.depthLab && window.depthLab.focusProject) {
          window.depthLab.focusProject(args[0]);
        } else if (fn === 'unfocus' && window.depthLab && window.depthLab.unfocus) {
          window.depthLab.unfocus();
        } else if (fn === 'setParam' && window.depthLab && window.depthLab.setParam) {
          window.depthLab.setParam(args[0], args[1]);
        } else if (fn === 'setCameraZ') {
          baseTarget.z = parseFloat(args[0]) || 0;
          startAnimate();
        }
      } catch(e) {
        console.error('[chat] action parse error:', e);
      }
    }
    // Return text without action tags
    ACTION_RE.lastIndex = 0;
    return text.replace(ACTION_RE, '').trim();
  }

  // ── SEND MESSAGE ──
  async function sendChatMessage(text) {
    assert(typeof text === 'string', 'sendChatMessage: text deve essere stringa');
    if (!text.trim() || chatStreaming) return;

    var apiKey = getApiKey();
    if (!apiKey) {
      showApiKeyOverlay();
      return;
    }

    chatStreaming = true;
    var input = document.getElementById('chat-input');
    if (input) { input.value = ''; input.disabled = true; }

    // User message → 3D
    addChat3DMessage(text, true);
    chatHistory.push({ role: 'user', content: text });

    // Assistant message placeholder → 3D
    var assistantMsgId = addChat3DMessage('', false);
    var assistantEl = document.getElementById(assistantMsgId);
    if (assistantEl) assistantEl.classList.add('visible');

    try {
      var response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true'
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 512,
          system: getChatSystemPrompt(),
          messages: chatHistory.slice(-10),
          stream: true
        })
      });

      if (!response.ok) {
        var errBody = await response.text();
        throw new Error('API ' + response.status + ': ' + errBody.substring(0, 200));
      }

      var reader = response.body.getReader();
      var decoder = new TextDecoder();
      var buffer = '';
      var fullText = '';

      while (true) {
        var chunk = await reader.read();
        if (chunk.done) break;

        buffer += decoder.decode(chunk.value, { stream: true });
        var lines = buffer.split('\\n');
        buffer = lines.pop() || '';

        for (var li = 0; li < lines.length; li++) {
          var line = lines[li].trim();
          if (!line.startsWith('data: ')) continue;
          var data = line.substring(6);
          if (data === '[DONE]') continue;

          try {
            var evt = JSON.parse(data);
            if (evt.type === 'content_block_delta' && evt.delta && evt.delta.text) {
              fullText += evt.delta.text;
              // Stream: update textContent (simple, no breathing)
              if (assistantEl) {
                ACTION_RE.lastIndex = 0;
                assistantEl.textContent = fullText.replace(ACTION_RE, '').trim();
              }
            }
          } catch(pe) { /* skip malformed SSE */ }
        }
      }

      // Finalize: execute actions, store history
      var displayText = executeActions(fullText);
      chatHistory.push({ role: 'assistant', content: fullText });

      // Final render with breathing
      if (assistantMsgId && displayText && typeof breathPour === 'function') {
        breathPour(assistantMsgId, displayText);
        // Re-trigger reveal since breathPour resets the element
        var finalEl = document.getElementById(assistantMsgId);
        if (finalEl) finalEl.classList.add('visible');
      }

    } catch(err) {
      console.error('[chat] error:', err);
      if (assistantEl) {
        assistantEl.textContent = err.message || 'Connection error';
        assistantEl.classList.add('error');
      }
      // Invalid key: clear and re-prompt
      if (err.message && (err.message.indexOf('401') >= 0 || err.message.indexOf('403') >= 0)) {
        localStorage.removeItem('depth-lab-api-key');
        setTimeout(showApiKeyOverlay, 500);
      }
    } finally {
      chatStreaming = false;
      if (input) { input.disabled = false; input.focus(); }
    }
  }

  // ── EVENT HANDLERS ──
  var chatInput = document.getElementById('chat-input');
  if (chatInput) {
    chatInput.addEventListener('keydown', function(e) {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        e.stopPropagation();
        sendChatMessage(chatInput.value);
      }
      // Stop propagation on all keys to prevent depth-lab shortcuts
      e.stopPropagation();
    });
  }

  // API key overlay
  var apiKeyInput = document.getElementById('api-key-input');
  var apiKeySave = document.getElementById('api-key-save');
  if (apiKeySave) {
    apiKeySave.addEventListener('click', function() {
      var key = apiKeyInput ? apiKeyInput.value.trim() : '';
      if (key) { setApiKey(key); hideApiKeyOverlay(); }
    });
  }
  if (apiKeyInput) {
    apiKeyInput.addEventListener('keydown', function(e) {
      e.stopPropagation();
      if (e.key === 'Enter') {
        var key = apiKeyInput.value.trim();
        if (key) { setApiKey(key); hideApiKeyOverlay(); }
      }
      if (e.key === 'Escape') { hideApiKeyOverlay(); }
    });
  }

  // ── DEPTHLAB API EXTENSIONS ──
  window.depthLab.sendChat = function(text) { sendChatMessage(text); };
  window.depthLab.getChatHistory = function() { return chatHistory.slice(); };`;
}
