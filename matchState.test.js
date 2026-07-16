// engine/matchState.test.js
//
// Integrationstest: spielt eine realistische Sequenz durch und prueft, dass
// Bewegung, Waende, Schnappen, Konterketten und Zugwechsel korrekt
// zusammenspielen. Ausfuehren mit: node engine/matchState.test.js

const M = require('./matchState.js');
const Board = require('./board.js');

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

function coord(label) {
  return Board.parseCoord(Board.STANDARD_1V1_BOARD, label);
}

// ---------------------------------------------------------------------------
section('Match-Setup');
// ---------------------------------------------------------------------------
let state = M.createMatch1v1({
  matchId: 'test_match_1',
  player1: { id: 'alice', heroCardId: '002', deck: Array.from({ length: 20 }, (_, i) => `card_${i}`) },
  player2: { id: 'bob', heroCardId: '001', deck: Array.from({ length: 20 }, (_, i) => `card_${i + 100}`) },
});

check('Spieler 1 startet auf D1', state.figures.find((f) => f.owner === 'alice').x === coord('D1').x);
check('Spieler 2 startet auf E8', state.figures.find((f) => f.owner === 'bob').y === coord('E8').y);
check('Beide Spieler starten mit 10 Waenden', state.players.alice.wallsRemaining === 10 && state.players.bob.wallsRemaining === 10);

M.dealStartingHands(state, 2);
check('Beide Spieler haben 2 Startkarten', state.players.alice.hand.length === 2 && state.players.bob.hand.length === 2);

state.status = 'active'; // Setup abgeschlossen (Wandsetzen wird hier fuer den Test uebersprungen)

// ---------------------------------------------------------------------------
section('Erster Zug: Spieler auf D1 darf keine Karte spielen');
// ---------------------------------------------------------------------------
{
  let threw = false;
  try {
    M.playCard(state, 'alice', state.players.alice.hand[0]);
  } catch (e) {
    threw = true;
  }
  check('Kartenspiel im 1. Zug von Spieler D1 wird verweigert', threw === true);
}

// ---------------------------------------------------------------------------
section('Bewegung: Alice bewegt sich 2 Felder gerade');
// ---------------------------------------------------------------------------
{
  const aliceHero = state.figures.find((f) => f.owner === 'alice');
  const start = { x: aliceHero.x, y: aliceHero.y };
  const step1 = { x: start.x, y: start.y + 1 };
  const step2 = { x: start.x, y: start.y + 2 };

  M.attemptMove(state, 'alice', aliceHero.id, [step1, step2]);
  check('Alice steht nach Bewegung auf dem erwarteten Feld', aliceHero.x === step2.x && aliceHero.y === step2.y);

  let overBudget = false;
  try {
    M.attemptMove(state, 'alice', aliceHero.id, [{ x: step2.x, y: step2.y + 1 }]);
  } catch (e) {
    overBudget = true;
  }
  check('Drittes Feld im selben Zug ueberschreitet das Bewegungsbudget', overBudget === true);
}

M.endTurn(state); // -> bob

// ---------------------------------------------------------------------------
section('Wandregeln: Wand kann Nord-Sued-Pfad nicht komplett schliessen');
// ---------------------------------------------------------------------------
{
  // Bob baut (fuer den Test) eine fast vollstaendige Mauer, die letzte Luecke
  // darf nicht geschlossen werden.
  const board = Board.STANDARD_1V1_BOARD;
  for (let x = 0; x < board.width; x++) {
    if (x === 7) continue; // Luecke bei Spalte H
    const top = { x, y: 3 };
    const bottom = { x, y: 4 };
    // Direkt in den internen wallState schreiben, um das Szenario aufzubauen,
    // ohne das Wand-Budget/-Kontingent des Tests zu sprengen.
    Board.placeWall(state.wallState, top, bottom);
  }

  let blocked = false;
  try {
    M.attemptPlaceWall(state, 'bob', { x: 7, y: 3 }, { x: 7, y: 4 });
  } catch (e) {
    blocked = true;
  }
  check('Letzte Luecke im Nord-Sued-Pfad darf nicht geschlossen werden', blocked === true);
}

M.endTurn(state); // -> alice

// ---------------------------------------------------------------------------
section('Konterkette: Karte spielen oeffnet eine Kette, die aufgeloest werden muss');
// ---------------------------------------------------------------------------
{
  const cardId = state.players.alice.hand[0];
  const chain = M.playCard(state, 'alice', cardId);
  check('playCard oeffnet eine aktive Kette', state.activeChain !== null && state.activeChain.resolved === false);

  let blockedTurnEnd = false;
  try {
    M.endTurn(state);
  } catch (e) {
    blockedTurnEnd = true;
  }
  check('Zug kann nicht beendet werden, solange eine Kette offen ist', blockedTurnEnd === true);

  const executed = [];
  M.resolveActiveChain(state, (item) => executed.push(item.card ? item.card.name : 'origin'));
  check('Kette ist nach Aufloesung als resolved markiert', state.activeChain.resolved === true);
}

M.endTurn(state); // -> bob, jetzt sollte es klappen

// ---------------------------------------------------------------------------
section('Schnappen: Heldenfigur wird geschnappt -> Aussetz-Runden + Wiedergeburt');
// ---------------------------------------------------------------------------
{
  // Wir bauen ein kontrolliertes Mini-Szenario: Bobs Held direkt neben Alices
  // Held platzieren und schnappen lassen.
  const aliceHero = state.figures.find((f) => f.owner === 'alice');
  const bobHero = state.figures.find((f) => f.owner === 'bob');
  bobHero.x = aliceHero.x + 1;
  bobHero.y = aliceHero.y;

  // Zug gehoert aktuell bob (nach den endTurn-Aufrufen oben) -- fuer den Test
  // erzwingen wir explizit, dass alice am Zug ist, um den Schnapp-Zug zu simulieren.
  state.currentTurnIndex = state.turnOrder.indexOf('alice');
  state.turnBudget = { fieldsMoved: 0, maxFields: 2, cardsPlayed: 1, maxCards: 1, wallsPlaced: 0, maxWalls: 2 };

  M.attemptMove(state, 'alice', aliceHero.id, [{ x: bobHero.x, y: bobHero.y }]);

  check('Bobs Heldenfigur wurde vom Spielfeld entfernt', !state.figures.some((f) => f.owner === 'bob'));
  check('Bob muss 1 Runde aussetzen (erstes Mal geschnappt)', state.players.bob.pendingSkipTurns === 1);
  check('Bobs captureCount ist 1', state.players.bob.captureCount === 1);
}

M.endTurn(state); // -> bob dran, aber muss aussetzen -> automatisch weiter zu alice
check('Zug wurde wegen Aussetz-Runde automatisch an alice weitergereicht', state.turnOrder[state.currentTurnIndex] === 'alice');
check('Bobs pendingSkipTurns wurde auf 0 reduziert', state.players.bob.pendingSkipTurns === 0);

M.endTurn(state); // alice beendet ihren (Sitz-)Zug -> jetzt ist Bobs Aussetzrunde vorbei, er ist wieder "dran"
check('Fuer Bob ist jetzt eine Wiedergeburt faellig', state.pendingRespawn === 'bob');

// ---------------------------------------------------------------------------
section('Wiedergeburt: Bob bringt seine Heldenfigur auf eigenem Rand zurueck');
// ---------------------------------------------------------------------------
{
  const handBefore = state.players.bob.hand.length;
  M.respawnFigure(state, 'bob', coord('A8')); // Bobs Rand ist "south" (y = max)
  check('Bobs Heldenfigur ist wieder auf dem Feld', state.figures.some((f) => f.owner === 'bob'));
  check('pendingRespawn wurde zurueckgesetzt', state.pendingRespawn === null);
  check('Bob hat nach Wiedergeburt eine Karte gezogen', state.players.bob.hand.length === handBefore + 1);
}

// ---------------------------------------------------------------------------
section('Firestore-Serialisierung: Sets <-> Arrays, Rundtrip verlustfrei');
// ---------------------------------------------------------------------------
{
  const serialized = M.serializeForFirestore(state);
  check('Serialisierte Waende sind ein Array', Array.isArray(serialized.wallState.walls));
  const json = JSON.parse(JSON.stringify(serialized)); // simuliert Firestore-Roundtrip
  const hydrated = M.hydrateFromFirestore(json);
  check('Rehydrierte Waende sind wieder ein Set', hydrated.wallState.walls instanceof Set);
  check('Wandanzahl bleibt beim Rundtrip erhalten', hydrated.wallState.walls.size === state.wallState.walls.size);
}

// ---------------------------------------------------------------------------
console.log(`\n${'='.repeat(50)}`);
console.log(`Ergebnis: ${passed} bestanden, ${failed} fehlgeschlagen`);
console.log('='.repeat(50));
process.exit(failed > 0 ? 1 : 0);
