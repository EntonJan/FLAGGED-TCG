# Flagged Deckbuilder

Web-App zum Bauen, Speichern und Teilen von Decks fuer das Kartenspiel Flagged.

## Architektur

Bewusst **kein Build-Prozess, kein npm, kein StackBlitz**. Die komplette App
steckt in einer einzigen Datei: **`index.html`**.

- React + ReactDOM werden per CDN-`<script>`-Tag geladen
- Babel Standalone uebersetzt JSX live im Browser (kein Build-Schritt)
- Firebase (compat-Version) wird ebenfalls per CDN geladen
- Alle 110 Kartendaten sind direkt in der Datei eingebettet (`CARDS_DATA`)

Das entspricht dem gleichen Pattern wie der Commander-Tracker (React/Babel CDN).

## Enthaltene Funktionen (alle in `index.html`)

- **Karten**-Tab: Kartenbrowser mit Suche/Filter nach Klasse
- **Deckbuilder**-Tab: Held waehlen, passende Karten hinzufuegen (mit
  automatischer Pruefung von Kartenlimits & Fallen-Limits), Deck speichern
- **Meine Decks**-Tab: eigene gespeicherte Decks + oeffentlich geteilte
  Meta-Decks anderer Spieler
- **Admin: Import**-Tab: Ein-Klick-Import aller Karten nach Firestore
  (kein Terminal, kein Admin-SDK noetig)

## Setup (ohne Terminal, ohne Coding-Erfahrung)

### 1. Firebase-Projekt & Firestore
Falls noch nicht vorhanden: Firebase-Projekt anlegen, Firestore Database
aktivieren (Standard Edition, Testmodus), Web-App registrieren und den
Config-Block kopieren (Projekteinstellungen -> General -> Deine Apps).

### 2. Config eintragen
1. `index.html` in einem Texteditor oeffnen (oder direkt in GitHub bearbeiten)
2. Den Platzhalter-Block `firebaseConfig` (weiter oben in der Datei,
   direkt unter den CDN-`<script>`-Tags) durch deine echten Werte ersetzen
3. Speichern

### 3. Lokal testen (optional)
Doppelklick auf `index.html` -> oeffnet direkt im Browser. Kein Server,
keine Installation noetig.

### 4. Auf GitHub hochladen
1. Neues Repo auf [github.com/new](https://github.com/new) anlegen
2. `index.html`, `README.md` und `firestore.rules` per Drag & Drop hochladen
   ("uploading an existing file")
3. Commit changes

### 5. Online stellen mit GitHub Pages
1. Im Repo: **Settings -> Pages**
2. Bei "Source": Branch `main`, Ordner `/ (root)` -> Save
3. Nach ca. 1 Minute ist die App unter einer URL wie
   `https://DEIN-USERNAME.github.io/DEIN-REPO/` erreichbar

### 6. Karten importieren
1. Die Live-URL (oder lokale Datei) im Browser oeffnen
2. Tab **"Admin: Import"** -> Button **"Karten jetzt importieren"** klicken
3. Warten bis "Fertig! 110 Karten wurden importiert" erscheint

### 7. Testen
- Tab "Karten": sollte alle 110 Karten zeigen
- Tab "Deckbuilder": Namen eingeben, Held waehlen, Deck bauen, speichern
- Tab "Meine Decks": gespeichertes Deck sollte auftauchen

## Bevor du den Link an Partner schickst

Die Firestore-Regeln stehen aktuell im **Testmodus** (30 Tage komplett offen).
Bevor du oeffentlich teilst:
1. Firebase Console -> Firestore Database -> Rules
2. Inhalt von `firestore.rules` (aus diesem Projekt) einfuegen
3. "Publish" klicken

## Bekannte Einschraenkungen (bewusste Vereinfachungen)

- Keine echte Benutzer-Authentifizierung — "Dein Name" ist nur ein
  Freitextfeld, gespeichert im Browser (localStorage). Jeder koennte
  theoretisch unter deinem Namen speichern.
- Standard-Kartenlimit fuer Karten ohne explizites Limit: 3 pro Deck
  (Konstante `DEFAULT_CARD_LIMIT` in `index.html`, im `<script type="text/babel">`-Block
  ganz oben) — bei Bedarf anpassen, falls das Regelheft eine andere Zahl vorgibt.
- Kartenbilder fehlen noch (nur Text + Icon).
