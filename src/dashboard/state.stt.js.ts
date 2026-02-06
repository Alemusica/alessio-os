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
    btn.classList.add('recording');
    btn.textContent = 'Stop';
    prompt.innerHTML = '<span style="color:var(--accent)">&#9679;</span> Ascolto...';
  };

  rec.onresult = function(event) {
    sttInterim = '';
    for (var i = event.resultIndex; i < event.results.length; i++) {
      if (event.results[i].isFinal) {
        sttFinal += event.results[i][0].transcript;
      } else {
        sttInterim += event.results[i][0].transcript;
      }
    }
    var preview = sttFinal + sttInterim;
    if (preview) {
      // Show TAIL of preview — for long recordings the start is stale
      var tail = preview.length > 120 ? '...' + esc(preview).slice(-117) : esc(preview);
      prompt.innerHTML = '<span style="color:var(--accent)">&#9679;</span> ' + tail;
    }
  };

  rec.onend = function() {
    if (speechActive) {
      // Promuovi interim a final PRIMA del restart
      sttFinal += sttInterim;
      sttInterim = '';
      sttRestarts++;
      // New instance every restart — Chrome degrades after many start/stop on same object
      try {
        speechRec = sttCreateRecognizer();
        speechRec.start();
      } catch(e) {
        addLog('STT restart fallito (#' + sttRestarts + '): ' + e, 'error');
        sttDeliverResult();
      }
      return;
    }
    sttDeliverResult();
  };

  rec.onerror = function(event) {
    // Fatal errors: stop auto-restart, deliver what we have
    var fatal = event.error === 'audio-capture' ||
                event.error === 'not-allowed' ||
                event.error === 'service-not-allowed';
    if (fatal) {
      speechActive = false;
      addLog('STT errore fatale: ' + event.error, 'error');
    }
    // Non-fatal (no-speech, aborted, network): onend will auto-restart
    if (event.error !== 'aborted' && event.error !== 'no-speech') {
      addLog('STT errore: ' + event.error, 'error');
    }
  };

  return rec;
}

function sttDeliverResult() {
  var btn = document.getElementById('mic-btn');
  var prompt = document.getElementById('dz-prompt');
  speechActive = false;
  btn.classList.remove('recording');
  btn.textContent = 'Registra';
  prompt.textContent = '| Drop OCR/STT';

  var text = (sttFinal + sttInterim).trim();
  if (text) {
    var input = document.querySelector('.cmd-input');
    input.value = text;
    resizeInput(input);
    input.focus();
    addLog('STT (' + sttRestarts + ' restarts): "' + text.slice(0, 80) + '..."', 'event');
  } else {
    addLog('STT: nessun testo riconosciuto', 'event');
  }
}

function toggleMic() {
  if (speechActive && speechRec) {
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
  sttRestarts = 0;
  speechRec = sttCreateRecognizer();
  addLog('STT avviato (Web Speech API)', 'event');
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
