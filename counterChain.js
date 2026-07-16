// engine/counterChain.js
//
// Konterketten-Auflösung, basierend auf dem offiziellen Regelwerk:
//
// - Wird auf eine Aktion (Bewegung, Karte spielen, Zug beenden) eine
//   Konterkarte gespielt, entsteht eine Kette.
// - Die Kette wird in UMGEKEHRTER Reihenfolge aufgeloest: die zuletzt
//   gespielte Konterkarte wird zuerst ausgefuehrt (klassischer LIFO-Stack,
//   wie bei MTG/Hearthstone).
// - Offizielles Beispiel: Bewegung -> Toxinschuss -> Siegel des Bannamuletts
//   Zuerst wird Siegel des Bannamuletts ausgeloest und negiert dadurch
//   Toxinschuss.
// - Nach vollstaendiger Aufloesung der Kette gilt die urspruengliche Aktion
//   weiterhin als Ausloeser -- darauf kann erneut reagiert werden (also eine
//   NEUE Kette gegen dieselbe Ursprungsaktion entstehen).
// - "Kann nicht gekontert werden" (cannot_be_countered): auf DIESE Karte darf
//   keine Konterkarte mehr gespielt werden.
// - "Keine Konterkarten mehr spielbar in diesem Zug"
//   (blocks_further_counters_this_turn): sperrt ALLE weiteren Konterkarten
//   fuer den Rest des Zuges, nicht nur fuer diese eine Kette.
// - Wird eine Karte negiert, wird ihr Effekt NICHT ausgefuehrt -- auch keine
//   an den Effekt gekoppelten Kosten (z.B. Kartenabwurf). Nur die negierte
//   Karte selbst landet ohne Wirkung auf dem Ablagestapel (siehe FAQ).

/**
 * Ein ChainItem repraesentiert entweder die urspruengliche Aktion (Bewegung,
 * Kartenspiel, Zugende) oder eine gespielte Konterkarte.
 *
 * @typedef {Object} ChainItem
 * @property {string} id            eindeutige Kennung (z.B. Kartenname + Zeitstempel)
 * @property {'origin'|'counter'} kind
 * @property {string} owner         Spieler, der die Aktion/Karte gespielt hat
 * @property {Object} card          strukturierte Karte (aus cards_structured_final.json), null bei origin
 * @property {Object} flags         zusammengefuehrte Flags der Karte
 */

function createChain(originAction) {
  return {
    origin: {
      id: originAction.id || `origin_${Date.now()}`,
      kind: 'origin',
      owner: originAction.owner,
      card: null,
      description: originAction.description || originAction.type,
      negated: false,
    },
    items: [], // gespielte Konterkarten, in Spielreihenfolge (letztes Element = zuletzt gespielt = wird zuerst aufgeloest)
    blockedForRestOfTurn: false,
    resolved: false,
  };
}

/**
 * Prueft, ob aktuell ueberhaupt eine weitere Konterkarte auf die Kette
 * gespielt werden darf (unabhaengig davon, ob der Spieler eine passende
 * Karte besitzt -- das ist Aufgabe der aufrufenden Spiellogik).
 */
function canPushCounter(chain) {
  if (chain.resolved) {
    return { ok: false, reason: 'chain_already_resolved' };
  }
  if (chain.blockedForRestOfTurn) {
    return { ok: false, reason: 'blocked_for_rest_of_turn' };
  }
  const top = chain.items.length > 0 ? chain.items[chain.items.length - 1] : chain.origin;
  if (top.flags && top.flags.cannot_be_countered) {
    return { ok: false, reason: 'top_of_chain_cannot_be_countered' };
  }
  return { ok: true };
}

/**
 * Spielt eine Konterkarte auf die Kette. `counterCard` ist ein Eintrag aus
 * cards_structured_final.json (muss cardType === 'Konter' oder 'Ultimate'
 * mit trigger sein, das prueft diese Funktion NICHT selbst -- Legalitaet
 * bzgl. Trigger-Bedingung ist Aufgabe der aufrufenden Spiellogik).
 */
function pushCounter(chain, owner, counterCard) {
  const permission = canPushCounter(chain);
  if (!permission.ok) {
    throw new Error(`Konterkarte kann nicht gespielt werden: ${permission.reason}`);
  }

  const item = {
    id: `${counterCard.id}_${chain.items.length}`,
    kind: 'counter',
    owner,
    card: counterCard,
    flags: counterCard.flags || {},
    negated: false,
    negatedBy: null,
  };
  chain.items.push(item);

  if (item.flags.blocks_further_counters_this_turn) {
    chain.blockedForRestOfTurn = true;
  }

  return item;
}

/**
 * Loest die komplette Kette in umgekehrter Reihenfolge auf (LIFO: zuletzt
 * gespielte Karte zuerst). Wendet negate_effect-Aktionen an: negiert ein
 * Item das direkt darunterliegende, wird dessen Effekt (inkl. gekoppelter
 * Kosten) uebersprungen -- die Karte selbst gilt trotzdem als gespielt/
 * abgelegt.
 *
 * `executeEffects(item, chain)` ist ein Callback, den die aufrufende
 * Spiellogik uebergibt, um die tatsaechlichen Spielzustands-Aenderungen
 * (Bewegung ausfuehren, Karten ziehen, etc.) fuer ein nicht-negiertes Item
 * vorzunehmen. Diese Engine kuemmert sich NUR um Reihenfolge + Negation,
 * nicht um die konkrete Wirkung der ~110 verschiedenen Karten.
 */
function resolveChain(chain, executeEffects = () => {}) {
  if (chain.resolved) {
    throw new Error('Kette wurde bereits aufgeloest.');
  }

  const log = [];

  // LIFO: von hinten (zuletzt gespielt) nach vorne durch die Konterkarten,
  // danach die urspruengliche Aktion.
  const resolutionOrder = [...chain.items].reverse();

  for (let i = 0; i < resolutionOrder.length; i++) {
    const item = resolutionOrder[i];

    if (item.negated) {
      log.push({ item: item.id, executed: false, reason: 'negated' });
      continue;
    }

    // Effekte ausfuehren (ausser die Karte wurde inzwischen negiert)
    const negateActions = (item.card.effects || []).filter(
      (e) => e.action === 'negate_effect' && e.target === 'triggering_card'
    );

    if (negateActions.length > 0) {
      // Das Item, auf das DIESES Item reagiert hat, ist genau das naechste
      // in der urspruenglichen Spielreihenfolge (also index+1 in resolutionOrder,
      // da resolutionOrder umgekehrt ist).
      const target = resolutionOrder[i + 1] || chain.origin;
      target.negated = true;
      target.negatedBy = item.id;
      // Das negierende Item selbst gilt als ausgefuehrt (nur sein ZIEL wird negiert)
      executeEffects(item, chain);
      log.push({ item: item.id, executed: true, effect: 'negate_effect', negated: target.id });
    } else {
      executeEffects(item, chain);
      log.push({ item: item.id, executed: true });
    }
  }

  if (!chain.origin.negated) {
    executeEffects(chain.origin, chain);
    log.push({ item: chain.origin.id, executed: true, isOrigin: true });
  } else {
    log.push({ item: chain.origin.id, executed: false, reason: 'negated', isOrigin: true });
  }

  chain.resolved = true;
  return log;
}

/**
 * Nach Aufloesung einer Kette gilt die urspruengliche Aktion weiterhin als
 * gueltiger Ausloeser (siehe Regelwerk) -- eine neue Kette kann direkt
 * gegen dieselbe origin-Aktion eroeffnet werden. Convenience-Funktion.
 */
function openFollowUpChain(resolvedChain) {
  if (!resolvedChain.resolved) {
    throw new Error('Kette ist noch nicht aufgeloest, kann keine Folgekette eroeffnen.');
  }
  return createChain({
    id: `${resolvedChain.origin.id}_followup`,
    owner: resolvedChain.origin.owner,
    description: resolvedChain.origin.description,
  });
}

module.exports = {
  createChain,
  canPushCounter,
  pushCounter,
  resolveChain,
  openFollowUpChain,
};
