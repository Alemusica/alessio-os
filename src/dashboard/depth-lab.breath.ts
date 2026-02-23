/**
 * Depth Lab — Tessuto: Breathing Text
 *
 * PTI livello: tessuto
 * Ruolo: renderer testo con ritmo recitativo (phonon-ui concepts, vanilla JS).
 *        Parole appaiono con delay pesato per sillabe e punteggiatura.
 *
 * Principio: il testo è nel DOM intero (zero reflow) ma le parole sono
 * inizialmente invisibili. Ogni parola ha un transition-delay calcolato
 * dal contatore sillabico. La rivelazione è una wave di opacity + translateY.
 *
 * Dipende da: PHI (golden ratio constant)
 */

export function depthLabBreathJS(): string {
  return `
  // ═══════════════════════════════════════════
  // TESSUTO: BREATHING TEXT
  // ═══════════════════════════════════════════

  var BREATH_BASE_DELAY = 60; // ms per word

  // ── SYLLABLE COUNTER ──
  // English heuristic: count vowel groups, handle silent-e
  function countSyllables(word) {
    word = word.toLowerCase().replace(/[^a-z]/g, '');
    if (!word) return 1;
    var count = 0;
    var vowels = /[aeiouy]/;
    var prev = false;
    for (var i = 0; i < word.length; i++) {
      var isV = vowels.test(word[i]);
      if (isV && !prev) count++;
      prev = isV;
    }
    // Silent e at end
    if (word.length > 2 && word[word.length - 1] === 'e' &&
        !/[aeiouy]/.test(word[word.length - 2])) {
      count = Math.max(1, count - 1);
    }
    return Math.max(1, count);
  }

  // ── BREATH POUR — full text with syllable-weighted delays ──
  // Text appears entire in DOM (opacity: 0), then reveals word-by-word
  // with transition-delay based on cumulative syllable weight.
  function breathPour(elementId, text) {
    var el = document.getElementById(elementId);
    if (!el || !text) return;

    var words = text.split(/\\s+/);
    var html = '';
    var cumDelay = 0;

    for (var i = 0; i < words.length; i++) {
      var word = words[i];
      if (!word) continue;
      var syllables = countSyllables(word);
      var syllableScale = Math.pow(PHI, (syllables - 1) * 0.4);

      // Punctuation pauses: sentence-end ×2.5, clause-break ×1.5
      var punctScale = 1;
      if (/[.!?]$/.test(word)) punctScale = 2.5;
      else if (/[,;:]$/.test(word)) punctScale = 1.5;

      var delay = BREATH_BASE_DELAY * syllableScale * punctScale;
      html += '<span class="d3-breath-word" style="transition-delay:' + cumDelay.toFixed(0) + 'ms">' + word + '</span> ';
      cumDelay += delay;
    }

    el.innerHTML = html;

    // Double-rAF: first frame paints initial state (opacity 0),
    // second frame triggers transitions via .revealed class
    requestAnimationFrame(function() {
      requestAnimationFrame(function() {
        var spans = el.querySelectorAll('.d3-breath-word');
        for (var s = 0; s < spans.length; s++) {
          spans[s].classList.add('revealed');
        }
      });
    });

    return cumDelay; // total animation duration
  }`;
}
