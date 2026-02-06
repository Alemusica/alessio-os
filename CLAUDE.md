# alessio-os — Coding Standards (PTI v4.2)

## Leggi prima di scrivere codice

Manifesto PTI: `/Users/alessioivoycazzaniga/TIC/pti-manifesto-v4.1.md` (v4.2)
Se non l'hai letto in questa sessione, leggilo. Non chiedere spiegazioni.

---

## Architettura

Concatenazione server-side. Tutti i JS tissues in un unico `<script>` globale.
Nessun module bundler. Nessun import/export a runtime.
Ordine di concatenazione (server.ts ~linea 498): determina disponibilità funzioni.

```
ptiUtilsJs → aosJs → terminalJs → stateCore → stateNav → stateRender
→ stateStt → stateChat → stateTimeline → stateGithub → stateAgents → graphJs
```

## File naming

`{feature}.{concern}.js.ts` — ogni file esporta `const xxxJs = \`...\``
- `.js.ts` = tissue JavaScript (esportato come stringa template)
- `.css.ts` = tissue CSS
- `.html.ts` = tissue HTML template

## PTI Proiezione — Come scrivere codice qui

### FATTI → strutture dati
```javascript
const S = { view: 'chat', project: null, session: null, projects: [], logCount: 0 };
```

### DERIVATI → funzioni pure + assert
```javascript
function tavoliLiberi(tavoli) {
  assert(Array.isArray(tavoli), 'tavoliLiberi: tavoli deve essere array');
  return tavoli.filter(function(t) { return t.stato === null; });
}
```

### SALTI → mappa di propagazione ESPLICITA
```javascript
registraSalto('S.project', renderSidebarProjects);
registraSalto('S.project', updateBreadcrumb);
registraSalto('S.session', function(s) { if (s) loadMessages(S.project, s); });
```

### AZIONI → mutano stato + chiamano propaga()
```javascript
function cambiaProgetto(name) {
  assert(typeof name === 'string', 'cambiaProgetto: name deve essere stringa');
  S.project = name;
  S.session = null;
  propaga('S.project', name);
}
```

### ASSERT → guardie strutturali, non-throwing
```javascript
assert(condition, 'messaggio');  // log + console.error, non throw
```

## Regole operative

1. **renderList()** esiste in pti-utils.js.ts. USALO per ogni rendering di lista.
   `renderList('element-id', items, templateFn, 'Messaggio vuoto')`
   Mai `el.innerHTML = items.map(...).join('')` a mano.

2. **SALTI espliciti.** Ogni tissue dichiara i suoi salti via `registraSalto()`.
   Mai chiamate implicite tra tissues senza dichiarazione.

3. **Zero duplicazione.** Se un pattern esiste già, componi. Non copiare.
   `ρ < 0.1` è il target. Se duplichi, giustifica.

4. **assert su ogni azione.** Ogni funzione che muta stato inizia con assert sui parametri.

5. **Naming naturale.** I nomi descrivono cosa fanno, leggibili come frasi.

## CSS — Fibonacci scale

```
--s0: 5px   --s1: 8px   --s2: 13px  --s3: 21px
--s4: 34px  --s5: 55px  --s6: 89px  --s7: 144px  --s8: 233px
```

Font sizes: solo valori Fibonacci. `--fs-xs: 8px, --fs-sm: 13px, --fs-body: 13px, --fs-lg: 21px`
Row height: `--row: 34px`. Gutter: `--gutter-v: 13px, --gutter-h: 55px`.

## Atomi disponibili (pti-utils.js.ts)

```
apiCall(url, opts)              — fetch JSON + error handling
scrollToBottom(elementId, delay) — scroll to bottom
emptyState(msg)                 — placeholder HTML
renderList(id, items, fn, msg)  — lista → HTML con fallback
togglePanel(elementId, cls)     — toggle class
store.save(key, data)           — localStorage save
store.load(key)                 — localStorage load
showEl(id, visible)             — show/hide
setActive(selector, matchId)    — toggle active class
fmtTime(date, mode)             — formato timestamp it-IT
onClickAll(selector, handler)   — click handler batch
fieldVal(id) / setField(id, v)  — form helpers
parseSSE(e, fallback)           — parse SSE event
assert(cond, msg)               — guardia PTI (non-throwing)
registraSalto(nodo, fn)         — registra propagazione
propaga(nodo, delta)            — dispatch delta → SALTI
```
