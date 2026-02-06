/**
 * State STT — Speech-to-Text (Web Speech API) + File Upload (OCR/STT)
 * toggleMic, handleFiles, uploadOCR, uploadSTT
 */

export const stateSttJs = `
// ── STT: Web Speech API (instant, zero latency) ──
var speechRec = null;
var speechActive = false;
var sttFinal = '';
var sttInterim = '';

function toggleMic() {
  var btn = document.getElementById('mic-btn');
  var prompt = document.getElementById('dz-prompt');

  if (speechActive && speechRec) {
    // Mark inactive BEFORE stop so onend knows user explicitly stopped
    speechActive = false;
    speechRec.stop();
    return;
  }

  var SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    addLog('Web Speech API non supportata — usa Chrome/Edge', 'error');
    return;
  }

  sttFinal = '';
  sttInterim = '';
  speechRec = new SpeechRecognition();
  speechRec.lang = 'it-IT';
  speechRec.continuous = true;
  speechRec.interimResults = true;

  speechRec.onstart = function() {
    speechActive = true;
    btn.classList.add('recording');
    btn.textContent = 'Stop';
    prompt.innerHTML = '<span style="color:var(--accent)">&#9679;</span> Ascolto...';
    addLog('STT avviato (Web Speech API)', 'event');
  };

  speechRec.onresult = function(event) {
    sttInterim = '';
    for (var i = event.resultIndex; i < event.results.length; i++) {
      if (event.results[i].isFinal) {
        sttFinal += event.results[i][0].transcript;
      } else {
        sttInterim += event.results[i][0].transcript;
      }
    }
    // Show live preview
    var preview = sttFinal + sttInterim;
    if (preview) {
      prompt.innerHTML = '<span style="color:var(--accent)">&#9679;</span> ' + esc(preview).slice(0, 120);
    }
  };

  speechRec.onend = function() {
    // Web Speech API auto-stops after silence even with continuous=true.
    // If user hasn't explicitly stopped (speechActive still true), auto-restart.
    if (speechActive) {
      // Promuovi interim a final PRIMA del restart — la nuova sessione resetta sttInterim
      sttFinal += sttInterim;
      sttInterim = '';
      try { speechRec.start(); } catch(e) { /* already running */ }
      return;
    }

    btn.classList.remove('recording');
    btn.textContent = 'Registra';
    prompt.textContent = '| Drop OCR/STT';

    // Concatena final + interim — stop() non garantisce isFinal per l'ultimo chunk
    var text = (sttFinal + sttInterim).trim();
    if (text) {
      var input = document.querySelector('.cmd-input');
      input.value = text;
      resizeInput(input);
      input.focus();
      addLog('STT: "' + text.slice(0, 80) + '"', 'event');
    } else {
      addLog('STT: nessun testo riconosciuto', 'event');
    }
  };

  speechRec.onerror = function(event) {
    speechActive = false;
    btn.classList.remove('recording');
    btn.textContent = 'Registra';
    prompt.textContent = '| Drop OCR/STT';
    if (event.error !== 'aborted') {
      addLog('STT errore: ' + event.error, 'error');
    }
  };

  speechRec.start();
}

// ── FILE UPLOAD (OCR/STT) ──

async function handleFiles(files) {
  assert(files && files.length, 'handleFiles: files richiesto');
  const images = files.filter(f => f.type.startsWith('image/'));
  const audio = files.filter(f => f.type.startsWith('audio/'));
  if (images.length > 0) await uploadOCR(images);
  if (audio.length > 0) await uploadSTT(audio);
}

async function uploadOCR(files) {
  assert(files && files.length, 'uploadOCR: files richiesto');
  const prompt = document.getElementById('dz-prompt');
  prompt.innerHTML = '<span class="loading-spinner"></span> OCR in corso...';
  addLog('OCR: ' + files.map(f => f.name).join(', '), 'agent-name');

  const fd = new FormData();
  files.forEach(f => fd.append('files', f));

  try {
    const res = await fetch('/api/ocr', { method: 'POST', body: fd });
    const results = await res.json();
    results.forEach(r => {
      if (r.error) {
        appendChatBubble('assistant', '**OCR Error:** ' + (r.file || '?') + '\\n' + r.error);
        addLog('OCR errore: ' + r.error, 'error');
      } else {
        var conf = r.confidence ? ' (' + (r.confidence * 100).toFixed(1) + '%)' : '';
        appendChatBubble('assistant', '**OCR: ' + (r.file || '') + conf + '**\\n' + (r.text || ''));
        addLog('OCR completato: ' + (r.file || ''), 'event');
      }
    });
  } catch (err) {
    appendChatBubble('assistant', '**OCR Error:** ' + String(err));
    addLog('OCR fallito: ' + err, 'error');
  }
  prompt.textContent = '| Drop OCR/STT';
}

async function uploadSTT(files) {
  assert(files && files.length, 'uploadSTT: files richiesto');
  const prompt = document.getElementById('dz-prompt');
  prompt.innerHTML = '<span class="loading-spinner"></span> Trascrizione in corso...';
  addLog('STT: ' + files.map(f => f.name).join(', '), 'agent-name');

  const fd = new FormData();
  files.forEach(f => fd.append('files', f));

  try {
    const res = await fetch('/api/transcribe', { method: 'POST', body: fd });
    const result = await res.json();
    if (result.error) {
      appendChatBubble('assistant', '**STT Error:** ' + (result.file || '?') + '\\n' + result.error);
      addLog('STT errore: ' + result.error, 'error');
    } else {
      appendChatBubble('assistant', '**Trascrizione: ' + (result.file || '') + '**\\n' + (result.text || ''));
      addLog('STT completato: ' + (result.file || ''), 'event');
    }
  } catch (err) {
    appendChatBubble('assistant', '**STT Error:** ' + String(err));
    addLog('STT fallito: ' + err, 'error');
  }
  prompt.textContent = '| Drop OCR/STT';
}
`;
