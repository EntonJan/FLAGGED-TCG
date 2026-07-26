/**
 * FLAGGED - Cloud Functions fuer den Shop-Kaufvorgang.
 *
 * Warum das hier laufen muss und nicht direkt im Client:
 * Ein Kauf veraendert IMMER zwei Dokumente gleichzeitig (Coins runter im
 * users/{uid}-Dokument, Kartenbestand hoch im inventory/{uid}-Dokument),
 * und der Lagerbestand im Shop-Dokument muss dabei ebenfalls sicher
 * mitgezaehlt werden. Reine Firestore-Regeln koennen das nicht faelschungs-
 * sicher dokumentuebergreifend pruefen (siehe Kommentare in firestore.rules).
 * Deshalb: Admin-SDK-Code, der serverseitig in einer echten Transaktion
 * laeuft und dabei die Client-Sicherheitsregeln bewusst umgeht (das ist
 * der ganze Sinn des Admin-SDK) -- aber nur fuer genau diese eine,
 * eng gepruefte Operation.
 *
 * Deploy:
 *   1. Firebase-Projekt braucht den "Blaze"-Tarif (Cloud Functions sind
 *      auf dem kostenlosen "Spark"-Tarif nicht verfuegbar).
 *   2. In diesem Ordner: npm install
 *   3. Im Projekt-Root: firebase deploy --only functions
 */

const functions = require('firebase-functions');
const admin = require('firebase-admin');
admin.initializeApp();
const db = admin.firestore();

// =====================================================================
// ensureShopRotation
// -----------------------------------------------------------------------
// Der Client berechnet die Wochenrotation bereits deterministisch selbst
// (computeShopRotation() im Frontend, gleicher Seed = gleiches Ergebnis
// fuer alle). Diese Funktion prueft nur, ob fuer die angegebene Woche
// schon ein shop/current-Dokument existiert -- falls nicht, legt sie es
// mit den vom Client vorgeschlagenen Angeboten an. Sie validiert dabei
// die GROBE FORM (10 Angebote, gueltige Kartenids, sinnvolle Zahlen),
// aber nicht die Rarity-Logik selbst (die lebt bewusst im Frontend/der
// kuenftigen Karten-API, nicht doppelt hier).
//
// Der eigentliche Schutz hier: kein Client kann shop/current direkt
// schreiben (siehe firestore.rules), nur diese Funktion darf es -- und
// nur beim allerersten Aufruf pro Woche, nie ueberschreibend.
// =====================================================================
exports.ensureShopRotation = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Bitte einloggen.');
  }

  const { weekId, offers } = data || {};
  if (typeof weekId !== 'string' || !/^\d{4}-W\d{2}$/.test(weekId)) {
    throw new functions.https.HttpsError('invalid-argument', 'weekId hat ein ungueltiges Format.');
  }
  if (!Array.isArray(offers) || offers.length !== 10) {
    throw new functions.https.HttpsError('invalid-argument', 'Es muessen genau 10 Angebote uebergeben werden.');
  }

  const shopRef = db.collection('shop').doc('current');

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(shopRef);
    if (snap.exists && snap.data().cycleId === weekId) {
      // Fuer diese Woche existiert schon eine Rotation -- nichts tun,
      // einfach das Bestehende zurueckgeben.
      return { created: false, cycleId: snap.data().cycleId };
    }

    const offersMap = {};
    for (const o of offers) {
      if (!o || typeof o.cardId !== 'string') {
        throw new functions.https.HttpsError('invalid-argument', 'Ein Angebot hat keine gueltige cardId.');
      }
      const price = Number(o.price);
      const stock = Number(o.stock);
      if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(stock) || stock <= 0) {
        throw new functions.https.HttpsError('invalid-argument', `Ungueltiger Preis/Bestand fuer Karte ${o.cardId}.`);
      }
      offersMap[o.cardId] = { rarity: String(o.rarity || 'unknown'), price, stock, sold: 0 };
    }

    tx.set(shopRef, {
      cycleId: weekId,
      offers: offersMap,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    return { created: true, cycleId: weekId };
  });
});

// =====================================================================
// purchaseCard
// -----------------------------------------------------------------------
// Der eigentliche Kauf: prueft Bestand, Preis und Kontostand serverseitig
// und schreibt Coins, Inventar und den Lagerbestand in EINER Transaktion.
// =====================================================================
exports.purchaseCard = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Bitte einloggen.');
  }
  const uid = context.auth.uid;
  const cardId = data && data.cardId;
  if (typeof cardId !== 'string' || !cardId) {
    throw new functions.https.HttpsError('invalid-argument', 'cardId fehlt.');
  }

  const shopRef = db.collection('shop').doc('current');
  const userRef = db.collection('users').doc(uid);
  const inventoryRef = db.collection('inventory').doc(uid);

  return db.runTransaction(async (tx) => {
    const [shopSnap, userSnap, inventorySnap] = await Promise.all([
      tx.get(shopRef),
      tx.get(userRef),
      tx.get(inventoryRef),
    ]);

    if (!shopSnap.exists) {
      throw new functions.https.HttpsError('failed-precondition', 'Es gibt aktuell keine Shop-Rotation.');
    }
    const offers = shopSnap.data().offers || {};
    const offer = offers[cardId];
    if (!offer) {
      throw new functions.https.HttpsError('not-found', 'Diese Karte ist in der aktuellen Rotation nicht im Angebot.');
    }
    if (offer.sold >= offer.stock) {
      throw new functions.https.HttpsError('resource-exhausted', 'Dieses Angebot ist bereits ausverkauft.');
    }

    const coins = userSnap.exists ? (userSnap.data().coins || 0) : 0;
    if (coins < offer.price) {
      throw new functions.https.HttpsError('failed-precondition', 'Nicht genug Coins fuer diesen Kauf.');
    }

    const currentCards = inventorySnap.exists ? (inventorySnap.data().cards || {}) : {};
    const newCount = (currentCards[cardId] || 0) + 1;
    const newCoins = coins - offer.price;

    tx.set(userRef, { coins: newCoins }, { merge: true });
    tx.set(inventoryRef, { cards: { ...currentCards, [cardId]: newCount } }, { merge: true });
    tx.update(shopRef, { [`offers.${cardId}.sold`]: offer.sold + 1 });

    return { success: true, newCoins, newCount };
  });
});
