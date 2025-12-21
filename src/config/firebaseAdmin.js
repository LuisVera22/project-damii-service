import admin from "firebase-admin";
import { env } from "./env.js";

function stripWrappingQuotes(s) {
  const t = String(s ?? "").trim();
  if (
    (t.startsWith('"') && t.endsWith('"')) ||
    (t.startsWith("'") && t.endsWith("'"))
  ) {
    return t.slice(1, -1);
  }
  return t;
}

function trimToFirstJsonObject(s) {
  // Si hay basura antes del {, cortamos desde el primer {
  const idx = s.indexOf("{");
  if (idx === -1) return s;
  return s.slice(idx).trim();
}

function safePreview(str) {
  const s = String(str ?? "");
  return `${s.slice(0, 20)}...${s.slice(-20)}`;
}

export function getFirebaseAdmin() {
  if (admin.apps.length) return admin;

  if (!env.firebaseServiceAccountJson) {
    throw new Error(
      "Missing env.firebaseServiceAccountJson (FIREBASE_SERVICE_ACCOUNT_JSON)"
    );
  }

  try {
    // 1) limpiar comillas externas
    let raw = stripWrappingQuotes(env.firebaseServiceAccountJson);

    // 2) recortar basura antes del primer '{'
    raw = trimToFirstJsonObject(raw);

    // 3) normalizar saltos (por si viene con \r)
    raw = raw.replace(/\r/g, "");

    const serviceAccount = JSON.parse(raw);

    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });

    return admin;
  } catch (e) {
    console.error("[firebaseAdmin] Failed to parse service account JSON.");
    console.error(
      "[firebaseAdmin] FIREBASE_SERVICE_ACCOUNT_JSON preview:",
      safePreview(env.firebaseServiceAccountJson)
    );
    throw e;
  }
}
