// engine/effectExecutor.test.js
//
// Testet den Effekt-Ausfuehrer mit echten Karten (bzw. deren strukturierten
// Entsprechungen) aus cards_structured_final.json. Ausfuehren mit:
// node engine/effectExecutor.test.js

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
    matchId: 'exec_test',
    player1: { id: 'alice', heroCardId: '002', deck: Array.from({ length: 20 }, (_, i) => `card_${i}`) },
    player2: { id: 'bob', heroCardId: '001', deck: Array.from({ length: 20 }, (_, i) => `card_${i + 100}`) },
  });
  M.dealStartingHands(state, 2);
  state.status = 'active';
  state.isFirstRound = false; // Kartenspiel-Sperre fuer diese Tests umgehen
  return state;
}

// ---------------------------------------------------------------------------
section('065 Winziger Eilsamen -- einfache Bewegung um 1 Feld');
// ---------------------------------------------------------------------------
{
  const state = freshMatch();
  const card = { id: '065', name: 'Winziger Eilsamen', effects: [{ action: 'move', target: 'self', fields: 1 }] };
  const aliceHero = state.figures.find((f) => f.owner === 'alice');
  const start = { x: aliceHero.x, y: aliceHero.y };
  const oneStep = { x: start.x, y: start.y + 1 };

  E.executeCard(state, card, { playerId: 'alice', choices: { path: [oneStep] } });
  check('Held bewegt sich exakt 1 Feld', aliceHero.x === oneStep.x && aliceHero.y === oneStep.y);
}

// ---------------------------------------------------------------------------
section('037 Klang des singenden Schwertes -- 2 zusaetzliche Karten spielbar');
// ---------------------------------------------------------------------------
{
  const state = freshMatch();
  const card = { id: '037', name: 'Klang des singenden Schwertes', effects: [{ action: 'play_additional_card', target: 'self', count: 2 }] };
  const before = state.turnBudget.maxCards;
  E.executeCard(state, card, { playerId: 'alice', choices: {} });
  check('Kartenbudget um 2 erhoeht', state.turnBudget.maxCards === before + 2);
}

// ---------------------------------------------------------------------------
section('Seelenkompass-artige Karte -- Karte ziehen');
// ---------------------------------------------------------------------------
{
  const state = freshMatch();
  const card = { id: '000', name: 'Seelenkompass (Test)', effects: [{ action: 'draw_card', target: 'self', count: 1 }] };
  const before = state.players.alice.hand.length;
  E.executeCard(state, card, { playerId: 'alice', choices: {} });
  check('1 Karte gezogen', state.players.alice.hand.length === before + 1);
}

// ---------------------------------------------------------------------------
section('010 Schattenreflexe -- variable Bewegung nach abgeworfenen Karten (Formel)');
// ---------------------------------------------------------------------------
{
  const state = freshMatch();
  const card = {
    id: '010', name: 'Schattenreflexe',
    cost: [{ action: 'discard_card', target: 'self', count: 'any' }],
    effects: [{ action: 'move', target: 'self', fields: '1 + count(discarded)' }],
  };
  const aliceHero = state.figures.find((f) => f.owner === 'alice');
  const start = { x: aliceHero.x, y: aliceHero.y };
  const discardIds = [...state.players.alice.hand]; // beide Handkarten abwerfen -> +2 Bonus

  const path = [
    { x: start.x, y: start.y + 1 },
    { x: start.x, y: start.y + 2 },
    { x: start.x, y: start.y + 3 },
  ]; // 1 Basis + 2 Bonus = 3 Felder

  E.executeCard(state, card, {
    playerId: 'alice',
    choices: { discardedCardIds: discardIds, path },
  });

  check('Beide Karten wurden abgeworfen', state.players.alice.hand.length === 0);
  check('Held bewegte sich 1 + 2 = 3 Felder', aliceHero.y === start.y + 3);
}

// ---------------------------------------------------------------------------
section('Wandbrecher-artige Karte -- Wand zerstoeren');
// ---------------------------------------------------------------------------
{
  const state = freshMatch();
  const a = coord('D4');
  const b = coord('E4');
  Board.placeWall(state.wallState, a, b);
  check('Wand existiert vor Kartenspiel', Board.hasWallBetween(state.wallState, a, b));

  const card = { id: '000', name: 'Wandbrecher (Test)', effects: [{ action: 'destroy_wall', target: 'chosen' }] };
  E.executeCard(state, card, { playerId: 'alice', choices: { wallsToDestroy: [[a, b]] } });
  check('Wand wurde zerstoert', !Board.hasWallBetween(state.wallState, a, b));
}

// ---------------------------------------------------------------------------
section('Frostzirkel-artige Karte -- Bewegungsunfaehigkeit als Status-Effekt');
// ---------------------------------------------------------------------------
{
  const state = freshMatch();
  const bobHero = state.figures.find((f) => f.owner === 'bob');
  const card = { id: '000', name: 'Frostzirkel (Test)', effects: [{ action: 'prevent_movement', target: 'context', duration: 'this_turn' }] };
  E.executeCard(state, card, { playerId: 'alice', choices: { targetFigureId: bobHero.id } });

  const active = M.getActiveStatusEffects(state, bobHero.id, 'movement_inability');
  check('Bewegungsunfaehigkeit wurde als Status-Effekt hinterlegt', active.length === 1);

  M.endTurn(state); // "this_turn" sollte jetzt ablaufen
  const afterTurn = M.getActiveStatusEffects(state, bobHero.id, 'movement_inability');
  check('Status-Effekt "end_of_this_turn" laeuft nach Zugende ab', afterTurn.length === 0);
}

// ---------------------------------------------------------------------------
section('068 Doppelschuss -- Wahle eines: Verzweigung');
// ---------------------------------------------------------------------------
{
  const state = freshMatch();
  const card = {
    id: '068', name: 'Doppelschuss',
    effects: [{
      action: 'choose_one',
      options: [
        [{ action: 'play_additional_card', target: 'self', count: 2 }],
        [{ action: 'draw_card', target: 'self', count: 2 }],
      ],
    }],
  };

  const before = state.players.alice.hand.length;
  E.executeCard(state, card, { playerId: 'alice', choices: { chosenOptionIndex: 1 } });
  check('Option 2 (2 Karten ziehen) wurde korrekt ausgefuehrt', state.players.alice.hand.length === before + 2);
  check('Option 1 (Kartenbudget) wurde NICHT ausgefuehrt', state.turnBudget.maxCards === 1);
}

// ---------------------------------------------------------------------------
section('Fehlender Handler wirft einen klaren Fehler statt still zu scheitern');
// ---------------------------------------------------------------------------
{
  const state = freshMatch();
  const card = { id: '000', name: 'Muenzwurf (Test)', effects: [{ action: 'flip_coin' }] };
  let threw = false;
  try {
    E.executeCard(state, card, { playerId: 'alice', choices: {} });
  } catch (e) {
    threw = e.message.includes('Kein Handler');
  }
  check('Nicht implementierter Handler wirft klaren Fehler', threw === true);
}

// ---------------------------------------------------------------------------
console.log(`\n${'='.repeat(50)}`);
console.log(`Ergebnis: ${passed} bestanden, ${failed} fehlgeschlagen`);
console.log('='.repeat(50));
process.exit(failed > 0 ? 1 : 0);
