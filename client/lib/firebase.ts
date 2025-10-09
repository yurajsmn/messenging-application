import { initializeApp } from 'firebase/app';
import { getAuth, browserLocalPersistence, setPersistence } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';
import { getAnalytics } from 'firebase/analytics';

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyAaZSaEBrpXUe0Gbg76XhDvWXQTiYhdz_0",
  authDomain: "messenging-app-b43da.firebaseapp.com",
  projectId: "messenging-app-b43da",
  storageBucket: "messenging-app-b43da.firebasestorage.app",
  messagingSenderId: "764147540979",
  appId: "1:764147540979:web:5c4ccc97c6d46a0df8a886",
  measurementId: "G-PX3NDTZ7VH"
};

// Initialize Firebase App
const app = initializeApp(firebaseConfig);

// Initialize Auth with persistence
const auth = getAuth(app);

// Set auth persistence to LOCAL (persists even when browser is closed)
if (typeof window !== 'undefined') {
  setPersistence(auth, browserLocalPersistence).catch((error) => {
    console.error('Error setting auth persistence:', error);
  });
}

// Initialize Analytics (only in browser environment)
let analytics;
if (typeof window !== 'undefined') {
  analytics = getAnalytics(app);
}

// Export services so you can use them in your app
export { auth };                         // For Authentication
export const db = getFirestore(app);    // For Firestore (Database)
export const storage = getStorage(app); // For Cloud Storage
export { analytics };                    // For Analytics