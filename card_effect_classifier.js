// card_effect_classifier.js
//
// Portierung des Baustein-Katalogs aus parse_cards.py nach JS, damit sync_cards_from_base44.js
// (Node, laeuft ohne Python-Abhaengigkeit) dieselbe Klassifizierung fuer Kartentext aus der
// Base44-API anwenden kann. Die Muster hier MUESSEN mit parse_cards.py deckungsgleich bleiben --
// bei Aenderungen an einer Seite die andere nachziehen.
//
// classify(text) ordnet einem deutschen Kartentext (effect/trigger/penalty, ggf. verkettet)
// bekannte Spielmechanik-Bausteine per Keyword-/Regex-Abgleich zu -- NIE per freiem Raten.
// Liefert { actions: [...], flags: {...}, matched: bool }. matched === false bedeutet: kein
// bekanntes Muster hat gegriffen -> Aufrufer MUSS die Karte als needs-manual-review behandeln.

function norm(s) {
  return (s || '').toLowerCase().trim();
}

const PATTERNS = [
  [/bewege(?:n)? dich(?: diesen zug)? um (?:bis zu )?(\d+) zusätzliche[sn]? feld(?:er)?(?: (diagonal|horizontal))?/,
    (m) => ({ action: 'move', target: 'self', fields: parseInt(m[1], 10), optional: /bis zu/.test(m[0]), ...(m[2] ? { direction: m[2] } : {}) })],
  [/(?:du kannst dich|du und dein \w+ könn(?:en|t) euch|können sich) (?:diesen zug )?um (?:bis zu )?(\d+) zusätzliche[sn]? (?:horizontale[n]? )?feld(?:er)?(?: (diagonal|horizontal))? bewegen/,
    (m, fullText) => ({ action: 'move', target: /wolf/.test(fullText) ? 'self_and_companion' : 'self', fields: parseInt(m[1], 10), ...(m[2] ? { direction: m[2] } : {}) })],
  [/bewege(?:n)? dich um (\d+) zusätzliche[sn]? feld(?:er)? (diagonal|horizontal)/,
    (m) => ({ action: 'move', target: 'self', fields: parseInt(m[1], 10), direction: m[2] })],
  [/bewege (\d+) (?:feindliche|gegnerische) figur um (\d+) feld/,
    (m) => ({ action: 'move_enemy_figure', count: parseInt(m[1], 10), fields: parseInt(m[2], 10) })],
  [/du kannst dich(?: diesen zug)? diagonal bewegen/,
    () => ({ action: 'grant_movement_mode', target: 'self', mode: 'diagonal' })],
  [/du kannst dich(?: diesen zug)? durch wände bewegen/,
    () => ({ action: 'grant_movement_mode', target: 'self', mode: 'through_walls' })],
  [/ziehe (\d+) karten?/,
    (m) => ({ action: 'draw_card', target: 'self', count: parseInt(m[1], 10) })],
  [/wirf (?:anschliessend |anschließend )?(\d+|1) (?:beliebige )?(?:hand)?karten? ab/,
    (m) => ({ action: 'discard_card', target: 'self', count: /^\d+$/.test(m[1]) ? parseInt(m[1], 10) : m[1] })],
  [/du kannst (\d+|1) (?:weitere|zusätzliche) karten? spielen/,
    (m) => ({ action: 'play_additional_card', target: 'self', count: /^\d+$/.test(m[1]) ? parseInt(m[1], 10) : 1 })],
  [/setzt? (?:seinen|ihren|deinen) nächsten zug aus/,
    () => ({ action: 'skip_turn', target: 'enemy', count: 1 })],
  [/setzen (?:ihre|seine) nächsten (\d+) züge aus/,
    (m) => ({ action: 'skip_turn', target: 'enemy', count: parseInt(m[1], 10) })],
  [/(?:kann(?:n)?|können) sich[^.]* nicht (?:mehr )?bewegen/,
    () => ({ action: 'prevent_movement', target: 'context', duration: 'this_turn' })],
  [/(?:können|dürfen)[^.]*?keine karten spielen/,
    () => ({ action: 'prevent_card_play', target: 'context' })],
  [/wird (?:sofort )?geschnappt|werden geschnappt/,
    () => ({ action: 'capture_figure', target: 'context' })],
  [/können[^.]* nicht geschnappt werden|kann(?:n)? nicht geschnappt werden/,
    () => ({ action: 'prevent_capture', target: 'context' })],
  [/zerstöre(?:n)? (?:alle )?wände?/,
    () => ({ action: 'destroy_wall', target: 'chosen_or_area' })],
  [/zerstöre 1 wand/,
    () => ({ action: 'destroy_wall', target: 'chosen', count: 1 })],
  [/verschiebe 1 wand|bewege 1 wand/,
    () => ({ action: 'move_wall', count: 1 })],
  [/setze 1 wand/,
    () => ({ action: 'place_wall', count: 1 })],
  [/teleportier(?:e|t)/,
    () => ({ action: 'teleport', target: 'context' })],
  [/tausche (?:die|deine) position(?:en)? durch teleportation/,
    () => ({ action: 'teleport_swap', target: 'context' })],
  [/negiere den effekt/,
    () => ({ action: 'negate_effect', target: 'triggering_card' })],
  [/lege (?:die|sie) karte auf den ablagestapel/,
    () => ({ action: 'discard_to_pile', target: 'triggering_card' })],
  [/kann nicht gekontert werden/,
    () => ({ action: '__flag__', flag: 'cannot_be_countered' })],
  [/können keine konterkarten mehr gespielt werden/,
    () => ({ action: '__flag__', flag: 'blocks_further_counters_this_turn' })],
  [/suche in deinem deck nach (?:bis zu )?(\d+)?\s*karte/,
    (m) => ({ action: 'search_deck', count: m[1] ? parseInt(m[1], 10) : 1 })],
  [/lege die falle verdeckt auf ein freies feld/,
    () => ({ action: 'place_trap' })],
  [/platziere .*(?:banner|wolke|rauchwolke)/,
    () => ({ action: 'place_area_object' })],
  [/erstelle 1 schattenklon/,
    () => ({ action: 'create_shadow_clone', count: 1 })],
  [/entferne (?:deine|alle) schattenklone/,
    () => ({ action: 'remove_shadow_clone' })],
  [/bestimme neu, welche(?:s)? (?:deine[rn]? figuren?|die heldenfigur ist)/,
    () => ({ action: 'reassign_hero_figure' })],
  [/aktiviert den wolfmodus|wolf-modus/,
    () => ({ action: 'toggle_wolf_mode' })],
  [/beschwöre den begleiter/,
    () => ({ action: 'summon_companion' })],
  [/wähle eines:/,
    () => ({ action: 'choose_one' })],
  [/setze .*(?:figuren|wände) .* zurück|zurückgesetzt/,
    () => ({ action: 'reset_state' })],
  [/wird um 90.{1,3} gedreht|rotiert/,
    () => ({ action: 'rotate_board' })],
  [/wirf 1 münze/,
    () => ({ action: 'flip_coin' })],
  [/spiele .* als kopie/,
    () => ({ action: 'copy_card' })],
  [/tauscht diese handkarten aus|tauscht? .* handkarte/,
    () => ({ action: 'swap_hand_card' })],
];

/**
 * @param {string} text  deutscher Kartentext (effect + trigger + penalty, verkettet)
 * @returns {{actions: object[], flags: object, matched: boolean}}
 */
function classify(text) {
  const lowerT = norm(text);
  const actions = [];
  const flags = {};
  for (const [pattern, builder] of PATTERNS) {
    const re = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : pattern.flags + 'g');
    let match;
    while ((match = re.exec(lowerT)) !== null) {
      const built = builder(match, lowerT);
      if (built.action === '__flag__') {
        flags[built.flag] = true;
      } else {
        actions.push(built);
      }
      if (match[0] === '') re.lastIndex++;
    }
  }
  // Manche API-Textfelder wiederholen denselben Satz (z.B. "effect" und "penalty" tragen beide
  // "wirf 1 karte ab") -- ohne Dedup wuerden identische Aktionen doppelt auftauchen, obwohl es
  // im Spiel nur 1 Aktion ist. Nur BYTE-IDENTISCHE Aktionsobjekte werden zusammengefasst, echte
  // Mehrfachaktionen mit unterschiedlichen Parametern bleiben erhalten.
  const seen = new Set();
  const dedupedActions = actions.filter((a) => {
    const key = JSON.stringify(a);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return { actions: dedupedActions, flags, matched: dedupedActions.length > 0 || Object.keys(flags).length > 0 };
}

module.exports = { classify, norm };
