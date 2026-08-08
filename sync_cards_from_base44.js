// sync_cards_from_base44.js
//
// Ruft die Base44-Karten-API ab und gleicht sie gegen die lokalen Kartendaten ab
// (CARDS_DATA + STRUCTURED_CARDS_DATA, beide inline in index.html; STRUCTURED_CARDS_DATA
// hat zusaetzlich cards_structured_final.json als Quelldatei).
//
// Was passiert:
//   1. API abrufen.
//   2. Jede API-Karte per normalisiertem deutschen Namen einer lokalen CARDS_DATA-Karte
//      zuordnen (Heldenkarten sind in der API nicht enthalten -- erwartet, kein Fehler).
//   3. CARDS_DATA wird NICHT destruktiv veraendert: bereits vorhandene, von Hand gepflegte
//      Felder (name, description, icon, image, ...) bleiben unangetastet. Es wird nur ein
//      neues, additives Feld "i18n" mit den Rohdaten aus der API ergaenzt (name/klasse/typ/
      // kosten/penalty/trigger/effect je de+en, plus card_id/season_nr/updated_date).
//   4. STRUCTURED_CARDS_DATA (Effekt-Engine-Daten) wird per card_effect_classifier.js
//      klassifiziert. Sicherheitsregel (siehe Aufgabenstellung 2c/2d):
//        - Karten mit parse_confidence "manual" werden NIE automatisch ueberschrieben.
//        - Nur wenn der Klartext sich seit dem letzten Sync geaendert hat UND der Klassifizierer
//          eindeutig (matched===true) eine neue Aktionsliste liefert, wird die (nicht-manuelle)
//          Karte aktualisiert.
//        - Faelle ohne eindeutige Klassifizierung werden explizit als "needs-manual-review"
//          reported (inkl. Originaltext) und NICHT in die Engine geschrieben.
//   5. Ein Diff/Report wird nach cards_sync_report.json geschrieben und auf der Konsole
//      zusammengefasst.
//   6. Nur wenn --apply uebergeben wird, werden cards_structured_final.json UND die beiden
//      eingebetteten Arrays in index.html tatsaechlich neu geschrieben. Ohne --apply ist der
//      Lauf ein reiner Dry-Run (Report wird trotzdem geschrieben).
//
// Aufruf:  node sync_cards_from_base44.js [--apply]

const fs = require('fs');
const path = require('path');
const { classify } = require('./card_effect_classifier');

const API_URL = 'https://app.base44.com/api/apps/690b1ad0ce3f7e1376dec506/entities/Card';
const ROOT = __dirname;
const INDEX_HTML = path.join(ROOT, 'index.html');
const STRUCTURED_JSON = path.join(ROOT, 'cards_structured_final.json');
const REPORT_JSON = path.join(ROOT, 'cards_sync_report.json');

const KLASSE_TO_CLASS = {
  assassin: 'Assassine',
  knight: 'Ritter',
  ranger: 'Ranger',
  mage: 'Zauberer',
  neutral: 'Neutral',
  team: 'Team',
};

const TYP_CAPITALIZE = {
  klasse: 'Klasse',
  konter: 'Konter',
  ultimate: 'Ultimate',
  standard: 'Standard',
  falle: 'Falle',
  team: 'Team',
  begleiter: 'Begleiter',
};

const CARD_TYPE_ICON = {
  Held: '👑', Klasse: '⚡', Konter: '🛡️', Ultimate: '🔥', Standard: '✨', Falle: '🎯', Team: '🤝',
};

function norm(s) {
  return (s || '').toLowerCase().trim().replace(/\s+/g, ' ');
}

function cardTypeFromTyp(typ) {
  if (typ.includes('ultimate')) return 'Ultimate';
  if (typ.includes('konter')) return 'Konter';
  if (typ.includes('falle')) return 'Falle';
  if (typ.includes('team')) return 'Team';
  if (typ.includes('standard')) return 'Standard';
  if (typ.includes('klasse')) return 'Klasse';
  return null;
}

// -- Liest die grosse, einzeilige "const NAME = [...]" Deklaration aus index.html.
// Beide Arrays (CARDS_DATA, STRUCTURED_CARDS_DATA) stehen je auf einer eigenen Zeile mit
// CRLF-Zeilenende -- direkte String-Ersetzung der ganzen Zeile statt Parsen/Neuschreiben der
// gesamten (mehrere MB grossen) HTML-Datei ueber generische Tools.
function readEmbeddedArray(lines, constName) {
  const idx = lines.findIndex((l) => l.startsWith(`const ${constName} = [`));
  if (idx === -1) throw new Error(`const ${constName} nicht gefunden`);
  const line = lines[idx];
  const jsonStr = line.slice(line.indexOf('[')).replace(/;\r?$/, '');
  return { idx, data: JSON.parse(jsonStr) };
}

function writeEmbeddedArray(lines, idx, constName, data) {
  lines[idx] = `const ${constName} = ${JSON.stringify(data)};\r`;
}

async function main() {
  const apply = process.argv.includes('--apply');

  console.log(`Rufe Base44-API ab: ${API_URL}`);
  const res = await fetch(API_URL);
  if (!res.ok) throw new Error(`API-Fehler: HTTP ${res.status}`);
  const apiCards = await res.json();
  console.log(`API liefert ${apiCards.length} Karten.`);

  const htmlText = fs.readFileSync(INDEX_HTML, 'utf8');
  const lines = htmlText.split('\n');
  const cardsDataRef = readEmbeddedArray(lines, 'CARDS_DATA');
  const structuredRef = readEmbeddedArray(lines, 'STRUCTURED_CARDS_DATA');
  const cardsData = cardsDataRef.data;
  const structuredData = structuredRef.data;

  const localByName = new Map(cardsData.map((c) => [norm(c.name), c]));
  const structuredById = new Map(structuredData.map((c) => [c.id, c]));

  const report = {
    timestamp: new Date().toISOString(),
    api_total: apiCards.length,
    local_total: cardsData.length,
    new_cards: [],
    changed_cards: [],
    needs_manual_review: [],
    unchanged: [],
    unmatched_local_cards: [], // in CARDS_DATA aber nicht in der API (z.B. Helden -- erwartet)
    ambiguous_api_duplicates: [], // mehrere API-Eintraege mit demselben Namen -- NICHT automatisch aufgeloest
  };

  // Sicherheitsregel greift schon bei der Namenszuordnung selbst: wenn zwei verschiedene
  // API-Karten denselben deutschen Namen tragen, ist NICHT eindeutig, welche die aktuell
  // gueltige ist -- also nicht blind eine davon (z.B. die zuletzt verarbeitete) gegen die
  // lokale Karte matchen, sondern beide als Ambiguitaet reporten und die lokale Karte
  // unangetastet lassen.
  const apiNameCounts = new Map();
  for (const api of apiCards) {
    const key = norm(api.name && api.name.de);
    apiNameCounts.set(key, (apiNameCounts.get(key) || 0) + 1);
  }
  const ambiguousNames = new Set([...apiNameCounts.entries()].filter(([, n]) => n > 1).map(([k]) => k));
  for (const key of ambiguousNames) {
    const dupes = apiCards.filter((c) => norm(c.name && c.name.de) === key);
    report.ambiguous_api_duplicates.push({
      name_de: key,
      api_card_ids: dupes.map((d) => d.card_id),
      detail: dupes.map((d) => ({ card_id: d.card_id, typ: d.typ, updated_date: d.updated_date, effect_de: d.effect && d.effect.de })),
    });
    report.needs_manual_review.push({
      id: (localByName.get(key) || {}).id || null,
      name: key,
      reason: `mehrere API-Eintraege mit demselben Namen (${dupes.map((d) => d.card_id).join(', ')}) -- welcher aktuell gueltig ist, ist nicht eindeutig`,
      raw_text: dupes.map((d) => (d.effect && d.effect.de) || '').join(' /// '),
    });
  }

  let maxId = Math.max(...cardsData.map((c) => parseInt(c.id, 10)));
  const matchedLocalIds = new Set();

  for (const api of apiCards) {
    const nameDe = (api.name && api.name.de) || '';
    if (ambiguousNames.has(norm(nameDe))) continue; // s.o. -- bewusst uebersprungen, nicht geraten
    const local = localByName.get(norm(nameDe));

    // Rohtext fuer Klassifizierung: effect + trigger + penalty (alles was Spielmechanik traegt).
    const rawTextDe = [api.effect && api.effect.de, api.trigger && api.trigger.de, api.penalty && api.penalty.de]
      .filter(Boolean).join(' ');

    if (!local) {
      // -------- Neue Karte: existiert in der API, aber lokal nicht --------
      maxId += 1;
      const newId = String(maxId).padStart(3, '0');
      const klasse = KLASSE_TO_CLASS[api.klasse] || api.klasse;
      const cardType = cardTypeFromTyp(api.typ || []) || 'Standard';
      const subtypes = (api.typ || []).map((t) => TYP_CAPITALIZE[t] || t);

      const newCardsDataEntry = {
        id: newId,
        number: `${maxId}/?`, // Gesamtzahl im Nenner bewusst nicht auf bestehende Karten rueckwirkend angepasst, siehe Report
        name: nameDe ? nameDe.charAt(0).toUpperCase() + nameDe.slice(1) : `(unbenannt ${newId})`,
        icon: CARD_TYPE_ICON[cardType] || '❔',
        cardType,
        class: klasse,
        subtypes,
        description: rawTextDe || '(kein effect/trigger/penalty-Text von der API)',
        cost: (api.kosten && api.kosten.de) || null,
        penalty: (api.penalty && api.penalty.de) || null,
        trigger: (api.trigger && api.trigger.de) || null,
        deckLimit: null,
        trapDeckLimit: null,
        replacesCard: [],
        notPlayableWithFlag: false,
        notCounterable: false,
        tts: { deckId: null, spriteIndex: null },
        image: null,
        i18n: apiToI18n(api),
      };

      const classification = classify(rawTextDe);
      const newStructuredEntry = {
        id: newId,
        name: newCardsDataEntry.name,
        cardType,
        class: klasse,
        trigger: (api.trigger && api.trigger.de) ? { event: 'custom', text_de: api.trigger.de } : null,
        condition: null,
        cost: null,
        effects: classification.matched ? classification.actions : [],
        flags: Object.keys(classification.flags).length ? classification.flags : null,
        parse_confidence: classification.matched ? 'high' : 'needs-manual-review',
        parse_notes: classification.matched ? null : ['no_actions_extracted_from_api_text'],
        raw_description: rawTextDe,
      };

      cardsData.push(newCardsDataEntry);
      structuredData.push(newStructuredEntry);
      report.new_cards.push({
        id: newId, name_de: nameDe, name_en: (api.name && api.name.en) || null,
        klasse, typ: api.typ, classification: newStructuredEntry.parse_confidence,
        actions: newStructuredEntry.effects,
      });
      if (!classification.matched) {
        report.needs_manual_review.push({ id: newId, name: nameDe, reason: 'neue Karte, kein bekanntes Muster im Text', raw_text: rawTextDe });
      }
      continue;
    }

    matchedLocalIds.add(local.id);

    // -------- Bereits lokal vorhandene Karte: nicht-destruktiv ergaenzen + ggf. Diff --------
    const oldI18n = local.i18n;
    local.i18n = apiToI18n(api);

    const structured = structuredById.get(local.id);
    const localRawText = norm(structured ? structured.raw_description : local.description);
    const apiRawText = norm(rawTextDe);
    const textChanged = localRawText && apiRawText && localRawText !== apiRawText;

    if (!textChanged) {
      report.unchanged.push({ id: local.id, name: local.name });
      continue;
    }

    if (!structured || structured.parse_confidence === 'manual') {
      // Sicherheitsregel: manuell klassifizierte/nicht vorhandene Engine-Eintraege werden nie
      // automatisch angefasst -- nur reporten, damit ein Mensch pruefen kann.
      report.changed_cards.push({
        id: local.id, name: local.name, kind: 'manual_preserved',
        old_text: structured ? structured.raw_description : local.description,
        new_text: rawTextDe,
      });
      continue;
    }

    const classification = classify(apiRawText);
    if (classification.matched) {
      structured.effects = classification.actions;
      structured.flags = Object.keys(classification.flags).length ? classification.flags : null;
      structured.raw_description = rawTextDe;
      structured.parse_confidence = 'high';
      structured.parse_notes = null;
      report.changed_cards.push({
        id: local.id, name: local.name, kind: 'reclassified',
        old_text: localRawText, new_text: rawTextDe, new_actions: classification.actions,
      });
    } else {
      structured.parse_notes = ['text_changed_since_last_sync_needs_manual_review'];
      report.needs_manual_review.push({ id: local.id, name: local.name, reason: 'Text seit letztem Sync geaendert, kein bekanntes Muster', raw_text: rawTextDe });
    }
  }

  // Lokale Karten, die in der API fehlen (erwartet: die 4 Heldenkarten).
  for (const c of cardsData) {
    if (!matchedLocalIds.has(c.id)) {
      report.unmatched_local_cards.push({ id: c.id, name: c.name, cardType: c.cardType });
    }
  }

  const total90pct = apiCards.length; // Basis fuer die 90%-Kriterium-Betrachtung: alle API-Karten
  const cleanlyClassified = report.unchanged.length
    + report.new_cards.filter((c) => c.classification === 'high').length
    + report.changed_cards.filter((c) => c.kind === 'reclassified').length
    + report.changed_cards.filter((c) => c.kind === 'manual_preserved').length; // manuell = eindeutig durch Menschen klassifiziert
  const reviewCount = report.needs_manual_review.length;
  const manualPreservedCount = report.changed_cards.filter((c) => c.kind === 'manual_preserved').length;
  report.summary = {
    api_cards_total: apiCards.length,
    unchanged: report.unchanged.length,
    new: report.new_cards.length,
    changed: report.changed_cards.length,
    needs_manual_review: reviewCount,
    pct_cleanly_classified: Math.round((cleanlyClassified / total90pct) * 1000) / 10,
    // manual_preserved-Karten zaehlen oben als "nicht still falsch klassifiziert" (Engine wurde
    // korrekt NICHT angetastet), aber ihr Regeltext hat sich trotzdem geaendert -- das ist ein
    // separater menschlicher Review-Bedarf (Spieldesign-Frage, keine Klassifizierungsfrage).
    // Getrennt ausgewiesen, damit die 90%-Zahl nicht faelschlich als "nichts zu tun" gelesen wird.
    text_changed_manual_entries_recommend_human_review: manualPreservedCount,
  };

  fs.writeFileSync(REPORT_JSON, JSON.stringify(report, null, 2), 'utf8');

  console.log('\n===== SYNC-REPORT =====');
  console.log(`API-Karten gesamt: ${report.summary.api_cards_total}`);
  console.log(`Unveraendert: ${report.summary.unchanged}`);
  console.log(`Neu: ${report.summary.new}`);
  console.log(`Geaendert: ${report.summary.changed}`);
  console.log(`needs-manual-review: ${report.summary.needs_manual_review}`);
  console.log(`Anteil eindeutig klassifiziert/erhalten: ${report.summary.pct_cleanly_classified}%`);
  console.log(`Lokale Karten ohne API-Treffer (erwartet: Helden): ${report.unmatched_local_cards.map((c) => c.name).join(', ')}`);
  console.log(`Report geschrieben nach: ${REPORT_JSON}`);

  if (!apply) {
    console.log('\nDry-Run (kein --apply) -- index.html und cards_structured_final.json wurden NICHT veraendert.');
    return;
  }

  writeEmbeddedArray(lines, cardsDataRef.idx, 'CARDS_DATA', cardsData);
  writeEmbeddedArray(lines, structuredRef.idx, 'STRUCTURED_CARDS_DATA', structuredData);
  fs.writeFileSync(INDEX_HTML, lines.join('\n'), 'utf8');
  fs.writeFileSync(STRUCTURED_JSON, JSON.stringify(structuredData, null, 2), 'utf8');
  console.log('\n--apply: index.html und cards_structured_final.json wurden aktualisiert.');
}

function apiToI18n(api) {
  return {
    name: api.name || null,
    klasse: api.klasse || null,
    typ: api.typ || null,
    kosten: api.kosten || null,
    penalty: api.penalty || null,
    trigger: api.trigger || null,
    effect: api.effect || null,
    card_id: api.card_id || null,
    season_nr: api.season_nr != null ? api.season_nr : null,
    updated_date: api.updated_date || null,
  };
}

main().catch((err) => {
  console.error('Sync fehlgeschlagen:', err);
  process.exit(1);
});
