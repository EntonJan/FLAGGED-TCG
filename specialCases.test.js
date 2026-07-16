// engine/specialCases.test.js
//
// Testet die Sonderfall-Handler: Schattenklon, Wolf-Modus, Begleiter,
// Board-Rotation, Portale, Flaggenwechsel. Ausfuehren mit:
// node engine/specialCases.test.js

const M = require('./matchState.js');
const E = require('./effectExecutor.js');
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

function freshMatch() {
  const state = M.createMatch1v1({
    matchId: 'special_test',
    player1: { id: 'alice', heroCardId: '001', deck: Array.from({ length: 20 }, (_, i) => `card_${i}`) },
    player2: { id: 'bob', heroCardId: '003', deck: Array.from({ length: 20 }, (_, i) => `card_${i + 100}`) },
  });
  M.dealStartingHands(state, 2);
  state.status = 'active';
  state.isFirstRound = false;
  return state;
}

// ---------------------------------------------------------------------------
section('001 Assassin -- Schattenklon erstellen & neu bestimmen, welche Figur Held ist');
// ---------------------------------------------------------------------------
{
  const state = freshMatch();
  const aliceHero = state.figures.find((f) => f.owner === 'alice');
  const clonePos = { x: aliceHero.x + 1, y: aliceHero.y };

  const card = {
    id: '001', name: 'Assassin',
    effects: [
      { action: 'create_shadow_clone', target: 'self', count: 1 },
      { action: 'reassign_hero_figure' },
    ],
  };

  E.executeCard(state, card, {
    playerId: 'alice',
    choices: { clonePositions: [clonePos], newHeroFigureId: null },
  });

  const aliceFigures = state.figures.filter((f) => f.owner === 'alice');
  check('Alice hat jetzt 2 Figuren (Held + Klon)', aliceFigures.length === 2);
  check('Genau 1 davon ist als Held markiert', aliceFigures.filter((f) => f.type === 'hero').length === 1);
  check('Genau 1 davon ist als Klon markiert', aliceFigures.filter((f) => f.type === 'clone').length === 1);

  // Jetzt die Heldenrolle explizit auf den Klon uebertragen
  const clone = aliceFigures.find((f) => f.type === 'clone');
  E.executeCard(state, { id: '000', name: 'Test-Reassign', effects: [{ action: 'reassign_hero_figure' }] },
    { playerId: 'alice', choices: { newHeroFigureId: clone.id } });

  check('Der ehemalige Klon ist jetzt der Held', clone.type === 'hero');
  check('Die urspruengliche Heldenfigur ist jetzt der Klon', aliceHero.type === 'clone');
}

// ---------------------------------------------------------------------------
section('021 Schattenverzehr -- alle Klone entfernen (unabhaengig von aktueller Held-Zuordnung)');
// ---------------------------------------------------------------------------
{
  const state = freshMatch();
  const aliceHero = state.figures.find((f) => f.owner === 'alice');
  state.figures.push({ id: 'alice_clone_test', owner: 'alice', x: aliceHero.x + 1, y: aliceHero.y, type: 'clone', carryingFlag: false, alive: true });
  state.figures.push({ id: 'alice_clone_test2', owner: 'alice', x: aliceHero.x - 1, y: aliceHero.y, type: 'clone', carryingFlag: false, alive: true });

  const card = { id: '021', name: 'Schattenverzehr', effects: [{ action: 'remove_shadow_clone' }] };
  E.executeCard(state, card, { playerId: 'alice', choices: {} });

  check('Beide Klone wurden entfernt', state.figures.filter((f) => f.owner === 'alice' && f.type === 'clone').length === 0);
  check('Die Heldenfigur ist weiterhin vorhanden', state.figures.some((f) => f.owner === 'alice' && f.type === 'hero'));
}

// ---------------------------------------------------------------------------
section('066 Begleiter: Faehrtenwolf -- Beschwoerung');
// ---------------------------------------------------------------------------
{
  const state = freshMatch();
  const bobHero = state.figures.find((f) => f.owner === 'bob');
  const wolfPos = { x: bobHero.x, y: bobHero.y + 1 };

  const card = { id: '066', name: 'Begleiter: Fährtenwolf', effects: [{ action: 'summon_companion' }] };
  E.executeCard(state, card, { playerId: 'bob', choices: { companionPosition: wolfPos } });

  const companion = state.figures.find((f) => f.owner === 'bob' && f.type === 'companion');
  check('Begleiter wurde erstellt', !!companion);
  check('Begleiter steht angrenzend zur Heldenfigur', Board.isAdjacent(bobHero, companion));
}

// ---------------------------------------------------------------------------
section('086 Wolfmodus -- Aktivierung, Bewegungsbonus naechste Runde, Schnappen bei Annaeherung');
// ---------------------------------------------------------------------------
{
  const state = freshMatch();
  const bobHero = state.figures.find((f) => f.owner === 'bob');

  const card = { id: '086', name: 'Wolfmodus', effects: [{ action: 'toggle_wolf_mode' }] };
  E.executeCard(state, card, { playerId: 'bob', choices: {} });
  check('Wolf-Modus ist aktiv', bobHero.wolfModeActive === true);

  // Zug-Zyklus, bis Bob wieder dran ist, um den Start-Bonus zu pruefen
  M.endTurn(state); // -> alice (war gerade bob dran wegen isFirstRound=false Testsetup... zur Sicherheit currentTurnIndex checken)
  // Sicherstellen, dass wir jetzt tatsaechlich bei Bobs Zug ankommen:
  while (state.turnOrder[state.currentTurnIndex] !== 'bob') {
    M.endTurn(state);
  }
  check('Bobs Bewegungsbudget hat den Wolf-Modus-Bonus (3 statt 2)', state.turnBudget.maxFields === 3);

  // Schnappen bei Annaeherung: Alice bewegt sich neben Bobs (Wolf-Modus-)Held
  const aliceHero = state.figures.find((f) => f.owner === 'alice');
  aliceHero.x = bobHero.x + 2;
  aliceHero.y = bobHero.y; // 2 Felder entfernt, noch nicht angrenzend
  state.currentTurnIndex = state.turnOrder.indexOf('alice');
  state.turnBudget = { fieldsMoved: 0, maxFields: 2, cardsPlayed: 0, maxCards: 1, wallsPlaced: 0, maxWalls: 2 };

  M.attemptMove(state, 'alice', aliceHero.id, [{ x: bobHero.x + 1, y: bobHero.y }]);
  check('Alice wurde durch aktiven Wolf-Modus automatisch geschnappt, sobald sie angrenzend war', !state.figures.some((f) => f.id === aliceHero.id));
}

// ---------------------------------------------------------------------------
section('099 Finsterniswende -- Board-Rotation (90° im Uhrzeigersinn)');
// ---------------------------------------------------------------------------
{
  const state = freshMatch();
  const aliceHero = state.figures.find((f) => f.owner === 'alice');
  aliceHero.x = 0; aliceHero.y = 0; // Ecke A1 (0,0)

  const a = { x: 0, y: 0 };
  const b = { x: 1, y: 0 };
  Board.placeWall(state.wallState, a, b);

  const card = { id: '099', name: 'Finsterniswende', effects: [{ action: 'rotate_board', degrees: 90 }, { action: 'end_turn_immediately' }] };
  const result = E.executeCard(state, card, { playerId: 'alice', choices: { direction: 'clockwise' } });

  // Bei 8x8 (n=8), Ecke (0,0) rotiert im Uhrzeigersinn zu (8-1-0, 0) = (7, 0)
  check('Figur auf (0,0) rotiert korrekt zu (7,0) bei 90° im Uhrzeigersinn', aliceHero.x === 7 && aliceHero.y === 0);

  const rotatedA = { x: 8 - 1 - a.y, y: a.x }; // (7,0)
  const rotatedB = { x: 8 - 1 - b.y, y: b.x }; // (7,1)
  check('Wand wurde mitrotiert und ist an der neuen Position auffindbar', Board.hasWallBetween(state.wallState, rotatedA, rotatedB));
  check('Wand ist an der alten Position NICHT mehr vorhanden', !Board.hasWallBetween(state.wallState, a, b));
}

// ---------------------------------------------------------------------------
section('004 Zauberer -- Portale platzieren (muessen horizontal ausgerichtet sein)');
// ---------------------------------------------------------------------------
{
  const state = freshMatch();
  const card = { id: '004', name: 'Zauberer', effects: [{ action: 'place_portal_pair', constraint: 'same_horizontal_line' }] };

  let threw = false;
  try {
    E.executeCard(state, card, { playerId: 'alice', choices: { portalPositions: [coord('A1'), coord('B2')] } }); // nicht horizontal
  } catch (e) {
    threw = true;
  }
  check('Nicht-horizontale Portal-Platzierung wird abgelehnt', threw === true);

  E.executeCard(state, card, { playerId: 'alice', choices: { portalPositions: [coord('A1'), coord('C1')] } });
  check('Horizontale Portal-Platzierung ist erfolgreich', state.portals.length === 2);
}

// ---------------------------------------------------------------------------
section('107 Flaggenwechsel -- Flagge an angrenzenden Verbuendeten uebergeben');
// ---------------------------------------------------------------------------
{
  const state = freshMatch();
  const aliceHero = state.figures.find((f) => f.owner === 'alice');
  aliceHero.carryingFlag = true;
  const ally = { id: 'alice_ally_test', owner: 'alice', x: aliceHero.x + 1, y: aliceHero.y, type: 'clone', carryingFlag: false, alive: true };
  state.figures.push(ally);

  const card = { id: '107', name: 'Flaggenwechsel', effects: [{ action: 'transfer_flag' }] };
  E.executeCard(state, card, { playerId: 'alice', choices: { targetFigureId: ally.id } });

  check('Flagge wurde an die Verbuendete Figur uebergeben', ally.carryingFlag === true && aliceHero.carryingFlag === false);
}

// ---------------------------------------------------------------------------
console.log(`\n${'='.repeat(50)}`);
console.log(`Ergebnis: ${passed} bestanden, ${failed} fehlgeschlagen`);
console.log('='.repeat(50));
process.exit(failed > 0 ? 1 : 0);
