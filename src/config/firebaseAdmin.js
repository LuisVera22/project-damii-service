import admin from "firebase-admin";
import { env } from "./env.js";

export function getFirebaseAdmin() {
  if (admin.apps.length) return admin;

  if (!env.firebaseServiceAccountJson) {
    throw new Error("Missing env.firebaseServiceAccountJson (FIREBASE_SERVICE_ACCOUNT_JSON)");
  }

  const serviceAccount = JSON.parse(env.firebaseServiceAccountJson);

  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });

  return admin;
}
