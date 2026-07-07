import { useEffect, useMemo, useState } from 'react'
import { db } from '../firebase.js'
import { collection, getDocs, addDoc, serverTimestamp } from 'firebase/firestore'

const DEFAULT_CARD_LIMIT = 3 // Standardlimit, falls die Karte kein eigenes Limit angibt.
// WICHTIG: Passe DEFAULT_CARD_LIMIT an die echte Regel aus dem Regelheft an,
// falls es dort ein anderes Standardlimit gibt.

export default function DeckBuilder() {
  const [allCards, setAllCards] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [heroId, setHeroId] = useState('')
  const [deckName, setDeckName] = useState('')
  const [ownerName, setOwnerName] = useState(
    () => localStorage.getItem('flagged_owner_name') || ''
  )
  const [isPublic, setIsPublic] = useState(false)
  const [deckCounts, setDeckCounts] = useState({}) // { cardId: count }
  const [saveStatus, setSaveStatus] = useState('')

  useEffect(() => {
    async function loadCards() {
      try {
        const snapshot = await getDocs(collection(db, 'cards'))
        setAllCards(snapshot.docs.map((d) => d.data()))
      } catch (err) {
        setError('Konnte Karten nicht laden: ' + err.message)
      } finally {
        setLoading(false)
      }
    }
    loadCards()
  }, [])

  useEffect(() => {
    localStorage.setItem('flagged_owner_name', ownerName)
  }, [ownerName])

  const heroes = useMemo(() => allCards.filter((c) => c.cardType === 'Held'), [allCards])
  const nonHeroCards = useMemo(() => allCards.filter((c) => c.cardType !== 'Held'), [allCards])
  const selectedHero = heroes.find((h) => h.id === heroId)

  // Nur Karten der gewaehlten Klasse + neutrale + Team-Karten duerfen ins Deck.
  const playableCards = useMemo(() => {
    if (!selectedHero) return []
    return nonHeroCards.filter(
      (c) => c.class === selectedHero.class || c.class === 'Neutral' || c.class === 'Team'
    )
  }, [nonHeroCards, selectedHero])

  const totalCardsInDeck = Object.values(deckCounts).reduce((a, b) => a + b, 0)
  const totalTraps = playableCards
    .filter((c) => c.cardType === 'Falle')
    .reduce((sum, c) => sum + (deckCounts[c.id] || 0), 0)

  function getLimitFor(card) {
    return card.deckLimit || DEFAULT_CARD_LIMIT
  }

  function addCard(card) {
    const current = deckCounts[card.id] || 0
    const limit = getLimitFor(card)

    if (current >= limit) return

    if (card.cardType === 'Falle' && card.trapDeckLimit && totalTraps >= card.trapDeckLimit) {
      alert(`Fallen-Limit erreicht (max. ${card.trapDeckLimit} Fallen im Deck).`)
      return
    }

    setDeckCounts((prev) => ({ ...prev, [card.id]: current + 1 }))
  }

  function removeCard(card) {
    const current = deckCounts[card.id] || 0
    if (current <= 1) {
      const rest = { ...deckCounts }
      delete rest[card.id]
      setDeckCounts(rest)
    } else {
      setDeckCounts((prev) => ({ ...prev, [card.id]: current - 1 }))
    }
  }

  async function saveDeck() {
    if (!selectedHero) {
      alert('Bitte waehle zuerst einen Helden.')
      return
    }
    if (!deckName.trim()) {
      alert('Bitte gib deinem Deck einen Namen.')
      return
    }
    if (!ownerName.trim()) {
      alert('Bitte gib deinen Namen ein (damit du dein Deck spaeter wiederfindest).')
      return
    }

    setSaveStatus('Speichere...')
    try {
      const deckCards = Object.entries(deckCounts).map(([cardId, count]) => {
        const card = allCards.find((c) => c.id === cardId)
        return { cardId, name: card?.name || cardId, count }
      })

      await addDoc(collection(db, 'decks'), {
        name: deckName.trim(),
        ownerName: ownerName.trim(),
        heroId: selectedHero.id,
        heroName: selectedHero.name,
        heroClass: selectedHero.class,
        cards: deckCards,
        totalCards: totalCardsInDeck,
        isPublic,
        createdAt: serverTimestamp(),
      })

      setSaveStatus('Deck gespeichert! Du findest es unter "Meine Decks".')
      setDeckName('')
      setDeckCounts({})
    } catch (err) {
      setSaveStatus('Fehler beim Speichern: ' + err.message)
    }
  }

  if (loading) return <div className="panel">Lade Karten...</div>
  if (error) return <div className="panel error">{error}</div>

  return (
    <div className="panel">
      <h2>Deckbuilder</h2>

      <div className="form-row">
        <label>Dein Name</label>
        <input
          type="text"
          placeholder="z.B. Enton"
          value={ownerName}
          onChange={(e) => setOwnerName(e.target.value)}
        />
      </div>

      <div className="form-row">
        <label>Held / Klasse waehlen</label>
        <select value={heroId} onChange={(e) => { setHeroId(e.target.value); setDeckCounts({}) }}>
          <option value="">-- Held waehlen --</option>
          {heroes.map((h) => (
            <option key={h.id} value={h.id}>{h.name} ({h.class})</option>
          ))}
        </select>
      </div>

      {selectedHero && (
        <>
          <div className="form-row">
            <label>Deckname</label>
            <input
              type="text"
              placeholder="z.B. Aggro Assassine"
              value={deckName}
              onChange={(e) => setDeckName(e.target.value)}
            />
          </div>

          <div className="form-row checkbox-row">
            <label>
              <input
                type="checkbox"
                checked={isPublic}
                onChange={(e) => setIsPublic(e.target.checked)}
              />
              Als Meta-Deck oeffentlich teilen
            </label>
          </div>

          <p>Karten im Deck: <strong>{totalCardsInDeck}</strong></p>

          <div className="deck-columns">
            <div className="deck-column">
              <h3>Verfuegbare Karten ({selectedHero.class} + Neutral + Team)</h3>
              <div className="card-list-compact">
                {playableCards.map((card) => {
                  const count = deckCounts[card.id] || 0
                  const limit = getLimitFor(card)
                  return (
                    <div key={card.id} className="card-row">
                      <span className="card-icon">{card.icon}</span>
                      <span className="card-row-name">{card.name}</span>
                      <span className="card-row-count">{count}/{limit}</span>
                      <button onClick={() => addCard(card)} disabled={count >= limit}>+</button>
                    </div>
                  )
                })}
              </div>
            </div>

            <div className="deck-column">
              <h3>Dein Deck</h3>
              <div className="card-list-compact">
                {Object.entries(deckCounts).length === 0 && <p>Noch keine Karten gewaehlt.</p>}
                {Object.entries(deckCounts).map(([cardId, count]) => {
                  const card = allCards.find((c) => c.id === cardId)
                  if (!card) return null
                  return (
                    <div key={cardId} className="card-row">
                      <span className="card-icon">{card.icon}</span>
                      <span className="card-row-name">{card.name}</span>
                      <span className="card-row-count">x{count}</span>
                      <button onClick={() => removeCard(card)}>-</button>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>

          <button className="save-button" onClick={saveDeck}>Deck speichern</button>
          {saveStatus && <p className="status">{saveStatus}</p>}
        </>
      )}
    </div>
  )
}
