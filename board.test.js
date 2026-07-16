// engine/board.test.js
//
// Testet das Bewegungs-Fundament gegen konkrete Beispiele aus dem
// offiziellen Regelwerk. Ausfuehren mit: node engine/board.test.js

const B = require('./board.js');

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

const board = B.STANDARD_1V1_BOARD;

// ---------------------------------------------------------------------------
section('Koordinaten-Parsing');
// ---------------------------------------------------------------------------
{
  const d1 = B.parseCoord(board, 'D1');
  const e8 = B.parseCoord(board, 'E8');
  check('D1 -> {x:3, y:0}', d1.x === 3 && d1.y === 0);
  check('E8 -> {x:4, y:7}', e8.x === 4 && e8.y === 7);
  check('Rueckwandlung D1', B.coordToLabel(board, d1) === 'D1');
}

// ---------------------------------------------------------------------------
section('Chebyshev-Distanz & Umkreis (offiziell bestaetigtes System)');
// ---------------------------------------------------------------------------
{
  const center = B.parseCoord(board, 'D4');
  // "Umkreis von 2 Feldern bedeutet: das Feld selbst + alle Felder in Entfernung 1 und 2"
  const within2 = B.getFieldsInRadius(board, center, 2);
  check('Umkreis 2 um D4 enthaelt 25 Felder (5x5, alles im Feld)', within2.length === 25);

  const c3 = B.parseCoord(board, 'C3'); // diagonal 1 Feld entfernt
  check('C3 ist angrenzend zu D4 (Chebyshev, inkl. diagonal)', B.isAdjacent(center, c3));

  const f6 = B.parseCoord(board, 'F6'); // 2 Felder diagonal entfernt
  check('Distanz D4->F6 ist exakt 2 (Chebyshev)', B.chebyshevDistance(center, f6) === 2);
}

// ---------------------------------------------------------------------------
section('Gerade Bewegung wird durch 1 Wand vollstaendig blockiert');
// ---------------------------------------------------------------------------
{
  const walls = B.createWallState();
  const d4 = B.parseCoord(board, 'D4');
  const e4 = B.parseCoord(board, 'E4');
  B.placeWall(walls, d4, e4);

  const result = B.canStepStraight(board, walls, [], d4, e4, 'p1');
  check('D4->E4 blockiert durch Wand', result.ok === false && result.reason === 'blocked_by_wall');
}

// ---------------------------------------------------------------------------
section('Diagonale Bewegung: 1 Wand blockiert NICHT, 2 Waende blockieren');
// ---------------------------------------------------------------------------
{
  const d4 = B.parseCoord(board, 'D4');
  const e5 = B.parseCoord(board, 'E5');
  const e4 = B.parseCoord(board, 'E4'); // corner1 (gleiche Reihe wie d4, Spalte wie e5)
  const d5 = B.parseCoord(board, 'D5'); // corner2

  // Fall 1: nur eine Wand (D4-E4) -> Diagonalbewegung bleibt moeglich
  const walls1 = B.createWallState();
  B.placeWall(walls1, d4, e4);
  const r1 = B.canStepDiagonal(board, walls1, [], d4, e5, 'p1');
  check('Diagonal D4->E5 mit nur 1 Wand weiterhin erlaubt', r1.ok === true);

  // Fall 2: beide Waende (D4-E4 und D4-D5) -> blockiert
  const walls2 = B.createWallState();
  B.placeWall(walls2, d4, e4);
  B.placeWall(walls2, d4, d5);
  const r2 = B.canStepDiagonal(board, walls2, [], d4, e5, 'p1');
  check('Diagonal D4->E5 mit 2 Waenden blockiert', r2.ok === false && r2.reason === 'blocked_by_two_walls');
}

// ---------------------------------------------------------------------------
section('Angrenzend gilt auch durch Waende (fuer Konter-Bedingungen)');
// ---------------------------------------------------------------------------
{
  const walls = B.createWallState();
  const d4 = B.parseCoord(board, 'D4');
  const e4 = B.parseCoord(board, 'E4');
  B.placeWall(walls, d4, e4);
  // isAdjacent kennt keine Waende -- das ist Absicht (siehe Regel: "Angrenzende
  // Felder gelten auch durch Waende, z.B. Bedingung bei Konterkarten")
  check('D4 und E4 gelten als angrenzend, obwohl Wand dazwischen', B.isAdjacent(d4, e4));
}

// ---------------------------------------------------------------------------
section('Teleportation ignoriert Waende (ausser Runenstein der Bindung)');
// ---------------------------------------------------------------------------
{
  const walls = B.createWallState();
  const d4 = B.parseCoord(board, 'D4');
  const e4 = B.parseCoord(board, 'E4');
  B.placeWall(walls, d4, e4);

  const withoutRuneStone = B.canTeleport(board, walls, [], d4, e4, 'p1');
  check('Teleport D4->E4 durch normale Wand erlaubt (keine Runensteine)', withoutRuneStone.ok === true);
}
{
  // Runenstein-Test ueber die exportierte API (placeWall + manuelles Hinzufuegen zum Set)
  const walls = B.createWallState();
  const d4 = B.parseCoord(board, 'D4');
  const e4 = B.parseCoord(board, 'E4');
  B.placeWall(walls, d4, e4);
  walls.runeStones.add([...walls.walls][0]); // die gerade platzierte Wand markieren

  const withRuneStone = B.canTeleport(board, walls, [], d4, e4, 'p1');
  check('Teleport D4->E4 MIT Runenstein blockiert', withRuneStone.ok === false && withRuneStone.reason === 'blocked_by_rune_stone');
}

// ---------------------------------------------------------------------------
section('Schnappen: Betreten eines gegnerischen Feldes erobert die Figur');
// ---------------------------------------------------------------------------
{
  const d4 = B.parseCoord(board, 'D4');
  const e4 = B.parseCoord(board, 'E4');
  const figures = [{ id: 'f1', owner: 'p2', x: e4.x, y: e4.y, type: 'hero' }];
  const walls = B.createWallState();

  const result = B.canStepStraight(board, walls, figures, d4, e4, 'p1');
  check('Betreten von gegnerischem Feld ist erlaubt', result.ok === true);
  check('Gegnerische Figur wird als Capture markiert', result.capture && result.capture.id === 'f1');

  const allyFigures = [{ id: 'f2', owner: 'p1', x: e4.x, y: e4.y, type: 'hero' }];
  const allyResult = B.canStepStraight(board, walls, allyFigures, d4, e4, 'p1');
  check('Betreten von verbuendetem Feld ist NICHT erlaubt', allyResult.ok === false && allyResult.reason === 'occupied_by_ally');
}

// ---------------------------------------------------------------------------
section('Mehrfeldrige gerade Bewegung (z.B. 2 Felder Standardbewegung)');
// ---------------------------------------------------------------------------
{
  const walls = B.createWallState();
  const d4 = B.parseCoord(board, 'D4');
  const e4 = B.parseCoord(board, 'E4');
  const f4 = B.parseCoord(board, 'F4');

  const result = B.validateStraightPath(board, walls, [], d4, [e4, f4], 'p1');
  check('D4 -> E4 -> F4 (2 freie Felder) ist gueltig', result.valid === true);

  B.placeWall(walls, e4, f4);
  const blocked = B.validateStraightPath(board, walls, [], d4, [e4, f4], 'p1');
  check('D4 -> E4 -> F4 mit Wand zwischen E4/F4 ist blockiert', blocked.valid === false);
}

// ---------------------------------------------------------------------------
section('Sichtlinie (gerade, fuer Konter-Trigger)');
// ---------------------------------------------------------------------------
{
  const walls = B.createWallState();
  const d1 = B.parseCoord(board, 'D1');
  const d5 = B.parseCoord(board, 'D5');
  check('Freie Sichtlinie D1->D5 ohne Waende', B.hasStraightLineOfSight(board, walls, d1, d5));

  const d3 = B.parseCoord(board, 'D3');
  const d4 = B.parseCoord(board, 'D4');
  B.placeWall(walls, d3, d4);
  check('Sichtlinie D1->D5 durch Wand bei D3/D4 blockiert', !B.hasStraightLineOfSight(board, walls, d1, d5));
}

// ---------------------------------------------------------------------------
section('Wandplatzierung darf Nord-Sued-Pfad nie vollstaendig schliessen');
// ---------------------------------------------------------------------------
{
  // Wir bauen eine fast komplette Mauer entlang einer Zeile (y=3/y=4 Grenze)
  // und lassen genau 1 Luecke -- das letzte Wandstueck, das die Luecke
  // schliessen wuerde, muss verboten sein.
  const walls = B.createWallState();
  for (let x = 0; x < board.width; x++) {
    if (x === 4) continue; // Luecke bei Spalte E offen lassen
    const top = { x, y: 3 };
    const bottom = { x, y: 4 };
    B.placeWall(walls, top, bottom);
  }
  const wouldClose = B.wouldWallBlockNorthSouthPath(board, walls, { x: 4, y: 3 }, { x: 4, y: 4 });
  check('Letzte Wand, die die einzige Luecke schliessen wuerde, wird erkannt', wouldClose === true);

  const openWalls = B.createWallState();
  const wouldNotClose = B.wouldWallBlockNorthSouthPath(board, openWalls, { x: 0, y: 3 }, { x: 0, y: 4 });
  check('Einzelne Wand auf leerem Feld schliesst den Pfad nicht', wouldNotClose === false);
}

// ---------------------------------------------------------------------------
console.log(`\n${'='.repeat(50)}`);
console.log(`Ergebnis: ${passed} bestanden, ${failed} fehlgeschlagen`);
console.log('='.repeat(50));
process.exit(failed > 0 ? 1 : 0);
