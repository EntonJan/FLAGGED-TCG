import { useState } from 'react'
import { db } from '../firebase.js'
import { doc, setDoc } from 'firebase/firestore'
import cardsData from '../data/cards.json'

// Dieser Bereich ist nur fuer dich als Admin gedacht.
// Er schreibt alle Karten aus cards.json in die Firestore-Collection "cards".
// Du musst das nur EINMAL ausfuehren (oder erneut, falls sich die Kartendaten aendern).

export default function ImportCards() {
  const [status, setStatus] = useState('')
  const [running, setRunning] = useState(false)

  async function handleImport() {
    setRunning(true)
    setStatus(`Importiere ${cardsData.length} Karten...`)

    let count = 0
    for (const card of cardsData) {
      try {
        // Wir nutzen card.id (z.B. "046") als Dokument-ID.
        // Dadurch ueberschreibt ein erneuter Import einfach die alten Daten,
        // statt Duplikate zu erzeugen.
        await setDoc(doc(db, 'cards', card.id), card)
        count += 1
        setStatus(`Importiere... ${count} / ${cardsData.length}`)
      } catch (err) {
        setStatus(`Fehler bei Karte ${card.name}: ${err.message}`)
        setRunning(false)
        return
      }
    }

    setStatus(`Fertig! ${count} Karten wurden nach Firestore importiert.`)
    setRunning(false)
  }

  return (
    <div className="panel">
      <h2>Admin: Karten importieren</h2>
      <p>
        Dies schreibt alle {cardsData.length} Karten aus der lokalen Datei
        <code> src/data/cards.json</code> in deine Firestore-Datenbank
        (Collection <code>cards</code>).
      </p>
      <p>
        Du musst das nur einmal machen. Wenn du die Kartendaten spaeter
        aktualisierst, kannst du den Import einfach erneut ausfuehren.
      </p>
      <button onClick={handleImport} disabled={running}>
        {running ? 'Importiere...' : 'Karten jetzt importieren'}
      </button>
      {status && <p className="status">{status}</p>}
    </div>
  )
}
