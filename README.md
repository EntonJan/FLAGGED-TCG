# Flagged Deckbuilder

Web-App zum Bauen, Speichern und Teilen von Decks fuer das Kartenspiel Flagged.

## Was ist enthalten

- `src/data/cards.json` — alle 110 Karten, strukturiert
- `src/components/CardList.jsx` — Kartenbrowser mit Suche/Filter
- `src/components/DeckBuilder.jsx` — Deck zusammenstellen (Held waehlen, Karten hinzufuegen, speichern)
- `src/components/MyDecks.jsx` — eigene Decks + oeffentliche Meta-Decks ansehen
- `src/components/ImportCards.jsx` — Ein-Klick-Import der Kartendaten nach Firestore
- `firestore.rules` — Vorschlag fuer Security Rules (spaeter manuell in der Firebase Console einfuegen)

## Setup ohne Terminal (Schritt fuer Schritt)

### 1. Repo auf GitHub anlegen
1. Gehe zu [github.com/new](https://github.com/new)
2. Repository-Name z.B. `flagged-deckbuilder`
3. "Create repository" (ohne README, ohne .gitignore — bleibt leer)

### 2. Projektdateien hochladen
1. Entpacke das dir gelieferte ZIP-Archiv auf deinem Rechner (Rechtsklick -> "Alle extrahieren")
2. Auf der leeren Repo-Seite auf GitHub: Klicke auf den Link **"uploading an existing file"**
3. Ziehe den **gesamten entpackten Ordnerinhalt** (alle Dateien und Unterordner) per Drag & Drop in das Upload-Feld
4. Unten "Commit changes" klicken

### 3. Firebase-Konfiguration eintragen
1. Oeffne in GitHub die Datei `src/firebase.js` (Stift-Symbol zum Bearbeiten)
2. Ersetze die Platzhalter-Werte durch deinen echten Firebase-Config-Block
   (aus der Firebase Console: Projekteinstellungen -> General -> Deine Apps)
3. "Commit changes"

### 4. In StackBlitz oeffnen (zum Entwickeln/Testen im Browser)
Rufe im Browser folgende URL auf (DEIN-USERNAME und REPO-NAME anpassen):

```
https://stackblitz.com/github/DEIN-USERNAME/flagged-deckbuilder
```

StackBlitz installiert automatisch alle Pakete (inkl. `firebase`) und startet
die App direkt im Browser — es passiert nichts auf deinem lokalen Rechner.

### 5. Karten importieren
1. In der laufenden App: Tab **"Admin: Import"**
2. Klick auf **"Karten jetzt importieren"**
3. Warten, bis "Fertig! 110 Karten wurden importiert" erscheint

### 6. Testen
- Tab **"Karten"**: sollte alle 110 Karten anzeigen
- Tab **"Deckbuilder"**: Namen eingeben, Held waehlen, Deck zusammenstellen, speichern
- Tab **"Meine Decks"**: gespeichertes Deck sollte auftauchen

## Bevor du den Link an Partner schickst

Aktuell sind die Firestore-Regeln im **Testmodus** (voellig offen, 30 Tage).
Bevor du das oeffentlich teilst:
1. Firebase Console -> Firestore Database -> Rules
2. Inhalt von `firestore.rules` (aus diesem Projekt) einfuegen
3. "Publish" klicken

Das sperrt zumindest das Verandern/Loeschen von Karten und Decks von aussen,
auch ohne eigene Benutzer-Anmeldung.

## Bekannte Einschraenkungen (bewusste Vereinfachungen fuer die erste Version)

- Keine echte Benutzer-Authentifizierung — "Dein Name" ist nur ein Freitextfeld,
  gespeichert im Browser. Jeder koennte theoretisch unter deinem Namen speichern.
- Das Standard-Kartenlimit pro Nicht-Helden-Karte ist auf 3 gesetzt
  (`DEFAULT_CARD_LIMIT` in `DeckBuilder.jsx`) — falls das Regelheft eine andere
  Zahl vorgibt, einfach diesen Wert anpassen.
- Kartenbilder fehlen noch (nur Text + Icon) — kann spaeter erganzt werden,
  sobald Bilddateien vorhanden sind.
