import { getFirebaseAdmin } from "../config/firebaseAdmin.js";

function extractBearerToken(authHeader) {
  if (!authHeader) return null;
  const [type, token] = authHeader.split(" ");
  if (type !== "Bearer" || !token) return null;
  return token;
}

// Middleware estricto: requiere token
export async function requireFirebaseAuth(req, res, next) {
  try {
    const token = extractBearerToken(req.headers.authorization);

    if (!token) {
      return res.status(401).json({ message: "Missing Authorization Bearer token" });
    }

    const admin = getFirebaseAdmin();
    const decoded = await admin.auth().verifyIdToken(token);

    // “inyectas” el usuario en la request:
    req.user = {
      uid: decoded.uid,
      email: decoded.email,
      name: decoded.name,
      picture: decoded.picture,
      claims: decoded,
    };

    return next();
  } catch (e) {
    return res.status(401).json({ message: "Invalid or expired token" });
  }
}

// Middleware opcional: si hay token lo valida, si no, deja pasar
export async function optionalFirebaseAuth(req, _res, next) {
  const token = extractBearerToken(req.headers.authorization);
  if (!token) return next();

  try {
    const admin = getFirebaseAdmin();
    const decoded = await admin.auth().verifyIdToken(token);
    req.user = {
      uid: decoded.uid,
      email: decoded.email,
      name: decoded.name,
      picture: decoded.picture,
      claims: decoded,
    };
  } catch {
    // no hacemos nada si falla
  }

  return next();
}
