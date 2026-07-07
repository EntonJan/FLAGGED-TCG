import { useEffect, useState } from 'react'
import { db } from '../firebase.js'
import { collection, getDocs, query, where } from 'firebase/firestore'

export default function MyDecks() {
  const [myDecks, setMyDecks] = useState([])
  const [publicDecks, setPublicDecks] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const ownerName = localStorage.getItem('flagged_owner_name') || ''

  useEffect(() => {
    async function loadDecks() {
      try {
        const decksRef = collection(db, 'decks')

        if (ownerName) {
          const mineQuery = query(decksRef, where('ownerName', '==', ownerName))
          const mineSnap = await getDocs(mineQuery)
          setMyDecks(mineSnap.docs.map((d) => ({ id: d.id, ...d.data() })))
        }

        const publicQuery = query(decksRef, where('isPublic', '==', true))
        const publicSnap = await getDocs(publicQuery)
        setPublicDecks(publicSnap.docs.map((d) => ({ id: d.id, ...d.data() })))
      } catch (err) {
        setError('Konnte Decks nicht laden: ' + err.message)
      } finally {
        setLoading(false)
      }
    }
    loadDecks()
  }, [ownerName])

  if (loading) return <div className="panel">Lade Decks...</div>
  if (error) return <div className="panel error">{error}</div>

  return (
    <div className="panel">
      <h2>Meine Decks {ownerName ? `(${ownerName})` : ''}</h2>
      {!ownerName && <p>Gib im Deckbuilder zuerst deinen Namen ein, um deine Decks zu sehen.</p>}

      <DeckGrid decks={myDecks} emptyText="Du hast noch keine Decks gespeichert." />

      <h2>Oeffentliche Meta-Decks</h2>
      <DeckGrid decks={publicDecks} emptyText="Es wurden noch keine Decks oeffentlich geteilt." />
    </div>
  )
}

function DeckGrid({ decks, emptyText }) {
  if (decks.length === 0) return <p>{emptyText}</p>
  return (
    <div className="deck-grid">
      {decks.map((deck) => (
        <div key={deck.id} className="deck-tile">
          <h3>{deck.name}</h3>
          <p className="card-meta">
            {deck.heroName} ({deck.heroClass}) · {deck.totalCards} Karten
          </p>
          <p className="card-meta">von {deck.ownerName}</p>
          <ul className="deck-card-list">
            {deck.cards?.map((c) => (
              <li key={c.cardId}>{c.name} x{c.count}</li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  )
}
