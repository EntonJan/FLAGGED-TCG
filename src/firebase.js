import { initializeApp } from 'firebase/app'
import { getFirestore } from 'firebase/firestore'

// ============================================================
// WICHTIG: Trage hier deinen eigenen Firebase-Config-Block ein.
// Du findest ihn in der Firebase Console unter:
// Projekteinstellungen -> General -> "Deine Apps" -> Web-App
// ============================================================
const firebaseConfig = {
  apiKey: "HIER_DEINEN_API_KEY_EINFUEGEN",
  authDomain: "HIER_DEINE_AUTH_DOMAIN_EINFUEGEN",
  projectId: "HIER_DEINE_PROJECT_ID_EINFUEGEN",
  storageBucket: "HIER_DEIN_STORAGE_BUCKET_EINFUEGEN",
  messagingSenderId: "HIER_DEINE_SENDER_ID_EINFUEGEN",
  appId: "HIER_DEINE_APP_ID_EINFUEGEN",
}

const app = initializeApp(firebaseConfig)
export const db = getFirestore(app)
