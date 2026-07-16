// engine/board.js
//
// Fundament der Regel-Engine: Spielfeld-Repraesentation, Distanz/Umkreis,
// Wand-Kollision, Bewegungs- und Sichtlinien-Validierung, Teleportation.
//
// Basiert 1:1 auf den offiziellen Regeln (Rule-Entity, Stand Juli 2026):
// - Umkreis/Distanz: Chebyshev-System
// - Angrenzend = Distanz 1 (inkl. diagonal), gilt AUCH durch Waende
// - Standardbewegung ist NUR gerade (horizontal/vertikal), NICHT diagonal.
//   Diagonale Bewegung muss explizit durch einen Karteneffekt gewaehrt werden.
// - Gerade Bewegung wird durch 1 Wand vollstaendig blockiert.
// - Diagonale Bewegung wird erst durch 2 Waende (beide angrenzenden Kanten)
//   blockiert. Bei nur 1 Wand bleibt sowohl Diagonalbewegung als auch freie
//   Sichtlinie erhalten.
// - Teleportation ignoriert Waende grundsaetzlich (Ausnahme: Runenstein der
//   Bindung -- blockiert gerade Teleportation; 2 Runensteine noetig, um eine
//   diagonale Teleportation zu blockieren).
// - Ein Feld gilt sowohl durch Bewegung als auch durch Teleportation als
//   "betreten" (relevant fuer Fallen/Konter-Trigger).
//
// ANNAHME (nicht explizit im Regelwerk-Text gefunden, bitte mit Patrick/Sandro
// gegenchecken): Bei einer mehrfeldrigen geraden Bewegung in einer Aktion
// muessen alle Zwischenfelder frei sein; ein Schnappen (Erobern) ist nur auf
// dem finalen Zielfeld moeglich, nicht "im Vorbeigehen".

// ---------------------------------------------------------------------------
// Koordinaten
// ---------------------------------------------------------------------------

/**
 * Erstellt ein Board-Konfigurationsobjekt.
 * columns: Array von Spalten-Labels in Reihenfolge, z.B. ['A','B','C','D','E','F','G','H']
 * rows: Array von Zeilen-Labels in Reihenfolge, z.B. ['1','2',...,'8'] oder ['0',...,'9']
 *
 * Das deckt sowohl das 8x8-1v1-Feld (Spalten A-H, Zeilen 1-8) als auch das
 * 10x10-Team-Feld (Spalten Z,A-I, Zeilen 0-9) ab, ohne die Groesse hart zu
 * kodieren.
 */
function createBoardConfig(columns, rows) {
  const colIndex = new Map(columns.map((c, i) => [c, i]));
  const rowIndex = new Map(rows.map((r, i) => [r, i]));
  return { columns, rows, colIndex, rowIndex, width: columns.length, height: rows.length };
}

// Standard 8x8-Feld fuer 1v1 (Spalten A-H, Zeilen 1-8)
const STANDARD_1V1_BOARD = createBoardConfig(
  ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'],
  ['1', '2', '3', '4', '5', '6', '7', '8']
);

// Offizielles 10x10-Team-/KOTH-/Arena-Feld (Spalten Z,A-I, Zeilen 0-9)
const STANDARD_TEAM_BOARD = createBoardConfig(
  ['Z', 'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I'],
  ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9']
);

/** Wandelt ein Koordinaten-Label wie "D1" in {x, y} um (0-indiziert). */
function parseCoord(boardConfig, label) {
  const colLabel = label[0];
  const rowLabel = label.slice(1);
  const x = boardConfig.colIndex.get(colLabel);
  const y = boardConfig.rowIndex.get(rowLabel);
  if (x === undefined || y === undefined) {
    throw new Error(`Ungueltige Koordinate "${label}" fuer dieses Spielfeld.`);
  }
  return { x, y };
}

/** Wandelt {x, y} zurueck in ein Koordinaten-Label wie "D1". */
function coordToLabel(boardConfig, { x, y }) {
  return boardConfig.columns[x] + boardConfig.rows[y];
}

function isInBounds(boardConfig, { x, y }) {
  return x >= 0 && x < boardConfig.width && y >= 0 && y < boardConfig.height;
}

// ---------------------------------------------------------------------------
// Distanz & Umkreis (Chebyshev-System, offiziell bestaetigt)
// ---------------------------------------------------------------------------

function chebyshevDistance(a, b) {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

/** Angrenzend = Distanz genau 1 (inkl. diagonal). Gilt auch durch Waende. */
function isAdjacent(a, b) {
  return chebyshevDistance(a, b) === 1;
}

/** Alle Feld-Koordinaten im Umkreis von `radius` um `center` (inkl. center selbst). */
function getFieldsInRadius(boardConfig, center, radius) {
  const result = [];
  for (let dx = -radius; dx <= radius; dx++) {
    for (let dy = -radius; dy <= radius; dy++) {
      const field = { x: center.x + dx, y: center.y + dy };
      if (isInBounds(boardConfig, field) && chebyshevDistance(center, field) <= radius) {
        result.push(field);
      }
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Waende
// ---------------------------------------------------------------------------
//
// Eine Wand sitzt auf der Kante zwischen zwei orthogonal benachbarten Feldern.
// Repraesentation: kanonischer String-Key aus den beiden Feld-Labels,
// alphabetisch/positionell sortiert, damit (a,b) und (b,a) denselben Key ergeben.

function wallKey(a, b) {
  const keyA = `${a.x},${a.y}`;
  const keyB = `${b.x},${b.y}`;
  return keyA < keyB ? `${keyA}|${keyB}` : `${keyB}|${keyA}`;
}

/**
 * Erstellt ein leeres Wand-Set (Spielzustand). `runeStones` ist ein separates
 * Set von wallKeys, auf denen zusaetzlich ein Runenstein der Bindung liegt.
 */
function createWallState() {
  return { walls: new Set(), runeStones: new Set() };
}

function placeWall(wallState, a, b) {
  wallState.walls.add(wallKey(a, b));
}

function removeWall(wallState, a, b) {
  const key = wallKey(a, b);
  wallState.walls.delete(key);
  wallState.runeStones.delete(key);
}

function hasWallBetween(wallState, a, b) {
  return wallState.walls.has(wallKey(a, b));
}

function hasRuneStoneOnWall(wallState, a, b) {
  return wallState.runeStones.has(wallKey(a, b));
}

// ---------------------------------------------------------------------------
// Figuren / Spielzustand (minimal, fuer Bewegungspruefung ausreichend)
// ---------------------------------------------------------------------------
//
// figures: Array von { id, owner, x, y, type: 'hero'|'clone'|'companion' }

function figureAt(figures, coord) {
  return figures.find((f) => f.x === coord.x && f.y === coord.y) || null;
}

function getFiguresInRadiusOf(boardConfig, figures, center, radius) {
  const fields = new Set(getFieldsInRadius(boardConfig, center, radius).map((f) => `${f.x},${f.y}`));
  return figures.filter((f) => fields.has(`${f.x},${f.y}`));
}

// ---------------------------------------------------------------------------
// Gerade Bewegung (horizontal/vertikal, wie ein Turm im Schach)
// ---------------------------------------------------------------------------

const STRAIGHT_DIRECTIONS = [
  { dx: 1, dy: 0 }, { dx: -1, dy: 0 }, { dx: 0, dy: 1 }, { dx: 0, dy: -1 },
];

const DIAGONAL_DIRECTIONS = [
  { dx: 1, dy: 1 }, { dx: 1, dy: -1 }, { dx: -1, dy: 1 }, { dx: -1, dy: -1 },
];

/**
 * Prueft, ob ein einzelner gerader Schritt von `from` nach `to` moeglich ist:
 * orthogonal benachbart, keine Wand dazwischen, Zielfeld nicht von einer
 * eigenen/verbuendeten Figur besetzt (Betreten durch Verbuendete ist nicht
 * erlaubt, siehe FAQ).
 */
function canStepStraight(boardConfig, wallState, figures, from, to, movingFigureOwner) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const isOrthogonalStep = (Math.abs(dx) === 1 && dy === 0) || (dx === 0 && Math.abs(dy) === 1);
  if (!isOrthogonalStep) return { ok: false, reason: 'not_orthogonal_single_step' };
  if (!isInBounds(boardConfig, to)) return { ok: false, reason: 'out_of_bounds' };
  if (hasWallBetween(wallState, from, to)) return { ok: false, reason: 'blocked_by_wall' };

  const occupant = figureAt(figures, to);
  if (occupant && occupant.owner === movingFigureOwner) {
    return { ok: false, reason: 'occupied_by_ally' };
  }
  return { ok: true, capture: occupant ? occupant : null };
}

/**
 * Prueft eine komplette gerade Bewegung ueber mehrere Felder (eine Aktion,
 * ggf. Teil einer aufgeteilten Bewegung). `path` ist eine Liste von
 * Zwischen- und Zielkoordinaten in Reihenfolge, jede orthogonal an die
 * vorherige angrenzend.
 *
 * Annahme: nur das LETZTE Feld im Pfad darf eine gegnerische Figur enthalten
 * (Schnappen). Alle Zwischenfelder muessen frei sein. Siehe Kommentar oben.
 */
function validateStraightPath(boardConfig, wallState, figures, from, path, movingFigureOwner) {
  let current = from;
  for (let i = 0; i < path.length; i++) {
    const next = path[i];
    const isLastStep = i === path.length - 1;
    const stepCheck = canStepStraight(boardConfig, wallState, figures, current, next, movingFigureOwner);
    if (!stepCheck.ok) {
      return { valid: false, reason: stepCheck.reason, failedAt: next };
    }
    if (stepCheck.capture && !isLastStep) {
      return { valid: false, reason: 'cannot_pass_through_occupied_field', failedAt: next };
    }
    current = next;
  }
  const finalCheck = canStepStraight(
    boardConfig, wallState, figures, path.length > 1 ? path[path.length - 2] : from,
    path[path.length - 1], movingFigureOwner
  );
  return { valid: true, capture: finalCheck.capture };
}

// ---------------------------------------------------------------------------
// Diagonale Bewegung (nur wenn explizit durch Karteneffekt gewaehrt)
// ---------------------------------------------------------------------------
//
// Regel: Diagonale Bewegung wird erst durch ZWEI Waende blockiert (die beiden
// Kanten, die die Diagonale "einrahmen"). Bei nur 1 Wand bleibt der Weg frei.

function getDiagonalFlankingWalls(from, to) {
  // Fuer einen Diagonalschritt von (x,y) nach (x+1,y+1) sind die beiden
  // "einrahmenden" orthogonalen Kanten: (x,y)-(x+1,y) und (x,y)-(x,y+1)
  const corner1 = { x: to.x, y: from.y };
  const corner2 = { x: from.x, y: to.y };
  return [
    [from, corner1], [corner1, to],
    [from, corner2], [corner2, to],
  ];
}

function canStepDiagonal(boardConfig, wallState, figures, from, to, movingFigureOwner) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const isDiagonalStep = Math.abs(dx) === 1 && Math.abs(dy) === 1;
  if (!isDiagonalStep) return { ok: false, reason: 'not_diagonal_single_step' };
  if (!isInBounds(boardConfig, to)) return { ok: false, reason: 'out_of_bounds' };

  // Die zwei relevanten "Rahmen"-Kanten pruefen (nicht alle 4 Hilfspaare oben,
  // sondern konkret die beiden Kanten des Diagonal-Quadrats)
  const corner1 = { x: to.x, y: from.y };
  const corner2 = { x: from.x, y: to.y };
  const wallA = hasWallBetween(wallState, from, corner1) && hasWallBetween(wallState, corner1, to);
  const wallB = hasWallBetween(wallState, from, corner2) && hasWallBetween(wallState, corner2, to);
  // Regelwerk: 2 Waende noetig um zu blockieren -> geblockt, wenn EINE der
  // beiden vollstaendigen "Umwege" UND der direkte Fall durch beide Kanten
  // versperrt sind. Praktisch bedeutet "2 Waende im Weg" laut Bildbeschreibung:
  // beide Kanten rund um die Diagonale sind vermauert.
  const bothEdgesWalled =
    hasWallBetween(wallState, from, corner1) && hasWallBetween(wallState, from, corner2);
  if (bothEdgesWalled) {
    return { ok: false, reason: 'blocked_by_two_walls' };
  }

  const occupant = figureAt(figures, to);
  if (occupant && occupant.owner === movingFigureOwner) {
    return { ok: false, reason: 'occupied_by_ally' };
  }
  return { ok: true, capture: occupant || null };
}

// ---------------------------------------------------------------------------
// Sichtlinie (fuer Konter-Trigger wie "betritt Feld in freier gerader
// Sichtlinie" und Karten wie Bruchschuss)
// ---------------------------------------------------------------------------

/**
 * Liefert alle Felder entlang einer geraden Richtung ab `from`, bis zum
 * Spielfeldrand oder bis eine Wand den Weg versperrt (die Wand selbst
 * blockiert die Sicht dahinter). `includeBlockingWall` gibt an, ob das
 * Feld hinter der ersten Wand noch mitgezaehlt wird (nein, per Definition).
 */
function getStraightLineOfSight(boardConfig, wallState, from, direction, maxDistance = Infinity) {
  const fields = [];
  let current = from;
  let steps = 0;
  while (steps < maxDistance) {
    const next = { x: current.x + direction.dx, y: current.y + direction.dy };
    if (!isInBounds(boardConfig, next)) break;
    if (hasWallBetween(wallState, current, next)) break;
    fields.push(next);
    current = next;
    steps++;
  }
  return fields;
}

/** Prueft, ob zwischen a und b eine freie gerade Sichtlinie besteht (Turm-Linie). */
function hasStraightLineOfSight(boardConfig, wallState, a, b) {
  if (a.x !== b.x && a.y !== b.y) return false; // nicht auf einer geraden Linie
  const dx = Math.sign(b.x - a.x);
  const dy = Math.sign(b.y - a.y);
  const distance = chebyshevDistance(a, b);
  const line = getStraightLineOfSight(boardConfig, wallState, a, { dx, dy }, distance);
  return line.length === distance && line[line.length - 1].x === b.x && line[line.length - 1].y === b.y;
}

// ---------------------------------------------------------------------------
// Teleportation
// ---------------------------------------------------------------------------
//
// Ignoriert Waende grundsaetzlich. Ausnahme: Runenstein der Bindung.
// - Gerade Teleportation wird durch 1 Runenstein auf einer Wand im Pfad blockiert.
// - Diagonale Teleportation braucht 2 Runensteine im Pfad, um blockiert zu werden.
//
// Vereinfachung: Wir pruefen nur, ob eine Wand mit Runenstein GENAU zwischen
// Start und Ziel liegt (bei Distanz 1). Fuer Teleportation ueber mehrere
// Felder muesste der komplette gedachte Pfad prognostiziert werden -- das ist
// spielregeltechnisch selten relevant (Teleport-Ziel wird von der Karte
// vorgegeben, nicht der Weg), daher hier bewusst auf den direkten
// Nachbarschaftsfall beschraenkt und im Zweifel manuell zu pruefen.

function canTeleport(boardConfig, wallState, figures, from, to, movingFigureOwner) {
  if (!isInBounds(boardConfig, to)) return { ok: false, reason: 'out_of_bounds' };

  const occupant = figureAt(figures, to);
  if (occupant && occupant.owner === movingFigureOwner) {
    return { ok: false, reason: 'occupied_by_ally' };
  }

  if (isAdjacent(from, to)) {
    const dx = Math.sign(to.x - from.x);
    const dy = Math.sign(to.y - from.y);
    const isDiagonal = dx !== 0 && dy !== 0;

    if (!isDiagonal && hasWallBetween(wallState, from, to) && hasRuneStoneOnWall(wallState, from, to)) {
      return { ok: false, reason: 'blocked_by_rune_stone' };
    }
    if (isDiagonal) {
      const corner1 = { x: to.x, y: from.y };
      const corner2 = { x: from.x, y: to.y };
      const runeA = hasRuneStoneOnWall(wallState, from, corner1) && hasWallBetween(wallState, from, corner1);
      const runeB = hasRuneStoneOnWall(wallState, from, corner2) && hasWallBetween(wallState, from, corner2);
      if (runeA && runeB) {
        return { ok: false, reason: 'blocked_by_two_rune_stones' };
      }
    }
  }

  return { ok: true, capture: occupant || null };
}

// ---------------------------------------------------------------------------
// Wandplatzierung: Nord-Sued-Pfad darf nie vollstaendig geschlossen werden
// ---------------------------------------------------------------------------

/**
 * Prueft per Flood-Fill, ob nach dem (hypothetischen) Hinzufuegen einer Wand
 * weiterhin mindestens ein Pfad von der Nordkante (y=0) zur Suedkante
 * (y=height-1) existiert.
 */
function wouldWallBlockNorthSouthPath(boardConfig, wallState, newWallA, newWallB) {
  const testWalls = new Set(wallState.walls);
  testWalls.add(wallKey(newWallA, newWallB));

  const visited = new Set();
  const queue = [];
  for (let x = 0; x < boardConfig.width; x++) {
    queue.push({ x, y: 0 });
    visited.add(`${x},0`);
  }

  while (queue.length > 0) {
    const cur = queue.shift();
    if (cur.y === boardConfig.height - 1) {
      return false; // Suedkante erreicht -> Pfad existiert, Wand ist erlaubt
    }
    for (const dir of STRAIGHT_DIRECTIONS) {
      const next = { x: cur.x + dir.dx, y: cur.y + dir.dy };
      const key = `${next.x},${next.y}`;
      if (!isInBounds(boardConfig, next) || visited.has(key)) continue;
      if (testWalls.has(wallKey(cur, next))) continue;
      visited.add(key);
      queue.push(next);
    }
  }
  return true; // Suedkante nicht erreichbar -> Wand wuerde den Weg vollstaendig schliessen
}

module.exports = {
  createBoardConfig, STANDARD_1V1_BOARD, STANDARD_TEAM_BOARD,
  parseCoord, coordToLabel, isInBounds,
  chebyshevDistance, isAdjacent, getFieldsInRadius,
  createWallState, placeWall, removeWall, hasWallBetween, hasRuneStoneOnWall,
  figureAt, getFiguresInRadiusOf,
  STRAIGHT_DIRECTIONS, DIAGONAL_DIRECTIONS,
  canStepStraight, validateStraightPath,
  canStepDiagonal,
  getStraightLineOfSight, hasStraightLineOfSight,
  canTeleport,
  wouldWallBlockNorthSouthPath,
};
