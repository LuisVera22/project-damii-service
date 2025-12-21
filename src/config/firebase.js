const admin = require('firebase-admin');

function initFirebaseAdmin() {
  if (admin.apps.length) return admin;

  const json = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (json) {
    const serviceAccount = JSON.parse(json);
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
    return admin;
  }

  return admin;
}

module.exports = { admin: initFirebaseAdmin() };
