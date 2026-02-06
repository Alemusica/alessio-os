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
var sttRestarts = 0;
var sttDelivered = false;
var sttForceTimer = null;
var sttLastResult = 0;

function sttCreateRecognizer() {
  var SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  var btn = document.getElementById('mic-btn');
  var prompt = document.getElementById('dz-prompt');

  var rec = new SpeechRecognition();
  rec.lang = 'it-IT';
  rec.continuous = true;
  rec.interimResults = true;

  rec.onstart = function() {
    speechActive = true;
    sttLastResult = Date.now();
    btn.classList.add('recording');
    btn.textContent = 'Stop';
    prompt.innerHTML = '<span style="color:var(--accent)">&#9679;</span> Ascolto...';
    // Force restart every 30s — prevents Chrome long-session degradation
    clearTimeout(sttForceTimer);
    sttForceTimer = setTimeout(sttForceRestart, 30000);
  };

  rec.onresult = function(event) {
    sttLastResult = Date.now();
    sttInterim = '';
    for (var i = event.resultIndex; i < event.results.length; i++) {
      if (event.results[i].isFinal) {
        sttFinal += event.results[i][0].transcript;
      } else {
        sttInterim += event.results[i][0].transcript;
      }
    }
    // Backup to localStorage — survives any edge case
    try { localStorage.setItem('stt-backup', sttFinal + sttInterim); } catch(x) {}
    var preview = sttFinal + sttInterim;
    if (preview) {
      var tail = preview.length > 120 ? '...' + esc(preview).slice(-117) : esc(preview);
      prompt.innerHTML = '<span style="color:var(--accent)">&#9679;</span> ' + tail;
    }
  };

  rec.onend = function() {
    clearTimeout(sttForceTimer);
    if (speechActive) {
      sttFinal += sttInterim;
      sttInterim = '';
      sttRestarts++;
      // Same-object restart primary, new instance fallback with delay
      try {
        speechRec.start();
      } catch(e) {
        setTimeout(function() {
          if (!speechActive) { sttDeliverResult(); return; }
          try {
            speechRec = sttCreateRecognizer();
            speechRec.start();
          } catch(e2) {
            sttDeliverResult();
          }
        }, 300);
      }
      return;
    }
    sttDeliverResult();
  };

  rec.onerror = function(event) {
    var fatal = event.error === 'audio-capture' ||
                event.error === 'not-allowed' ||
                event.error === 'service-not-allowed';
    if (fatal) {
      speechActive = false;
    }
  };

  return rec;
}

// Force restart — prevents Chrome silent degradation on long sessions
function sttForceRestart() {
  if (!speechActive || !speechRec) return;
  sttFinal += sttInterim;
  sttInterim = '';
  try { speechRec.stop(); } catch(e) {}
  // onend will handle the restart
}

function sttDeliverResult() {
  if (sttDelivered) return;
  sttDelivered = true;
  clearTimeout(sttForceTimer);

  var btn = document.getElementById('mic-btn');
  var prompt = document.getElementById('dz-prompt');
  speechActive = false;
  btn.classList.remove('recording');
  btn.textContent = 'Registra';
  prompt.textContent = '| Drop OCR/STT';

  var text = (sttFinal + sttInterim).trim();
  // Check localStorage backup — use whichever is longer
  try {
    var backup = (localStorage.getItem('stt-backup') || '').trim();
    if (backup.length > text.length) text = backup;
    localStorage.removeItem('stt-backup');
  } catch(x) {}

  if (text) {
    var input = document.querySelector('.cmd-input');
    input.value = text;
    resizeInput(input);
    input.focus();
    addLog('STT (' + sttRestarts + ' restart, ' + text.length + ' chars)', 'event');
  } else {
    addLog('STT: nessun testo riconosciuto', 'event');
  }
}

function toggleMic() {
  if (speechActive && speechRec) {
    speechActive = false;
    clearTimeout(sttForceTimer);
    try { speechRec.stop(); } catch(e) {}
    // Safety: deliver after 500ms if onend doesn't fire
    setTimeout(function() { sttDeliverResult(); }, 500);
    return;
  }

  var SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    addLog('Web Speech API non supportata — usa Chrome/Edge', 'error');
    return;
  }

  sttFinal = '';
  sttInterim = '';
  sttRestarts = 0;
  sttDelivered = false;
  sttLastResult = Date.now();
  try { localStorage.removeItem('stt-backup'); } catch(x) {}
  speechRec = sttCreateRecognizer();
  addLog('STT avviato', 'event');
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
