import { initializeApp } from 'firebase/app'
import { getFirestore } from 'firebase/firestore'

// ============================================================
// WICHTIG: Trage hier deinen eigenen Firebase-Config-Block ein.
// Du findest ihn in der Firebase Console unter:
// Projekteinstellungen -> General -> "Deine Apps" -> Web-App
// ============================================================
const firebaseConfig = {
  apiKey: "AIzaSyCbauuFTnFHS8ekzcfFmJIv-cieAy1kW2A",
  authDomain: "flagged-deckbuilder.firebaseapp.com",
  projectId: "flagged-deckbuilder",
  storageBucket: "flagged-deckbuilder.firebasestorage.app",
  messagingSenderId: "987396519744",
  appId: "1:987396519744:web:6a41daa944e21541fceca5"
}

const app = initializeApp(firebaseConfig)
export const db = getFirestore(app)
