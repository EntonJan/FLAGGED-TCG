# FLAGGED — Digitale Umsetzung

Web-App zum Bauen, Speichern und Teilen von Decks **und** zum Spielen von
Live-1v1-Partien für das Kartenspiel FLAGGED.

## Architektur

Bewusst **kein Build-Prozess, kein npm, kein StackBlitz**. Die komplette App
steckt in einer einzigen Datei: **`index.html`**.

- React + ReactDOM werden per CDN-`<script>`-Tag geladen
- Babel Standalone übersetzt JSX live im Browser (kein Build-Schritt)
- Firebase (compat-Version, Firestore) wird ebenfalls per CDN geladen
- Alle 110 Kartendaten (inkl. Bilder als Base64) sowie die komplette
  Spiel-Engine sind direkt in der Datei eingebettet — kein externer Server
  außer Firestore für Lobby/Matchdaten nötig

### Die Spiel-Engine

Getrennt von der UI gibt es eine eigenständige, reine JavaScript-Engine
(Regelwerk, Zugvalidierung, Effektausführung), die 1:1 in `index.html`
eingebettet ist, aber auch unabhängig mit `node` getestet werden kann.
Kernstücke:

- **`board.js`** — Spielfeld-Geometrie: Koordinaten, Wände, Sichtlinien,
  Bewegungsvalidierung
- **`matchState.js`** — Zustand einer laufenden Partie: Züge, Zugbudget,
  Statuseffekte, Fallen, Sperrzonen, Priorität/Konterketten
- **`counterChain.js`** — Auflösung von reaktiven Ketten (Konterkarten)
- **`effectExecutor.js`** — führt die strukturierten Karteneffekte aus
  (jede Karte ist als Sequenz von Aktionen wie `move`, `capture_figure`,
  `place_trap` usw. hinterlegt, nicht als Freitext)

Über **200 automatisierte Tests** (Node, ohne Framework) decken Regel-Ecken,
Statuseffekt-Timing, Konterketten und alle bisher systematisch geprüften
Karten ab.

## Enthaltene Funktionen

### Deckbuilder-Bereich
- **Karten**-Tab: Kartenbrowser mit Suche/Filter nach Klasse und Kartentyp
  (Standard, Klassenkarte, Konter, Ultimate, Team, Falle, Held)
- **Deckbuilder**-Tab: Held wählen, passende Karten hinzufügen, mit
  automatischer Prüfung von Kartenlimits (inkl. max. 3 Ultimate-Karten
  gesamt pro Deck, max. 1 Kopie pro Ultimate), Deck speichern
- **Meine Decks**-Tab: eigene gespeicherte Decks + öffentlich geteilte
  Decks anderer Spieler
- **Admin: Import**-Tab: Ein-Klick-Import aller Karten nach Firestore

### Live-Match-Bereich
- Lobby: Partie per Code erstellen oder beitreten, Deck & Held vorab wählen
- Vollständiges 8×8-Spielfeld mit eigener Hintergrundgrafik, Figuren
  (Held, Klon, Wolf, Wände), Deck-/Held-/Friedhof-Zonen je Spieler
- **180°-Drehung** des gesamten Feldes für den zweiten Spieler (wie eine
  physische Spielmatte zwischen zwei Gegenübersitzenden) — Startspieler
  (zieht zuerst) sieht das Feld unrotiert
- Karten spielen inkl. mehrstufiger Zielauswahl (Feld, Figur, Wand, Karten
  abwerfen, aus Deck/Ablage suchen, Wahlmöglichkeiten)
- Konterketten mit Prioritätsweitergabe
- Fallen-Mechanik: verdeckt platzieren, automatisches Auslösen bei
  gegnerischem Betreten
- Sperrzonen (Flächenobjekte wie Bannkreis), Statuseffekte mit korrektem
  Ablauf-Timing

## Setup (ohne Terminal, ohne Coding-Erfahrung)

### 1. Firebase-Projekt & Firestore
Firebase-Projekt anlegen, Firestore Database aktivieren (Standard Edition),
Web-App registrieren und den Config-Block kopieren
(Projekteinstellungen → General → Deine Apps).

### 2. Config eintragen
1. `index.html` in einem Texteditor öffnen — **nicht** über den GitHub-
   Web-Editor, siehe Warnhinweis unten!
2. Den Platzhalter-Block `firebaseConfig` durch deine echten Werte ersetzen
3. Speichern

### 3. Lokal testen (optional)
Doppelklick auf `index.html` → öffnet direkt im Browser. Kein Server,
keine Installation nötig.

### 4. Auf GitHub hochladen

> ⚠️ **Wichtig:** `index.html` enthält einige extrem lange einzelne Zeilen
> (eingebettete Bilder als Base64). Der GitHub-Web-Editor (Stift-Symbol /
> "Datei bearbeiten") kann daran scheitern und die Datei leer speichern!
> **Immer per "Add file → Upload files" hochladen**, niemals über den
> Web-Editor öffnen oder umbenennen.

1. Neues Repo auf [github.com/new](https://github.com/new) anlegen
2. `index.html`, `README.md` und `firestore.rules` per **Upload files**
   hochladen
3. Commit changes

### 5. Online stellen mit GitHub Pages
1. Im Repo: **Settings → Pages**
2. Bei "Source": Branch `main`, Ordner `/ (root)` → Save
3. Nach ca. 1 Minute ist die App unter einer URL wie
   `https://DEIN-USERNAME.github.io/DEIN-REPO/` erreichbar

### 6. Karten importieren
1. Die Live-URL im Browser öffnen
2. Tab **"Admin: Import"** → Button **"Karten jetzt importieren"** klicken
3. Warten bis "Fertig! 110 Karten wurden importiert" erscheint

## Bevor du den Link an Partner schickst

Die Firestore-Regeln aus `firestore.rules` schränken Schreibzugriff auf die
Karten-Collection auf eine feste Admin-E-Mail ein. Firebase Console →
Firestore Database → Rules → Inhalt von `firestore.rules` einfügen →
"Publish".

## Bekannte Einschränkungen (bewusste Vereinfachungen)

- Keine echte Benutzer-Authentifizierung über die App hinaus — Anmeldung
  läuft über Firebase Auth, aber es gibt keine Rollen/Berechtigungen außer
  der Admin-E-Mail-Prüfung für den Kartenimport.
- Standard-Kartenlimit für Karten ohne explizites Limit: 3 pro Deck
  (Konstante `DEFAULT_CARD_LIMIT`).
- Noch nicht umgesetzt: Hand-Zone und Fallenzone als eigene visuelle
  Bereiche unterhalb des Feldes, Heldenfähigkeit-Flip-Mechanik
  (Ritter/Waldläufer-Einmaleffekt), King-of-the-Hill-/Arena-Modus,
  Schattenklon-Verwaltung, Portal-Automatik.
- Kartenaudit läuft fortlaufend: von 106 nicht-Helden-Karten sind aktuell
  über 45 systematisch geprüft und gegebenenfalls korrigiert; der Rest ist
  spielbar, aber noch nicht im Detail verifiziert.

## Entwicklungs-Workflow

Änderungen an dieser App entstehen iterativ mit Unterstützung von Claude
(Anthropic). Jede Session baut auf der zuletzt ausgelieferten Version auf.
Vor jeder Auslieferung wird die komplette Datei geprüft: alle reinen
`<script>`-Blöcke per `node --check`, der React/JSX-Teil per Babel-Compile,
sowie die vollständige Engine-Testsuite (`node engine/*.test.js`).
