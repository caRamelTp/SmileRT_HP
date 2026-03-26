/* ============================================================
   Firebase Configuration for SmileRT LIVE Manager
   ============================================================ */

const firebaseConfig = {
  apiKey: "AIzaSyAkMQc0qp4-5-E-XA8CllJMqM5lMFETnnc",
  authDomain: "smilert-kanri.firebaseapp.com",
  databaseURL: "https://smilert-kanri-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "smilert-kanri",
  storageBucket: "smilert-kanri.firebasestorage.app",
  messagingSenderId: "335273278448",
  appId: "1:335273278448:web:55965a263f4d0fd54b3b35"
};

// Initialize Firebase (compat SDK)
firebase.initializeApp(firebaseConfig);
const firebaseDB = firebase.database();
