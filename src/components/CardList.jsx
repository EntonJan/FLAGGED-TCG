import { useEffect, useState, useMemo } from 'react'
import { db } from '../firebase.js'
import { collection, getDocs } from 'firebase/firestore'

const CLASSES = ['Alle', 'Assassine', 'Ritter', 'Ranger', 'Zauberer', 'Neutral', 'Team']

export default function CardList() {
  const [cards, setCards] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [classFilter, setClassFilter] = useState('Alle')

  useEffect(() => {
    async function loadCards() {
      try {
        const snapshot = await getDocs(collection(db, 'cards'))
        const loaded = snapshot.docs.map((d) => d.data())
        // Sortiert nach der Kartennummer
        loaded.sort((a, b) => a.id.localeCompare(b.id))
        setCards(loaded)
      } catch (err) {
        setError(
          'Konnte Karten nicht laden. Wurde der Import (Tab "Admin: Import") schon ausgefuehrt? ' +
            err.message
        )
      } finally {
        setLoading(false)
      }
    }
    loadCards()
  }, [])

  const filteredCards = useMemo(() => {
    return cards.filter((card) => {
      const matchesClass = classFilter === 'Alle' || card.class === classFilter
      const matchesSearch =
        search.trim() === '' ||
        card.name.toLowerCase().includes(search.trim().toLowerCase())
      return matchesClass && matchesSearch
    })
  }, [cards, search, classFilter])

  if (loading) return <div className="panel">Lade Karten...</div>
  if (error) return <div className="panel error">{error}</div>

  return (
    <div className="panel">
      <h2>Karten ({filteredCards.length} von {cards.length})</h2>

      <div className="filters">
        <input
          type="text"
          placeholder="Karte suchen..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select value={classFilter} onChange={(e) => setClassFilter(e.target.value)}>
          {CLASSES.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
      </div>

      <div className="card-grid">
        {filteredCards.map((card) => (
          <div key={card.id} className="card-tile">
            <div className="card-tile-header">
              <span className="card-icon">{card.icon}</span>
              <span className="card-name">{card.name}</span>
            </div>
            <div className="card-meta">
              {card.class} · {card.cardType}
              {card.deckLimit ? ` · max. ${card.deckLimit}x im Deck` : ''}
            </div>
            <p className="card-description">{card.description}</p>
          </div>
        ))}
      </div>
    </div>
  )
}
