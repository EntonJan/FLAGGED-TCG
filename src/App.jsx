import { useState } from 'react'
import CardList from './components/CardList.jsx'
import DeckBuilder from './components/DeckBuilder.jsx'
import MyDecks from './components/MyDecks.jsx'
import ImportCards from './components/ImportCards.jsx'

const TABS = [
  { id: 'cards', label: 'Karten' },
  { id: 'builder', label: 'Deckbuilder' },
  { id: 'decks', label: 'Meine Decks' },
  { id: 'admin', label: 'Admin: Import' },
]

export default function App() {
  const [activeTab, setActiveTab] = useState('cards')

  return (
    <div className="app">
      <header className="app-header">
        <h1>Flagged Deckbuilder</h1>
        <nav className="tabs">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              className={activeTab === tab.id ? 'tab active' : 'tab'}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </header>

      <main className="app-content">
        {activeTab === 'cards' && <CardList />}
        {activeTab === 'builder' && <DeckBuilder />}
        {activeTab === 'decks' && <MyDecks />}
        {activeTab === 'admin' && <ImportCards />}
      </main>
    </div>
  )
}
