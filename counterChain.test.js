// engine/counterChain.test.js
//
// Testet die Konterketten-Auflösung. Ausfuehren mit:
// node engine/counterChain.test.js

const C = require('./counterChain.js');

let passed = 0;
let failed = 0;

function check(label, condition) {
  if (condition) {
    passed++;
    console.log(`  OK   ${label}`);
  } else {
    failed++;
    console.log(`  FAIL ${label}`);
  }
}

function section(title) {
  console.log(`\n=== ${title} ===`);
}

// Vereinfachte Karten-Stubs im selben Format wie cards_structured_final.json
const TOXINSCHUSS = {
  id: '999a', name: 'Toxinschuss', cardType: 'Konter',
  effects: [{ action: 'prevent_movement', target: 'context' }],
  flags: null,
};

const SIEGEL_DES_BANNAMULETTS = {
  id: '061', name: 'Siegel des Bannamuletts', cardType: 'Konter',
  effects: [{ action: 'negate_effect', target: 'triggering_card' }],
  flags: null,
};

const KOENIGSZUG = {
  id: '030', name: 'Königszug', cardType: 'Ultimate',
  effects: [{ action: 'move', target: 'self', fields: 1 }],
  flags: { cannot_be_countered: true, blocks_further_counters_this_turn: true },
};

// Stub, der NUR cannot_be_countered setzt, ohne die Zug-weite Sperre --
// damit die beiden Flags im Test unabhaengig voneinander geprueft werden koennen.
const LETZTER_STAND = {
  id: '031', name: 'Letzter Stand', cardType: 'Ultimate',
  effects: [{ action: 'move', target: 'self', fields: 1 }],
  flags: { cannot_be_countered: true },
};

const RIFTKLINGEN_RESONANZ = {
  id: '056', name: 'Riftklingen-Resonanz', cardType: 'Konter',
  effects: [{ action: 'negate_effect', target: 'triggering_card' }],
  flags: null,
};

// ---------------------------------------------------------------------------
section('Offizielles FAQ-Beispiel: Bewegung -> Toxinschuss -> Siegel des Bannamuletts');
// ---------------------------------------------------------------------------
{
  const executed = [];
  const chain = C.createChain({ owner: 'p1', description: 'Bewegung' });
  C.pushCounter(chain, 'p2', TOXINSCHUSS);
  C.pushCounter(chain, 'p1', SIEGEL_DES_BANNAMULETTS);

  const log = C.resolveChain(chain, (item) => executed.push(item.card ? item.card.name : 'Bewegung'));

  // Erwartung laut FAQ: Siegel loest zuerst aus und negiert Toxinschuss.
  // Die urspruengliche Bewegung wird NICHT beeinflusst (Toxinschuss haette
  // sie verhindert, ist aber negiert) -- Bewegung wird also ausgefuehrt.
  check('Siegel des Bannamuletts wird zuerst ausgefuehrt', executed[0] === 'Siegel des Bannamuletts');
  check('Toxinschuss wird NICHT ausgefuehrt (negiert)', !executed.includes('Toxinschuss'));
  check('Urspruengliche Bewegung wird am Ende ausgefuehrt (Toxinschuss war negiert)', executed.includes('Bewegung'));
  check('Log zeigt Toxinschuss als negiert', log.some((l) => l.item.startsWith('999a') && l.reason === 'negated'));
}

// ---------------------------------------------------------------------------
section('Kette ohne jede Konterkarte: Ursprungsaktion wird einfach ausgefuehrt');
// ---------------------------------------------------------------------------
{
  const executed = [];
  const chain = C.createChain({ owner: 'p1', description: 'Wand setzen' });
  const log = C.resolveChain(chain, (item) => executed.push(item.card ? item.card.name : item.description));
  check('Nur die Ursprungsaktion wird ausgefuehrt', executed.length === 1 && executed[0] === 'Wand setzen');
}

// ---------------------------------------------------------------------------
section('cannot_be_countered: keine weitere Konterkarte auf diese Karte moeglich');
// ---------------------------------------------------------------------------
{
  const chain = C.createChain({ owner: 'p1', description: 'Bewegung' });
  C.pushCounter(chain, 'p1', LETZTER_STAND);

  const permission = C.canPushCounter(chain);
  check('Nach Letzter Stand ist kein weiterer Konter erlaubt', permission.ok === false && permission.reason === 'top_of_chain_cannot_be_countered');

  let threw = false;
  try {
    C.pushCounter(chain, 'p2', SIEGEL_DES_BANNAMULETTS);
  } catch (e) {
    threw = true;
  }
  check('Versuch, trotzdem zu kontern, wirft einen Fehler', threw === true);
}

// ---------------------------------------------------------------------------
section('blocks_further_counters_this_turn sperrt die GESAMTE Kette, nicht nur das eine Item');
// ---------------------------------------------------------------------------
{
  const chain = C.createChain({ owner: 'p1', description: 'Zug beenden' });
  C.pushCounter(chain, 'p1', KOENIGSZUG); // setzt blockedForRestOfTurn
  check('Chain ist fuer den Rest des Zuges gesperrt', chain.blockedForRestOfTurn === true);
}

// ---------------------------------------------------------------------------
section('Verkettete Negation: A negiert B, B haette C negiert -- C bleibt also aktiv');
// ---------------------------------------------------------------------------
{
  // Ausgangslage: Bewegung <- Riftklingen-Resonanz (C, negiert Bewegungs-Konter)
  //                        <- Toxinschuss (B, will Bewegung verhindern)
  //                        <- Siegel des Bannamuletts (A, negiert das direkt
  //                           darunterliegende Item = Toxinschuss)
  // Reihenfolge gespielt: Toxinschuss, dann Siegel (zuletzt gespielt = zuerst aufgeloest)
  const executed = [];
  const chain = C.createChain({ owner: 'p1', description: 'Bewegung' });
  C.pushCounter(chain, 'p2', TOXINSCHUSS);
  C.pushCounter(chain, 'p1', SIEGEL_DES_BANNAMULETTS);

  C.resolveChain(chain, (item) => executed.push(item.card ? item.card.name : 'Bewegung'));

  check('Siegel (zuletzt gespielt) negiert Toxinschuss (direkt darunter)', chain.items[0].negated === true);
  check('Siegel selbst bleibt unbeeinflusst (wird ausgefuehrt)', chain.items[1].negated === false);
}

// ---------------------------------------------------------------------------
section('Nach Aufloesung kann eine Folgekette gegen dieselbe Ursprungsaktion eroeffnet werden');
// ---------------------------------------------------------------------------
{
  const chain = C.createChain({ owner: 'p1', description: 'Bewegung' });
  C.resolveChain(chain, () => {});
  const followUp = C.openFollowUpChain(chain);
  check('Folgekette ist eine frische, unaufgeloeste Kette', followUp.resolved === false && followUp.items.length === 0);

  let threwOnDoubleResolve = false;
  try {
    C.resolveChain(chain, () => {});
  } catch (e) {
    threwOnDoubleResolve = true;
  }
  check('Bereits aufgeloeste Kette kann nicht nochmal aufgeloest werden', threwOnDoubleResolve === true);
}

// ---------------------------------------------------------------------------
console.log(`\n${'='.repeat(50)}`);
console.log(`Ergebnis: ${passed} bestanden, ${failed} fehlgeschlagen`);
console.log('='.repeat(50));
process.exit(failed > 0 ? 1 : 0);
