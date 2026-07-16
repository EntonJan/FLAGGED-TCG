// engine/matchState.js
//
// Spielzustand einer laufenden Partie. Verbindet board.js (Bewegung/Waende)
// und counterChain.js (Konterketten) zu einem vollstaendigen Zugablauf.
//
// Bewusst OHNE Firestore-Abhaengigkeit geschrieben (reines JS-Objekt +
// Funktionen) -- dadurch mit Node testbar, ohne Firebase-Emulator. Am Ende
// der Datei gibt es serializeForFirestore()/hydrateFromFirestore(), die die
// Umwandlung zwischen internem Zustand (nutzt Sets, siehe board.js) und
// Firestore-kompatiblem JSON (nur Arrays/Primitives) uebernehmen.
//
// Abgedeckte Regeln (siehe Rule-Entity):
// - Setup 1v1: 8x8 Feld, Start D1/E8, 10 Waende pro Spieler, 2 Handkarten,
//   abwechselnd je 1 Wand in eigener Haelfte vor Spielbeginn
// - Spieler auf D1 beginnt, darf im 1. Zug keine Karte spielen
// - Pro Zug frei waehlbar: bis zu 2 Felder gerade bewegen (aufteilbar),
//   1 Karte spielen, bis zu 2 Waende setzen (aufteilbar)
// - Schnappen: Heldenfigur geschnappt -> Besitzer setzt so viele Runden aus,
//   wie oft die Heldenfigur bereits geschnappt wurde (1., 2., 3. Mal, ...).
//   Beim 6. Mal verliert der Spieler.
// - Wiedergeburt: nach Absitzen der Runden, vor dem Kartenziehen, Heldenfigur
//   auf freiem Feld am eigenen Spielfeldrand platzieren.
// - Flagge: eigene Heldenfigur betritt gegnerischen Rand -> nimmt Flagge auf.
//   Bringt sie zum eigenen Rand -> 1 Punkt. Wird die tragende Figur
//   geschnappt, wird die Flagge zurueckgesetzt.

const Board = require('./board.js');
const Chain = require('./counterChain.js');

// ---------------------------------------------------------------------------
// Match-Erstellung
// ---------------------------------------------------------------------------

/**
 * Erstellt eine neue 1v1-Partie nach offiziellem Setup.
 * @param {Object} opts
 * @param {string} opts.matchId
 * @param {{id: string, heroCardId: string, deck: string[]}} opts.player1  (startet auf D1)
 * @param {{id: string, heroCardId: string, deck: string[]}} opts.player2  (startet auf E8)
 */
function createMatch1v1({ matchId, player1, player2 }) {
  const boardConfig = Board.STANDARD_1V1_BOARD;
  const wallState = Board.createWallState();

  const p1Start = Board.parseCoord(boardConfig, 'D1');
  const p2Start = Board.parseCoord(boardConfig, 'E8');

  const figures = [
    { id: `${player1.id}_hero`, owner: player1.id, x: p1Start.x, y: p1Start.y, type: 'hero', carryingFlag: false, alive: true },
    { id: `${player2.id}_hero`, owner: player2.id, x: p2Start.x, y: p2Start.y, type: 'hero', carryingFlag: false, alive: true },
  ];

  const makePlayerState = (p, edge) => ({
    id: p.id,
    heroCardId: p.heroCardId,
    deck: [...p.deck],
    hand: [], // wird in setupDrawInitialHands befuellt
    discardPile: [],
    wallsRemaining: 10,
    captureCount: 0,
    pendingSkipTurns: 0,
    flagPoints: 0,
    boardEdge: edge, // 'north' (y=0) oder 'south' (y=max) -- fuer Wiedergeburt/Flaggen-Ziel
  });

  const state = {
    matchId,
    mode: '1v1',
    boardConfig: { columns: boardConfig.columns, rows: boardConfig.rows },
    wallState,
    figures,
    players: {
      [player1.id]: makePlayerState(player1, 'north'),
      [player2.id]: makePlayerState(player2, 'south'),
    },
    turnOrder: [player1.id, player2.id],
    currentTurnIndex: 0,
    round: 1,
    isFirstRound: true,
    turnBudget: createEmptyTurnBudget(),
    activeChain: null,
    statusEffects: [], // befristete Effekte, siehe addStatusEffect()/purge in endTurn()
    log: [],
    status: 'setup', // -> 'active' nach initialem Wandsetzen + Handkarten
    winner: null,
  };

  return state;
}

function createEmptyTurnBudget() {
  return { fieldsMoved: 0, maxFields: 2, cardsPlayed: 0, maxCards: 1, wallsPlaced: 0, maxWalls: 2 };
}

/** Mischt jedes Spieler-Deck (Fisher-Yates) -- reiner Utility-Helper. */
function shuffle(array, rng = Math.random) {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/** Beide Spieler ziehen ihre Start-Handkarten (offiziell: 2 Karten). */
function dealStartingHands(state, count = 2) {
  for (const playerId of state.turnOrder) {
    const player = state.players[playerId];
    player.deck = shuffle(player.deck);
    for (let i = 0; i < count; i++) {
      drawCard(state, playerId);
    }
  }
  return state;
}

function drawCard(state, playerId) {
  const player = state.players[playerId];
  if (player.deck.length === 0) {
    // Ablagestapel wird neues Deck, Ultimate-Karten bleiben aussen vor (Regelwerk)
    const reshuffleable = player.discardPile.filter((cardId) => !cardId.startsWith('ULTIMATE_KEEP:'));
    player.deck = shuffle(reshuffleable);
    player.discardPile = player.discardPile.filter((cardId) => cardId.startsWith('ULTIMATE_KEEP:'));
  }
  if (player.deck.length === 0) return null; // beide Stapel leer -- Randfall
  const card = player.deck.shift();
  player.hand.push(card);
  if (player.hand.length > 5) {
    // Handkartenlimit: ueberschuessige Karte muss abgeworfen werden (Wahl liegt
    // beim Spieler -- hier wird die zuletzt gezogene als Default abgeworfen,
    // die aufrufende UI kann stattdessen discardCard() gezielt aufrufen)
    const excess = player.hand.pop();
    player.discardPile.push(excess);
  }
  return card;
}

// ---------------------------------------------------------------------------
// Bewegung
// ---------------------------------------------------------------------------

/**
 * Versucht eine gerade Bewegung ueber `path` (Liste von {x,y}-Zielfeldern,
 * ein oder mehrere Felder). Wendet Zug-Budget, Wandkollision und Schnapp-
 * Regeln an. Wirft bei Regelverstoss, aendert `state` sonst in-place.
 */
function attemptMove(state, playerId, figureId, path) {
  assertPlayersTurn(state, playerId);
  const boardConfig = Board.createBoardConfig(state.boardConfig.columns, state.boardConfig.rows);
  const figure = state.figures.find((f) => f.id === figureId && f.owner === playerId && f.alive);
  if (!figure) throw new Error('Figur nicht gefunden oder gehoert nicht dem Spieler.');

  if (state.turnBudget.fieldsMoved + path.length > state.turnBudget.maxFields) {
    throw new Error(`Bewegungsbudget ueberschritten (max. ${state.turnBudget.maxFields} Felder pro Zug).`);
  }

  const result = Board.validateStraightPath(
    boardConfig, state.wallState, state.figures, { x: figure.x, y: figure.y }, path, playerId
  );
  if (!result.valid) {
    throw new Error(`Bewegung ungueltig: ${result.reason}`);
  }

  const destination = path[path.length - 1];
  figure.x = destination.x;
  figure.y = destination.y;
  state.turnBudget.fieldsMoved += path.length;

  if (result.capture) {
    applyCapture(state, result.capture, figure);
  }

  checkFlagPickup(state, figure);
  checkFlagDelivery(state, figure);
  checkWolfModeCaptures(state, figure);

  state.log.push({ type: 'move', playerId, figureId, to: Board.coordToLabel(boardConfig, destination), captured: !!result.capture });
  return { capture: result.capture };
}

/** Wendet die Schnapp-Konsequenzen an: Figur entfernen, Flagge zuruecksetzen, Aussetz-Runden. */
function applyCapture(state, capturedFigure, capturingFigure) {
  capturedFigure.alive = false;
  state.figures = state.figures.filter((f) => f.id !== capturedFigure.id);

  if (capturedFigure.carryingFlag) {
    // Flagge geht an schnappende Figur ueber, falls diese eine Aura/Kristall-
    // Sonderregel hat (KOTH) -- im Standardmodus wird die Flagge zurueckgesetzt.
    capturedFigure.carryingFlag = false;
    // Standard-1v1: Flagge wird zurueckgesetzt (kein Kristall-Modus)
  }

  if (capturedFigure.type === 'hero') {
    const owner = state.players[capturedFigure.owner];
    owner.captureCount += 1;
    owner.pendingSkipTurns += owner.captureCount; // 1. Mal=1, 2. Mal=2, ...
    if (owner.captureCount >= 6) {
      state.status = 'finished';
      state.winner = capturingFigure.owner;
      state.log.push({ type: 'game_over', reason: 'hero_captured_6_times', loser: capturedFigure.owner });
    }
  }
}

/**
 * Wolf-Modus (Waldlaeufer, FAQ bestaetigt): Ist der Wolf-Modus aktiv, koennen
 * gegnerische Figuren auch DURCH WAENDE geschnappt werden, sobald sie ein
 * Feld im Umkreis von 1 um die Wolf-Modus-Figur betreten. Wird nach JEDER
 * Bewegung geprueft (auch der eigenen Figuren, da auch die eigene Bewegung
 * eine gegnerische Wolf-Figur "aktivieren" kann, falls man selbst betroffen ist).
 */
function checkWolfModeCaptures(state, movedFigure) {
  if (!movedFigure.alive) return;
  const wolfFigures = state.figures.filter(
    (f) => f.wolfModeActive && f.owner !== movedFigure.owner && f.alive && f.id !== movedFigure.id
  );
  for (const wolf of wolfFigures) {
    if (Board.isAdjacent(wolf, movedFigure)) {
      applyCapture(state, movedFigure, wolf);
      state.log.push({ type: 'wolf_mode_capture', by: wolf.id, captured: movedFigure.id });
      return; // Figur ist jetzt vom Feld entfernt, keine weitere Pruefung noetig
    }
  }
}

function checkFlagPickup(state, figure) {
  const boardConfig = Board.createBoardConfig(state.boardConfig.columns, state.boardConfig.rows);
  const opponentId = state.turnOrder.find((id) => id !== figure.owner);
  const opponentEdge = state.players[opponentId].boardEdge;
  const onOpponentEdge =
    (opponentEdge === 'north' && figure.y === 0) ||
    (opponentEdge === 'south' && figure.y === boardConfig.height - 1);
  if (onOpponentEdge && figure.type === 'hero' && !figure.carryingFlag) {
    figure.carryingFlag = true;
    state.log.push({ type: 'flag_pickup', playerId: figure.owner });
  }
}

function checkFlagDelivery(state, figure) {
  const boardConfig = Board.createBoardConfig(state.boardConfig.columns, state.boardConfig.rows);
  const ownEdge = state.players[figure.owner].boardEdge;
  const onOwnEdge =
    (ownEdge === 'north' && figure.y === 0) || (ownEdge === 'south' && figure.y === boardConfig.height - 1);
  if (onOwnEdge && figure.carryingFlag) {
    figure.carryingFlag = false;
    const player = state.players[figure.owner];
    player.flagPoints += 1;
    state.log.push({ type: 'flag_delivered', playerId: figure.owner, totalPoints: player.flagPoints });
    if (player.flagPoints >= 2) {
      state.status = 'finished';
      state.winner = figure.owner;
      state.log.push({ type: 'game_over', reason: 'flag_points', winner: figure.owner });
    }
  }
}

// ---------------------------------------------------------------------------
// Waende
// ---------------------------------------------------------------------------

function attemptPlaceWall(state, playerId, coordA, coordB) {
  assertPlayersTurn(state, playerId);
  const player = state.players[playerId];
  if (player.wallsRemaining <= 0) throw new Error('Keine Waende mehr verfuegbar.');
  if (state.turnBudget.wallsPlaced >= state.turnBudget.maxWalls) {
    throw new Error(`Wand-Budget ueberschritten (max. ${state.turnBudget.maxWalls} pro Zug).`);
  }

  const boardConfig = Board.createBoardConfig(state.boardConfig.columns, state.boardConfig.rows);
  const isOrthogonalEdge =
    (Math.abs(coordA.x - coordB.x) === 1 && coordA.y === coordB.y) ||
    (coordA.x === coordB.x && Math.abs(coordA.y - coordB.y) === 1);
  if (!isOrthogonalEdge) throw new Error('Waende koennen nur zwischen orthogonal benachbarten Feldern platziert werden.');

  if (Board.hasWallBetween(state.wallState, coordA, coordB)) {
    throw new Error('Dort steht bereits eine Wand.');
  }

  if (Board.wouldWallBlockNorthSouthPath(boardConfig, state.wallState, coordA, coordB)) {
    throw new Error('Diese Wand wuerde den letzten Nord-Sued-Pfad vollstaendig schliessen -- nicht erlaubt.');
  }

  Board.placeWall(state.wallState, coordA, coordB);
  player.wallsRemaining -= 1;
  state.turnBudget.wallsPlaced += 1;
  state.log.push({ type: 'wall_placed', playerId, a: Board.coordToLabel(boardConfig, coordA), b: Board.coordToLabel(boardConfig, coordB) });
}

// ---------------------------------------------------------------------------
// Karten spielen & Konterketten (Integration mit counterChain.js)
// ---------------------------------------------------------------------------

/**
 * Startet eine neue Konterkette fuer eine Aktion (Bewegung, Kartenspiel,
 * Zugende). Die eigentliche Kartenwirkung wird ueber `executeEffects`
 * (siehe counterChain.js) an eine spaetere Effekt-Ausfuehrungs-Engine
 * delegiert -- diese Datei kuemmert sich nur um die Verkettung selbst.
 */
function openChainForAction(state, description, owner) {
  if (state.activeChain && !state.activeChain.resolved) {
    throw new Error('Es laeuft bereits eine ungeloeste Konterkette.');
  }
  state.activeChain = Chain.createChain({ owner, description });
  return state.activeChain;
}

function playCounterOnActiveChain(state, playerId, counterCard) {
  if (!state.activeChain) throw new Error('Keine aktive Kette, auf die gekontert werden koennte.');
  return Chain.pushCounter(state.activeChain, playerId, counterCard);
}

function resolveActiveChain(state, executeEffects) {
  if (!state.activeChain) throw new Error('Keine aktive Kette zum Aufloesen.');
  const log = Chain.resolveChain(state.activeChain, executeEffects);
  state.log.push({ type: 'chain_resolved', entries: log });
  return log;
}

function playCard(state, playerId, cardId) {
  assertPlayersTurn(state, playerId);
  if (state.isFirstRound && state.currentTurnIndex === 0) {
    throw new Error('Der beginnende Spieler darf im ersten Zug keine Karte spielen.');
  }
  if (state.turnBudget.cardsPlayed >= state.turnBudget.maxCards) {
    throw new Error(`Karten-Budget ueberschritten (max. ${state.turnBudget.maxCards} normale Karte(n) pro Zug).`);
  }
  const player = state.players[playerId];
  const idx = player.hand.indexOf(cardId);
  if (idx === -1) throw new Error('Karte nicht auf der Hand.');
  player.hand.splice(idx, 1);
  state.turnBudget.cardsPlayed += 1;
  // Tatsaechliche Wirkung + moegliche Konterkette wird von aussen ueber
  // openChainForAction()/resolveActiveChain() gesteuert.
  return openChainForAction(state, `Karte: ${cardId}`, playerId);
}

// ---------------------------------------------------------------------------
// Zugsteuerung
// ---------------------------------------------------------------------------

function assertPlayersTurn(state, playerId) {
  if (state.status !== 'active') throw new Error(`Match ist nicht aktiv (Status: ${state.status}).`);
  if (state.turnOrder[state.currentTurnIndex] !== playerId) {
    throw new Error('Nicht der Zug dieses Spielers.');
  }
}

function endTurn(state) {
  const currentPlayerId = state.turnOrder[state.currentTurnIndex];
  if (state.activeChain && !state.activeChain.resolved) {
    throw new Error('Aktive Konterkette muss vor Zugende aufgeloest werden.');
  }

  purgeStatusEffects(state, { endingTurn: true });

  state.currentTurnIndex = (state.currentTurnIndex + 1) % state.turnOrder.length;
  if (state.currentTurnIndex === 0) {
    state.round += 1;
    state.isFirstRound = false;
  }

  const nextPlayerId = state.turnOrder[state.currentTurnIndex];
  const nextPlayer = state.players[nextPlayerId];

  state.turnBudget = createEmptyTurnBudget();

  const nextPlayerHasActiveWolf = state.figures.some((f) => f.owner === nextPlayerId && f.wolfModeActive);
  if (nextPlayerHasActiveWolf) {
    state.turnBudget.maxFields += 1;
  }

  if (nextPlayer.pendingSkipTurns > 0) {
    nextPlayer.pendingSkipTurns -= 1;
    state.log.push({ type: 'turn_skipped', playerId: nextPlayerId, remaining: nextPlayer.pendingSkipTurns });
    endTurn(state); // rekursiv direkt zum uebernaechsten Spieler weiterreichen
    return;
  }

  const heroAlive = state.figures.some((f) => f.owner === nextPlayerId && f.type === 'hero');
  if (!heroAlive && nextPlayer.captureCount > 0 && nextPlayer.captureCount < 6) {
    state.pendingRespawn = nextPlayerId; // aufrufende UI muss respawnFigure() aufrufen, BEVOR Karte gezogen wird
  } else {
    drawCard(state, nextPlayerId);
  }
  purgeStatusEffects(state, { startingTurnForOwner: nextPlayerId });

  state.log.push({ type: 'turn_ended', previousPlayer: currentPlayerId, nextPlayer: nextPlayerId, round: state.round });
}

/** Wiedergeburt: Heldenfigur auf freiem Feld am eigenen Spielfeldrand platzieren. */
function respawnFigure(state, playerId, coord) {
  if (state.pendingRespawn !== playerId) throw new Error('Fuer diesen Spieler ist aktuell keine Wiedergeburt faellig.');
  const boardConfig = Board.createBoardConfig(state.boardConfig.columns, state.boardConfig.rows);
  const player = state.players[playerId];
  const isOwnEdge =
    (player.boardEdge === 'north' && coord.y === 0) || (player.boardEdge === 'south' && coord.y === boardConfig.height - 1);
  if (!isOwnEdge) throw new Error('Wiedergeburt muss auf dem eigenen Spielfeldrand erfolgen.');
  if (Board.figureAt(state.figures, coord)) throw new Error('Feld ist nicht frei.');

  state.figures.push({ id: `${playerId}_hero`, owner: playerId, x: coord.x, y: coord.y, type: 'hero', carryingFlag: false, alive: true });
  state.pendingRespawn = null;
  drawCard(state, playerId);
  state.log.push({ type: 'respawn', playerId, at: Board.coordToLabel(boardConfig, coord) });
}

// ---------------------------------------------------------------------------
// Status-Effekte (befristete Wirkungen wie "kann sich diesen Zug nicht
// bewegen" oder "bis zu deinem naechsten Zug nicht schnappbar")
// ---------------------------------------------------------------------------
//
// expires:
//   'end_of_this_turn'         -> faellt weg, sobald der AKTUELLE Zug endet
//   'until_owner_next_turn'    -> faellt weg, sobald der Zug des Ziel-Besitzers
//                                  das naechste Mal beginnen wuerde (auch wenn
//                                  der Spieler aussetzen muss -- siehe FAQ:
//                                  Aussetzen verlaengert die Dauer NICHT)

function addStatusEffect(state, { target, type, value, expires, ownerForExpiry }) {
  const effect = { id: `${type}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`, target, type, value, expires, ownerForExpiry };
  state.statusEffects.push(effect);
  return effect;
}

function getActiveStatusEffects(state, target, type) {
  return state.statusEffects.filter((e) => e.target === target && e.type === type);
}

function purgeStatusEffects(state, { endingTurn, startingTurnForOwner }) {
  state.statusEffects = state.statusEffects.filter((e) => {
    if (e.expires === 'end_of_this_turn' && endingTurn) return false;
    if (e.expires === 'until_owner_next_turn' && startingTurnForOwner && e.ownerForExpiry === startingTurnForOwner) return false;
    return true;
  });
}

// ---------------------------------------------------------------------------
// Firestore-Serialisierung (Sets <-> Arrays)
// ---------------------------------------------------------------------------

function serializeForFirestore(state) {
  return {
    ...state,
    wallState: {
      walls: [...state.wallState.walls],
      runeStones: [...state.wallState.runeStones],
    },
  };
}

function hydrateFromFirestore(doc) {
  return {
    ...doc,
    wallState: {
      walls: new Set(doc.wallState.walls),
      runeStones: new Set(doc.wallState.runeStones),
    },
  };
}

module.exports = {
  createMatch1v1,
  dealStartingHands,
  drawCard,
  attemptMove,
  attemptPlaceWall,
  applyCapture,
  checkWolfModeCaptures,
  addStatusEffect,
  getActiveStatusEffects,
  purgeStatusEffects,
  openChainForAction,
  playCounterOnActiveChain,
  resolveActiveChain,
  playCard,
  endTurn,
  respawnFigure,
  serializeForFirestore,
  hydrateFromFirestore,
};
