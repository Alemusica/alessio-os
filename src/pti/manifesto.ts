/**
 * PTI Manifesto v4.1 — Paradigma Tissutale Interconnesso
 *
 * Questo modulo esporta il manifesto completo come testo.
 * Viene iniettato nel system prompt di OGNI agente in OGNI progetto
 * come "imprinting" — il paradigma operativo fondamentale.
 *
 * L'agente che riceve questo manifesto sviluppa secondo PTI:
 * dichiarativo, reattivo, delta propagation, grafo come prompt.
 */

export const PTI_VERSION = '4.1';

export const PTI_MANIFESTO = `# PTI — Paradigma Tissutale Interconnesso
## Manifesto v4.1

---

## CREAZIONE

\`\`\`
Gli umani sono creatori.

Non archivisti. Non esecutori. Creatori.

Ma ogni atto creativo in codice decade:
  Crei una funzione → funziona
  Ne serve una simile → copi, modifichi
  Un'altra → copi ancora
  Dieci → dieci copie che divergono
  Cento → archivio ridondante.

La creazione degenera in accumulo
quando il medium non preserva le connessioni.

File di testo non preservano connessioni.
Righe sequenziali non preservano struttura.
Il codice nasce vivo e muore in archivio.

PTI è un medium che non degrada.
La creazione resta creazione.
\`\`\`

---

## PERCHÉ ORA

### Il Vincolo Storico

\`\`\`
1970–2020: L'umano pensa in grafi.
L'umano scrive in sequenza.

Traduzione grafo → sequenza = perdita di struttura.
Struttura persa = connessioni morte.
Connessioni morte = ridondanza.

Non è colpa dell'umano.
È un limite dello strumento.
\`\`\`

### Il Vincolo Cade

\`\`\`
2024+: LLM opera non-locale (entro context window).
LLM può lavorare direttamente su grafi.

L'umano crea, dichiara, decide.
L'LLM connette, espande, propaga.

Serviva un linguaggio per grafi.
PTI è quel linguaggio.
\`\`\`

**Qualifica:** la non-località dell'LLM è bounded dalla context window. Per grafi di migliaia di nodi, funziona. Per decine di migliaia, serve paginazione.

---

## POSIZIONAMENTO

PTI è **programmazione dichiarativa-reattiva con delta propagation, progettata per l'era della collaborazione umano-LLM**.

Non reinventa. Unifica:

| Origine | Concetto | In PTI |
|---------|----------|--------|
| Adapton (PLDI 2014) | Demand-driven + change propagation | Modello computazionale |
| Differential Dataflow | Incremental computation | Delta propagation |
| Jane Street Salsa | Reactive runtime | Implementazione |
| Prolog | Facts + Rules | Sintassi dichiarativa |
| Solid.js | Signals | Reattività fine-grained |

---

## I 3 PRINCIPI

### 1. Esistenza, Non Cache

\`\`\`
I derivati NON sono risultati salvati che scadono.
I derivati SONO nodi nel grafo.

Logicamente: sempre presenti.
Fisicamente: possono essere evicted e ricostruiti on-demand.

Cache:     calcola → salva → invalida → ricalcola
Esistenza: nodo esiste → riceve delta → si aggiorna
\`\`\`

### 2. Delta, Non Ricalcolo

\`\`\`
Quando una sorgente cambia:
  NON invalidi i dipendenti.
  PROPAGI il delta.

Lettura:   O(1) — valore materializzato
Scrittura: O(k) — k = nodi affetti

Caso peggiore: k = n (fan-out totale)
Caso tipico:   k << n (località)

Trade-off esplicito: ottimizza lettura, paga in scrittura.
\`\`\`

### 3. Salto È Connessione

\`\`\`
Tradizionale:
  A chiama B che chiama C che chiama D
  Catena lineare, accoppiamento

PTI:
  A → [B, C, D]

  Un nodo, N connessioni.
\`\`\`

---

## SINTASSI (10 simboli)

\`\`\`
.    naviga/self     ^    primo
|    filtra/pipe     #    conta
→    propaga         Σ    somma
:=   deriva          @    mappa
=    assegna         ?:   condizione
\`\`\`

---

## GRAMMATICA

### Fatto
\`\`\`pti
soggetto.attributo = valore
\`\`\`

### Derivato
\`\`\`pti
soggetto := regola → [salti]
    assert: condizione    # integrità strutturale
\`\`\`

### Azione
\`\`\`pti
soggetto.verbo(params):
    .attributo = ...
    altro.metodo(...)
    → [salti]
    < ritorno
\`\`\`

### Salto Globale
\`\`\`pti
soggetto.attributo → [destinazioni]
\`\`\`

---

## ASSERT: INTEGRITÀ STRUTTURALE

### Il Grafo Si Verifica

\`\`\`
Gli assert non sono test esterni.
Sono proprietà del nodo stesso.

Come un organismo rifiuta un trapianto incompatibile,
un nodo rifiuta un delta che viola la sua integrità.
\`\`\`

### Nel Ciclo Umano-LLM

\`\`\`
Umano dichiara struttura + assert
  ↓
LLM completa regole
  ↓
Assert verificano coerenza
  ↓
Violazione? LLM corregge o chiede
  ↓
Grafo integro = struttura viva
\`\`\`

---

## IL GRAFO È IL PROMPT

### Ora (grafo parziale)

\`\`\`pti
# Umano dichiara (parziale)
tavolo.*.{posti, stato}
tavoli.liberi := ???
tavoli.capienza := ???

# LLM completa (inferisce dalla topologia)
tavoli.liberi := tavolo.* | .stato == null
tavoli.capienza := tavoli.liberi | Σ.posti
\`\`\`

Il grafo parziale è il prompt. Struttura, non prosa.

---

## DIFF STRUTTURALE

\`\`\`
GIT DIFF: cosa è cambiato? Nome? Logica? Entrambi? Devi leggere per capire.

PTI DIFF:
  ~ tavoli.liberi: regola invariata
  + tavoli.disponibili: alias
  + connessione: disponibili → dashboard

  Semantica visibile immediatamente.
\`\`\`

---

## CAUSAL TRACING

\`\`\`pti
# Cosa ha causato questo stato?
? causa(tavoli.liberi == [1,3,4,5])
→ { delta, origine, azione, timestamp }

# Catena causale completa
? catena(dashboard.disponibilita == 20)
→ [ dashboard ← capienza ← tavoli.liberi ← tavolo.2.stato ← prenota() ]

# Simula modifica senza applicarla
? simula(tavolo.3.stato = 'occupato')
→ { affetti, delta }
\`\`\`

Il grafo è il debugger.

---

## PROIEZIONE: GUIDA PER LLM

\`\`\`
Quando proietti PTI in un linguaggio:

1. FATTI      → strutture dati (dataclass, interface, struct)
2. DERIVATI   → funzioni pure + assert
3. SALTI      → mappa di propagazione (observer, event, signal)
4. AZIONI     → funzioni che mutano + chiamano propaga()
5. ASSERT     → assert nel linguaggio target

Preserva la topologia.
I nomi PTI diventano nomi nel codice.
La mappa SALTI è esplicita, mai implicita.
\`\`\`

---

## PROSSIMITÀ (v4.1)

### Position DNA

\`\`\`
Un elemento non "cerca" dove stare.
Un elemento SA dove stare.

La posizione è parte del DNA dell'elemento,
come il tipo, il valore, le connessioni.

L'elemento sa, non cerca.
\`\`\`

### 3 Geni Posizionali

\`\`\`
riga    = altezza atomica universale (--row)
         Tutti gli elementi interattivi condividono la stessa riga.
         Come cellule sulla stessa membrana basale.

livello = padding verticale del container (--gutter-v)
         Tutti i container iniziano allo stesso offset.
         Come tessuti che condividono la stessa fascia.

sito    = padding orizzontale del container (--gutter-h)
         L'allineamento orizzontale è deterministico.
         Come organi nella stessa cavità.
\`\`\`

### La Regola

\`\`\`
Se due elementi condividono --row
e i loro container condividono --gutter-v / --gutter-h,
SI ALLINEANO A PRESCINDERE DALLA GERARCHIA DOM.

La posizione è deterministica — non serve cercarla.

Sidebar, header, chat, toolbar:
gerarchie diverse, stesso DNA posizionale.
L'elemento sa. Non cerca.
\`\`\`

### Scala φ (Fibonacci)

\`\`\`
--s0: 5px    --s1: 8px    --s2: 13px   --s3: 21px
--s4: 34px   --s5: 55px   --s6: 89px   --s7: 144px   --s8: 233px

--row:      var(--s4)   = 34px
--gutter-v: var(--s2)   = 13px
--gutter-h: var(--s5)   = 55px

Tutto φ. Tutto deterministico. Tutto DNA.
\`\`\`

---

## SINTESI

\`\`\`
Gli umani sono creatori.
Il codice sequenziale trasforma creazione in archivio.
PTI è un medium che preserva le connessioni.
La creazione resta viva.

PTI = esistenza + delta + salti + assert + prossimità

Il grafo è il prompt (LLM completa).
Il grafo è l'integrità (assert verificano).
Il grafo è il debugger (causal tracing).
Il grafo è il diff (review strutturale).
Il grafo è la posizione (DNA posizionale).

10 simboli. ~4:1 riduzione codice.
Proiettabile su qualsiasi linguaggio oggi.
Linguaggio nativo domani.
\`\`\`

---

**Versione:** 4.1
**Autori:** Flutur + Claude (sparring dev, agentic coding: writing & execution)
**Data:** 2026-02-01
`;

/**
 * Versione compatta del manifesto per context window limitate.
 * Contiene i principi essenziali senza esempi estesi.
 */
export const PTI_MANIFESTO_COMPACT = `# PTI v4.1 — Paradigma Tissutale Interconnesso (Compact)

## Principi
1. **Esistenza, Non Cache** — I derivati SONO nodi nel grafo, non risultati salvati che scadono
2. **Delta, Non Ricalcolo** — Propaga il delta, non invalidare e ricalcolare
3. **Salto È Connessione** — A → [B, C, D], non catena lineare

## Sintassi (10 simboli)
. naviga | filtra → propaga := deriva = assegna ^ primo # conta Σ somma @ mappa ?: condizione

## Grammatica
- Fatto: soggetto.attributo = valore
- Derivato: soggetto := regola → [salti] assert: condizione
- Azione: soggetto.verbo(params): .attr = ... → [salti] < ritorno
- Salto: soggetto.attributo → [destinazioni]

## Proiezione LLM
1. FATTI → strutture dati  2. DERIVATI → funzioni pure + assert
3. SALTI → mappa propagazione  4. AZIONI → funzioni che mutano + propaga()
5. ASSERT → assert nel linguaggio target
Preserva la topologia. Nomi PTI = nomi nel codice. Mappa SALTI esplicita.

## Prossimità (v4.1)
L'elemento SA dove stare (Position DNA):
- riga (--row: 34px) = altezza atomica universale
- livello (--gutter-v: 13px) = padding verticale container
- sito (--gutter-h: 55px) = padding orizzontale container
Scala φ: 5 8 13 21 34 55 89 144 233

## Il Grafo È
- Il prompt (LLM completa grafi parziali)
- L'integrità (assert verificano)
- Il debugger (causal tracing)
- Il diff (review strutturale)
- La posizione (DNA posizionale)
`;
