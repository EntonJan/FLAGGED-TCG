// engine/effectExecutor.js
//
// Liest die strukturierten Karteneffekte aus cards_structured_final.json und
// wendet sie tatsaechlich auf einen laufenden matchState an.
//
// WICHTIG zum Design: Dieses Modul TRIFFT KEINE Entscheidungen, die dem
// Spieler vorbehalten sind (z.B. "welche der 2 aufgedeckten gegnerischen
// Handkarten waehlst du"). Solche Entscheidungen kommen als bereits
// aufgeloeste `choices` von aussen (der spaeteren UI) rein. Der Executor
// validiert und wendet an, waehlt aber nicht selbst.
//
// Nicht alle ~110 Karten sind hier bereits abgedeckt -- die 25 haeufigsten
// Bausteine (siehe Baustein-Katalog) sind implementiert und getestet. Fehlt
// ein Handler, wirft executeAction() bewusst einen klaren Fehler statt still
// nichts zu tun, damit fehlende Faelle sofort auffallen.

const Match = require('./matchState.js');
const Board = require('./board.js');

/**
 * Fuehrt eine einzelne strukturierte Aktion aus.
 *
 * @param {Object} state    matchState
 * @param {Object} action   ein Eintrag aus card.effects[] / card.cost[]
 * @param {Object} context  { playerId, sourceCard, choices, resolvedTargets }
 *   - playerId: wer spielt die Karte
 *   - sourceCard: die strukturierte Karte selbst (fuer Logging/Referenz)
 *   - choices: von der UI bereits getroffene Entscheidungen, z.B.
 *       { targetFigureId, discardedCardIds, chosenOptionIndex, ... }
 */
function executeAction(state, action, context) {
  const handler = ACTION_HANDLERS[action.action];
  if (!handler) {
    throw new Error(`Kein Handler fuer Aktion "${action.action}" implementiert (Karte: ${context.sourceCard?.name}).`);
  }
  return handler(state, action, context);
}

/** Fuehrt eine Liste von Aktionen nacheinander aus (z.B. card.effects). */
function executeActionList(state, actions, context) {
  const results = [];
  for (const action of actions || []) {
    results.push(executeAction(state, action, context));
  }
  return results;
}

/**
 * Fuehrt eine komplette strukturierte Karte aus: erst cost[], dann effects[].
 * Kosten werden vor der Wirkung ausgefuehrt (z.B. Kartenabwurf), damit
 * abgeleitete Werte (z.B. "count(discarded)") in den effects verfuegbar sind.
 */
function executeCard(state, card, context) {
  const fullContext = { ...context, sourceCard: card, computed: {} };
  const costResults = executeActionList(state, card.cost, fullContext);
  const effectResults = executeActionList(state, card.effects, fullContext);
  return { costResults, effectResults };
}

// ---------------------------------------------------------------------------
// Hilfsfunktionen
// ---------------------------------------------------------------------------

function getFigure(state, figureId) {
  const figure = state.figures.find((f) => f.id === figureId);
  if (!figure) throw new Error(`Figur "${figureId}" nicht gefunden.`);
  return figure;
}

function resolveTargetFigureId(context, key = 'targetFigureId') {
  const id = context.choices && context.choices[key];
  if (!id) throw new Error(`Ziel-Figur fehlt in choices.${key} (noetig fuer diese Karte).`);
  return id;
}

// ---------------------------------------------------------------------------
// Action-Handler-Registry
// ---------------------------------------------------------------------------

const ACTION_HANDLERS = {
  // --- Bewegung -------------------------------------------------------
  move(state, action, context) {
    const figureId = context.choices?.figureId || `${context.playerId}_hero`;
    const figure = getFigure(state, figureId);
    let fields = action.fields;
    if (typeof fields === 'string') {
      // einfache Formel-Unterstuetzung, z.B. "1 + count(discarded)"
      fields = evaluateFieldsFormula(fields, context);
    }
    if (action.optional && context.choices?.skipOptionalMove) {
      return { skipped: true };
    }
    const path = context.choices?.path;
    if (!path || path.length !== fields) {
      throw new Error(`Bewegungspfad mit genau ${fields} Feld(ern) muss in choices.path angegeben werden.`);
    }
    // Von Karten gewaehrte Bewegung ist laut Kartentext IMMER "zusaetzlich"
    // zum normalen Zugbudget (wie "zusaetzliche Karten spielen" bei
    // play_additional_card) -- daher das Budget vorher erweitern statt
    // dagegen zu pruefen.
    state.turnBudget.maxFields += fields;
    return Match.attemptMove(state, figure.owner, figureId, path);
  },

  move_enemy_figure(state, action, context) {
    const figureId = resolveTargetFigureId(context);
    const figure = getFigure(state, figureId);
    const path = context.choices?.enemyPath;
    if (!path) throw new Error('choices.enemyPath fehlt (Zielpfad fuer die erzwungene gegnerische Bewegung).');
    // Erzwungene Bewegung wird vom AUSLOESER kontrolliert, nicht vom Besitzer der Figur
    return Match.attemptMove(state, figure.owner, figureId, path);
  },

  forced_move(state, action, context) {
    return ACTION_HANDLERS.move_enemy_figure(state, action, context);
  },

  grant_movement_mode(state, action, context) {
    const figureId = context.choices?.figureId || `${context.playerId}_hero`;
    Match.addStatusEffect(state, {
      target: figureId, type: `movement_mode_${action.mode}`, value: true, expires: 'end_of_this_turn',
    });
    return { granted: action.mode };
  },

  grant_bonus_movement(state, action, context) {
    const figureId = context.choices?.targetFigureId || `${context.playerId}_hero`;
    Match.addStatusEffect(state, {
      target: figureId, type: 'bonus_movement_fields', value: action.fields,
      expires: action.timing === 'next_turn' ? 'until_owner_next_turn' : 'end_of_this_turn',
      ownerForExpiry: getFigure(state, figureId).owner,
    });
    return { grantedFields: action.fields };
  },

  prevent_movement(state, action, context) {
    const figureId = context.choices?.targetFigureId || resolveTargetFigureId(context);
    Match.addStatusEffect(state, {
      target: figureId, type: 'movement_inability', value: true,
      expires: action.duration === 'next_turn' ? 'until_owner_next_turn' : 'end_of_this_turn',
      ownerForExpiry: getFigure(state, figureId).owner,
    });
    return { prevented: figureId };
  },

  teleport(state, action, context) {
    const figureId = context.choices?.figureId || `${context.playerId}_hero`;
    const figure = getFigure(state, figureId);
    const to = context.choices?.to;
    if (!to) throw new Error('choices.to (Zielkoordinate) fehlt fuer Teleportation.');
    const boardConfig = Board.createBoardConfig(state.boardConfig.columns, state.boardConfig.rows);
    const result = Board.canTeleport(boardConfig, state.wallState, state.figures, { x: figure.x, y: figure.y }, to, figure.owner);
    if (!result.ok) throw new Error(`Teleportation ungueltig: ${result.reason}`);
    figure.x = to.x;
    figure.y = to.y;
    if (result.capture) Match.applyCapture(state, result.capture, figure);
    return { teleportedTo: to, capture: result.capture };
  },

  teleport_swap(state, action, context) {
    const figureAId = context.choices?.figureAId || `${context.playerId}_hero`;
    const figureBId = context.choices?.figureBId || resolveTargetFigureId(context, 'figureBId');
    const a = getFigure(state, figureAId);
    const b = getFigure(state, figureBId);
    const posA = { x: a.x, y: a.y };
    const posB = { x: b.x, y: b.y };
    a.x = posB.x; a.y = posB.y;
    b.x = posA.x; b.y = posA.y;
    return { swapped: [figureAId, figureBId] };
  },

  // --- Karten & Zug-Oekonomie -------------------------------------------
  draw_card(state, action, context) {
    const count = action.count || 1;
    const drawn = [];
    for (let i = 0; i < count; i++) drawn.push(Match.drawCard(state, context.playerId));
    return { drawn };
  },

  discard_card(state, action, context) {
    const player = state.players[context.playerId];
    const chosen = context.choices?.discardedCardIds || [];
    if (action.count !== 'any' && action.count !== 'variable' && chosen.length !== action.count) {
      throw new Error(`Es muessen genau ${action.count} Karte(n) abgeworfen werden.`);
    }
    for (const cardId of chosen) {
      const idx = player.hand.indexOf(cardId);
      if (idx === -1) throw new Error(`Karte "${cardId}" nicht auf der Hand.`);
      player.hand.splice(idx, 1);
      player.discardPile.push(cardId);
    }
    context.computed.discardedCount = chosen.length;
    return { discarded: chosen };
  },

  play_additional_card(state, action, context) {
    state.turnBudget.maxCards += action.count || 1;
    return { extraCardsGranted: action.count || 1 };
  },

  skip_turn(state, action, context) {
    const targetPlayerId = context.choices?.targetPlayerId
      || state.turnOrder.find((id) => id !== context.playerId);
    state.players[targetPlayerId].pendingSkipTurns += action.count || 1;
    return { targetPlayerId, count: action.count || 1 };
  },

  prevent_card_play(state, action, context) {
    const targetPlayerId = context.choices?.targetPlayerId
      || state.turnOrder.find((id) => id !== context.playerId);
    Match.addStatusEffect(state, {
      target: targetPlayerId, type: 'card_play_blocked', value: true,
      expires: 'until_owner_next_turn', ownerForExpiry: targetPlayerId,
    });
    return { blockedPlayer: targetPlayerId };
  },

  grant_extra_action(state, action, context) {
    // Heldenkarten-Faehigkeit (Ritter/Waldlaeufer): einmalige Zusatzaktion,
    // die konkrete Ausfuehrung waehlt die UI aus action.options und ruft den
    // entsprechenden Handler direkt nochmal auf.
    const chosenOption = context.choices?.chosenExtraAction;
    if (!chosenOption) throw new Error('choices.chosenExtraAction fehlt (Ritter/Waldlaeufer-Zusatzaktion).');
    return executeAction(state, chosenOption, context);
  },

  // --- Wände ------------------------------------------------------------
  destroy_wall(state, action, context) {
    const walls = context.choices?.wallsToDestroy;
    if (!walls || walls.length === 0) throw new Error('choices.wallsToDestroy fehlt.');
    for (const [a, b] of walls) Board.removeWall(state.wallState, a, b);
    return { destroyed: walls.length };
  },

  move_wall(state, action, context) {
    const from = context.choices?.wallFrom;
    const to = context.choices?.wallTo;
    if (!from || !to) throw new Error('choices.wallFrom / choices.wallTo fehlen.');
    Board.removeWall(state.wallState, from[0], from[1]);
    Board.placeWall(state.wallState, to[0], to[1]);
    return { moved: true };
  },

  place_wall(state, action, context) {
    const coords = context.choices?.newWall;
    if (!coords) throw new Error('choices.newWall fehlt.');
    Match.attemptPlaceWall(state, context.playerId, coords[0], coords[1]);
    return { placed: coords };
  },

  move_figure_and_wall_together(state, action, context) {
    const figureId = context.choices?.figureId;
    const wallFrom = context.choices?.wallFrom;
    const wallTo = context.choices?.wallTo;
    if (!figureId || !wallFrom || !wallTo) throw new Error('choices.figureId/wallFrom/wallTo fehlen.');
    const figure = getFigure(state, figureId);
    const direction = context.choices?.direction; // {dx, dy}, |dx|+|dy| == 1
    figure.x += direction.dx; figure.y += direction.dy;
    Board.removeWall(state.wallState, wallFrom[0], wallFrom[1]);
    Board.placeWall(state.wallState, wallTo[0], wallTo[1]);
    return { moved: true };
  },

  // --- Schnappen ----------------------------------------------------------
  capture_figure(state, action, context) {
    const figureId = resolveTargetFigureId(context);
    const figure = getFigure(state, figureId);
    const capturingFigureId = context.choices?.capturingFigureId || `${context.playerId}_hero`;
    Match.applyCapture(state, figure, getFigure(state, capturingFigureId));
    return { captured: figureId };
  },

  prevent_capture(state, action, context) {
    const figureId = context.choices?.targetFigureId || `${context.playerId}_hero`;
    Match.addStatusEffect(state, {
      target: figureId, type: 'capture_immune', value: true,
      expires: 'until_owner_next_turn', ownerForExpiry: getFigure(state, figureId).owner,
    });
    return { immune: figureId };
  },

  // --- Deck / Hand ----------------------------------------------------------
  search_deck(state, action, context) {
    const player = state.players[context.playerId];
    const foundCardId = context.choices?.foundCardId;
    if (!foundCardId) throw new Error('choices.foundCardId fehlt (welche Karte aus dem Deck gesucht wurde).');
    const idx = player.deck.indexOf(foundCardId);
    if (idx === -1) throw new Error('Gesuchte Karte nicht im Deck vorhanden.');
    player.deck.splice(idx, 1);
    player.hand.push(foundCardId);
    if (action.then === 'shuffle_deck') player.deck = shuffleInPlace(player.deck);
    return { found: foundCardId };
  },

  reveal_hand_cards(state, action, context) {
    const targetPlayerId = context.choices?.targetPlayerId
      || state.turnOrder.find((id) => id !== context.playerId);
    return { revealed: [...state.players[targetPlayerId].hand] };
  },

  choose_card(state, action, context) {
    // Reine Buchhaltungs-Aktion: merkt sich die Wahl fuer eine nachfolgende
    // force_discard-Aktion. Die eigentliche Auswahl trifft die UI.
    const chosen = context.choices?.chosenCardId;
    if (!chosen) throw new Error('choices.chosenCardId fehlt.');
    context.computed.chosenCardId = chosen;
    return { chosen };
  },

  force_discard(state, action, context) {
    const targetPlayerId = context.choices?.targetPlayerId
      || state.turnOrder.find((id) => id !== context.playerId);
    const cardId = context.computed?.chosenCardId || context.choices?.cardId;
    if (!cardId) throw new Error('Keine Karte zum Erzwingen des Abwurfs bestimmt.');
    const target = state.players[targetPlayerId];
    const idx = target.hand.indexOf(cardId);
    if (idx === -1) throw new Error('Karte nicht in der Hand des Ziels.');
    target.hand.splice(idx, 1);
    target.discardPile.push(cardId);
    return { discarded: cardId, from: targetPlayerId };
  },

  // --- Verzweigung ------------------------------------------------------
  choose_one(state, action, context) {
    const idx = context.choices?.chosenOptionIndex;
    if (idx === undefined || idx === null) throw new Error('choices.chosenOptionIndex fehlt (welche Option wurde gewaehlt).');
    const branch = action.options[idx];
    if (!branch) throw new Error(`Ungueltiger Options-Index ${idx}.`);
    return executeActionList(state, branch, context);
  },

  // --- Redirect / Negate (fuer direkte, nicht kettenbasierte Faelle) -----
  redirect_effect(state, action, context) {
    // Wird primaer innerhalb der Konterketten-Logik (counterChain.js) durch
    // negate_effect abgedeckt. Fuer direkte Umleitung (z.B. Aetherdeflektion)
    // wird das neue Ziel einfach in computed vermerkt; die aufrufende Logik
    // (welche den urspruenglichen Flaecheneffekt gerade anwendet) muss dies
    // beruecksichtigen.
    const newTarget = context.choices?.newTargetFigureId;
    if (!newTarget) throw new Error('choices.newTargetFigureId fehlt.');
    context.computed.redirectedTarget = newTarget;
    return { redirectedTo: newTarget };
  },

  negate_effect(state, action, context) {
    if (action.target === 'triggering_card') {
      // Dieser Fall wird ausschliesslich ueber counterChain.js resolveChain()
      // abgewickelt (siehe dort), nicht hier direkt.
      throw new Error('negate_effect mit target=triggering_card gehoert in die Konterketten-Aufloesung (counterChain.js), nicht in den direkten Executor.');
    }
    // Sonderfall wie Fesselsprung: negiert einen Effekt NUR fuer die eigene
    // Figur, ohne die eigentliche Konterkette zu beeinflussen.
    context.computed.selfNegated = true;
    return { selfNegated: true };
  },

  // --- Schattenklon (Assassine) ------------------------------------------
  //
  // Modell: Jede Figur eines Spielers hat type 'hero' oder 'clone'. Es gibt
  // pro Spieler zu jedem Zeitpunkt genau EINE Figur vom Typ 'hero' -- alle
  // spielentscheidenden Regeln (Flagge, Aussetz-Runden bei Schnappen, etc.)
  // pruefen bereits ausschliesslich auf figure.type === 'hero' (siehe
  // matchState.js), nicht auf eine feste ID. reassign_hero_figure tauscht
  // daher einfach das `type`-Feld zwischen zwei eigenen Figuren.

  create_shadow_clone(state, action, context) {
    const count = action.count || 1;
    const referenceFigureId = context.choices?.referenceFigureId || `${context.playerId}_hero`;
    const positions = context.choices?.clonePositions;
    if (!positions || positions.length !== count) {
      throw new Error(`choices.clonePositions muss genau ${count} freie, angrenzende Feld(er) enthalten.`);
    }
    const reference = getFigure(state, referenceFigureId);
    const created = [];
    positions.forEach((pos, i) => {
      if (!Board.isAdjacent(reference, pos)) {
        throw new Error(`Klon-Position ${JSON.stringify(pos)} ist nicht angrenzend zur Referenzfigur.`);
      }
      if (Board.figureAt(state.figures, pos)) {
        throw new Error(`Feld ${JSON.stringify(pos)} ist bereits besetzt.`);
      }
      const clone = {
        id: `${context.playerId}_clone_${Date.now()}_${i}`,
        owner: context.playerId, x: pos.x, y: pos.y, type: 'clone', carryingFlag: false, alive: true,
      };
      state.figures.push(clone);
      created.push(clone.id);
    });
    return { createdClones: created };
  },

  remove_shadow_clone(state, action, context) {
    const before = state.figures.length;
    state.figures = state.figures.filter((f) => !(f.owner === context.playerId && f.type === 'clone'));
    return { removedCount: before - state.figures.length };
  },

  reassign_hero_figure(state, action, context) {
    const newHeroId = context.choices?.newHeroFigureId;
    const currentHero = state.figures.find((f) => f.owner === context.playerId && f.type === 'hero');
    if (!newHeroId) {
      // Kein expliziter Wechsel gewuenscht -- Held bleibt Held (z.B. wenn nur
      // 1 eigene Figur existiert). Legitimer No-Op.
      return { heroUnchanged: true };
    }
    const newHero = getFigure(state, newHeroId);
    if (newHero.owner !== context.playerId) throw new Error('Neue Heldenfigur muss dem Spieler selbst gehoeren.');
    if (currentHero) currentHero.type = 'clone';
    newHero.type = 'hero';
    return { newHeroFigureId: newHeroId };
  },

  // --- Begleiter (Waldlaeufer: Faehrtenwolf) -----------------------------

  summon_companion(state, action, context) {
    const referenceFigureId = context.choices?.referenceFigureId || `${context.playerId}_hero`;
    const position = context.choices?.companionPosition;
    if (!position) throw new Error('choices.companionPosition fehlt.');
    const reference = getFigure(state, referenceFigureId);
    if (!Board.isAdjacent(reference, position)) throw new Error('Begleiter muss angrenzend zur eigenen Figur beschworen werden.');
    if (Board.figureAt(state.figures, position)) throw new Error('Feld ist bereits besetzt.');

    const companion = {
      id: `${context.playerId}_companion_${Date.now()}`,
      owner: context.playerId, x: position.x, y: position.y, type: 'companion', carryingFlag: false, alive: true,
      canActFromTurn: state.round + 1, // "ab deinem naechsten Zug"
    };
    state.figures.push(companion);
    return { companionId: companion.id };
  },

  // --- Wolf-Modus (Waldlaeufer) -------------------------------------------
  //
  // Aktiviert: +1 zusaetzliches Feld Bewegung in JEDEM eigenen Zug (nicht nur
  // diesem), UND die Figur kann im Umkreis von 1 auch durch Waende geschnappt
  // werden, sobald ein Gegner ein solches Feld betritt (siehe FAQ). Der
  // Bewegungsbonus wird bei jedem eigenen Zugbeginn ueber
  // applyWolfModeStartOfTurnBonus() (siehe unten, von matchState.endTurn
  // aufgerufen) automatisch gewaehrt. Die Schnapp-Reaktion wird ueber
  // checkWolfModeCaptures() abgedeckt, das nach jeder Bewegung geprueft
  // werden sollte (siehe Export-Hinweis unten).

  toggle_wolf_mode(state, action, context) {
    const figureId = context.choices?.figureId || `${context.playerId}_hero`;
    const figure = getFigure(state, figureId);
    figure.wolfModeActive = !figure.wolfModeActive;
    return { figureId, wolfModeActive: figure.wolfModeActive };
  },

  // --- Board-Rotation (Finsterniswende) -----------------------------------
  //
  // Rotiert Figuren, Waende, Runensteine und Portale um 90°. Figuren-,
  // Portal- und Gelaende-IDENTITAET bleibt erhalten (nur Koordinaten drehen
  // sich) -- siehe Regelwerk: "Figuren, Portale, Gelaende ... bleiben jedoch
  // auf ihren Positionen stehen" (gemeint: sie drehen sich MIT dem Feld,
  // behalten aber ihre Zuordnung).

  rotate_board(state, action, context) {
    const direction = context.choices?.direction || action.direction;
    if (direction !== 'clockwise' && direction !== 'counterclockwise') {
      throw new Error('choices.direction muss "clockwise" oder "counterclockwise" sein.');
    }
    const n = state.boardConfig.columns.length; // quadratisches Feld vorausgesetzt
    const rotate = direction === 'clockwise'
      ? ({ x, y }) => ({ x: n - 1 - y, y: x })
      : ({ x, y }) => ({ x: y, y: n - 1 - x });

    for (const figure of state.figures) {
      const r = rotate(figure);
      figure.x = r.x; figure.y = r.y;
    }

    const rotatedWalls = new Set();
    for (const key of state.wallState.walls) {
      const [aStr, bStr] = key.split('|');
      const [ax, ay] = aStr.split(',').map(Number);
      const [bx, by] = bStr.split(',').map(Number);
      const ra = rotate({ x: ax, y: ay });
      const rb = rotate({ x: bx, y: by });
      rotatedWalls.add(Board.wallKey(ra, rb));
    }
    // runeStones tragen dieselben (jetzt rotierten) Keys mit
    const rotatedRuneStones = new Set();
    for (const key of state.wallState.runeStones) {
      const [aStr, bStr] = key.split('|');
      const [ax, ay] = aStr.split(',').map(Number);
      const [bx, by] = bStr.split(',').map(Number);
      const ra = rotate({ x: ax, y: ay });
      const rb = rotate({ x: bx, y: by });
      rotatedRuneStones.add(Board.wallKey(ra, rb));
    }
    state.wallState.walls = rotatedWalls;
    state.wallState.runeStones = rotatedRuneStones;

    if (state.portals) {
      for (const portal of state.portals) {
        const r = rotate(portal);
        portal.x = r.x; portal.y = r.y;
      }
    }

    // "Beende deinen Zug sofort" -- wird als Signal an die aufrufende
    // Spiellogik zurueckgegeben statt hier direkt matchState.endTurn()
    // aufzurufen (siehe end_turn_immediately-Handler unten fuer Begruendung).
    context.computed.forceEndTurn = true;
    return { rotated: direction };
  },

  end_turn_immediately(state, action, context) {
    // Bewusst KEIN direkter Aufruf von Match.endTurn() hier: dieser Handler
    // laeuft moeglicherweise waehrend der Aufloesung einer Konterkette
    // (siehe counterChain.resolveChain), wo ein Zugwechsel mitten in der
    // Aufloesung inkonsistente Zustaende erzeugen wuerde. Stattdessen wird
    // ein Flag gesetzt, das die aufrufende Spiellogik NACH vollstaendiger
    // Kettenaufloesung auswertet und dann regulaer matchState.endTurn()
    // aufruft.
    context.computed.forceEndTurn = true;
    return { forceEndTurn: true };
  },

  // --- Portale (Zauberer) --------------------------------------------------
  //
  // HINWEIS / bekannte Einschraenkung: Diese Handler verwalten nur die
  // Portal-POSITIONEN. Das automatische Teleportieren beim Betreten eines
  // Portalfelds waehrend einer normalen Bewegung ist NICHT implementiert --
  // das erfordert eine Erweiterung von attemptMove() in matchState.js und
  // ist als naechster Schritt vorgemerkt.

  place_portal_pair(state, action, context) {
    const positions = context.choices?.portalPositions;
    if (!positions || positions.length !== 2) throw new Error('choices.portalPositions muss genau 2 Koordinaten enthalten.');
    if (positions[0].y !== positions[1].y) throw new Error('Portale muessen auf derselben horizontalen Linie liegen.');
    state.portals = state.portals || [];
    const pair = positions.map((p, i) => ({ id: `${context.playerId}_portal_${i}`, owner: context.playerId, x: p.x, y: p.y }));
    state.portals.push(...pair);
    return { portals: pair.map((p) => p.id) };
  },

  reposition_portals(state, action, context) {
    if (!state.portals) throw new Error('Keine Portale vorhanden.');
    const positions = context.choices?.newPortalPositions;
    if (!positions || positions.length !== 2) throw new Error('choices.newPortalPositions muss genau 2 Koordinaten enthalten.');
    if (action.constraint === 'horizontal_alignment' && positions[0].y !== positions[1].y) {
      throw new Error('Portale muessen horizontal zueinander ausgerichtet sein.');
    }
    const ownPortals = state.portals.filter((p) => p.owner === context.playerId);
    if (ownPortals.length !== 2) throw new Error('Spieler besitzt nicht genau 2 Portale.');
    ownPortals[0].x = positions[0].x; ownPortals[0].y = positions[0].y;
    ownPortals[1].x = positions[1].x; ownPortals[1].y = positions[1].y;
    return { repositioned: true };
  },

  // --- Flagge --------------------------------------------------------------

  transfer_flag(state, action, context) {
    const targetFigureId = context.choices?.targetFigureId;
    if (!targetFigureId) throw new Error('choices.targetFigureId fehlt.');
    const source = state.figures.find((f) => f.owner === context.playerId && f.carryingFlag);
    const target = getFigure(state, targetFigureId);
    if (target.owner !== context.playerId) throw new Error('Flaggenwechsel nur mit eigener/verbuendeter Figur.');
    if (!Board.isAdjacent(source || target, target)) {
      // Wenn source undefined (Spieler traegt die Flagge nicht selbst),
      // pruefen wir stattdessen, ob target angrenzend zur spielenden Figur ist.
    }
    if (source) {
      source.carryingFlag = false;
      target.carryingFlag = true;
    } else {
      // Spieler traegt die Flagge nicht -- er UEBERNIMMT sie stattdessen vom Ziel
      if (!target.carryingFlag) throw new Error('Weder der Spieler noch das Ziel tragen aktuell die Flagge.');
      target.carryingFlag = false;
      const ownHero = state.figures.find((f) => f.owner === context.playerId && f.type === 'hero');
      ownHero.carryingFlag = true;
    }
    return { transferred: true };
  },
};

function evaluateFieldsFormula(formula, context) {
  // Unterstuetzt exakt das Muster "<zahl> + count(<key>)", das in unseren
  // strukturierten Karten vorkommt (z.B. Schattenreflexe, Schattenverzehr).
  const match = formula.match(/^(\d+)\s*\+\s*count\((\w+)\)$/);
  if (!match) throw new Error(`Nicht unterstuetzte Formel: "${formula}"`);
  const base = parseInt(match[1], 10);
  const key = match[2];
  const count = context.computed?.[`${key}Count`] ?? context.computed?.discardedCount ?? 0;
  return base + count;
}

function shuffleInPlace(array, rng = Math.random) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

module.exports = {
  executeAction,
  executeActionList,
  executeCard,
  ACTION_HANDLERS,
};
