/**
 * State STT — Speech-to-Text (Web Speech API) + File Upload (OCR/STT)
 * toggleMic, handleFiles, uploadOCR, uploadSTT
 */

export const stateSttJs = `
// ── STT: Web Speech API (instant, zero latency) ──
// Generation counter: ogni sessione STT ha un epoch unico.
// Tutti i callback e timer verificano il proprio epoch contro sttGen.
// Se non corrispondono → evento stale → ignorato silenziosamente.
// Risolve: timer stale che chiudono la sessione successiva,
//          onend/onresult del vecchio recognizer che corrompono lo stato.
var speechRec = null;
var speechActive = false;
var sttFinal = '';
var sttInterim = '';
var sttRestarts = 0;
var sttDelivered = false;
var sttForceTimer = null;
var sttSafetyTimer = null;
var sttLastResult = 0;
var sttGen = 0;

function sttCreateRecognizer(myGen) {
  var SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  var btn = document.getElementById('mic-btn');
  var prompt = document.getElementById('dz-prompt');

  var rec = new SpeechRecognition();
  rec.lang = 'it-IT';
  rec.continuous = true;
  rec.interimResults = true;

  rec.onstart = function() {
    if (myGen !== sttGen) return;
    speechActive = true;
    sttLastResult = Date.now();
    btn.classList.add('recording');
    btn.textContent = 'Stop';
    prompt.innerHTML = '<span style="color:var(--accent)">&#9679;</span> Ascolto...';
    clearTimeout(sttForceTimer);
    sttForceTimer = setTimeout(function() { sttForceRestart(myGen); }, 30000);
  };

  rec.onresult = function(event) {
    if (myGen !== sttGen) return;
    sttLastResult = Date.now();
    sttInterim = '';
    for (var i = event.resultIndex; i < event.results.length; i++) {
      if (event.results[i].isFinal) {
        sttFinal += event.results[i][0].transcript;
      } else {
        sttInterim += event.results[i][0].transcript;
      }
    }
    try { localStorage.setItem('stt-backup-' + myGen, sttFinal + sttInterim); } catch(x) {}
    var preview = sttFinal + sttInterim;
    if (preview) {
      var tail = preview.length > 120 ? '...' + esc(preview).slice(-117) : esc(preview);
      prompt.innerHTML = '<span style="color:var(--accent)">&#9679;</span> ' + tail;
    }
  };

  rec.onend = function() {
    if (myGen !== sttGen) return;
    clearTimeout(sttForceTimer);
    if (speechActive) {
      sttFinal += sttInterim;
      sttInterim = '';
      sttRestarts++;
      try {
        speechRec.start();
      } catch(e) {
        setTimeout(function() {
          if (myGen !== sttGen) return;
          if (!speechActive) { sttDeliverResult(myGen); return; }
          try {
            speechRec = sttCreateRecognizer(myGen);
            speechRec.start();
          } catch(e2) {
            sttDeliverResult(myGen);
          }
        }, 300);
      }
      return;
    }
    sttDeliverResult(myGen);
  };

  rec.onerror = function(event) {
    if (myGen !== sttGen) return;
    var fatal = event.error === 'audio-capture' ||
                event.error === 'not-allowed' ||
                event.error === 'service-not-allowed';
    if (fatal) {
      speechActive = false;
    }
  };

  return rec;
}

function sttForceRestart(myGen) {
  if (myGen !== sttGen) return;
  if (!speechActive || !speechRec) return;
  sttFinal += sttInterim;
  sttInterim = '';
  try { speechRec.stop(); } catch(e) {}
}

function sttDeliverResult(myGen) {
  if (myGen !== sttGen) return;
  if (sttDelivered) return;
  sttDelivered = true;
  clearTimeout(sttForceTimer);
  clearTimeout(sttSafetyTimer);

  var btn = document.getElementById('mic-btn');
  var prompt = document.getElementById('dz-prompt');
  speechActive = false;
  btn.classList.remove('recording');
  btn.textContent = 'Registra';
  prompt.textContent = '| Drop OCR/STT';

  var text = (sttFinal + sttInterim).trim();
  try {
    var backup = (localStorage.getItem('stt-backup-' + myGen) || '').trim();
    if (backup.length > text.length) text = backup;
    localStorage.removeItem('stt-backup-' + myGen);
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
    // Null out old recognizer's handlers to prevent ghost events
    try { speechRec.onend = null; speechRec.onresult = null; speechRec.onerror = null; } catch(x) {}
    try { speechRec.stop(); } catch(e) {}
    var stopGen = sttGen;
    sttSafetyTimer = setTimeout(function() { sttDeliverResult(stopGen); }, 500);
    return;
  }

  var SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    addLog('Web Speech API non supportata — usa Chrome/Edge', 'error');
    return;
  }

  // New session: invalidate ALL stale callbacks/timers
  sttGen++;
  clearTimeout(sttForceTimer);
  clearTimeout(sttSafetyTimer);
  sttFinal = '';
  sttInterim = '';
  sttRestarts = 0;
  sttDelivered = false;
  sttLastResult = Date.now();
  try { localStorage.removeItem('stt-backup-' + (sttGen - 1)); } catch(x) {}
  speechRec = sttCreateRecognizer(sttGen);
  addLog('STT avviato (gen ' + sttGen + ')', 'event');
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
