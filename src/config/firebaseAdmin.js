import admin from "firebase-admin";
import { env } from "./env.js";

export function getFirebaseAdmin() {
  if (admin.apps.length) return admin;

  if (!env.firebaseServiceAccountJson) {
    throw new Error(
      "Missing FIREBASE_SERVICE_ACCOUNT_JSON"
    );
  }

  let serviceAccount;
  try {
    serviceAccount = JSON.parse(env.firebaseServiceAccountJson);
  } catch (e) {
    console.error("FIREBASE_SERVICE_ACCOUNT_JSON is invalid JSON");
    throw e;
  }

  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });

  return admin;
}
