import { getFirebaseAdmin } from "../config/firebaseAdmin.js";

function extractBearerToken(authHeader) {
  if (!authHeader) return null;
  const [type, token] = authHeader.split(" ");
  if (type !== "Bearer" || !token) return null;
  return token;
}

// Estricto: requiere token válido
export async function requireFirebaseAuth(req, res, next) {
  try {
    const token = extractBearerToken(req.headers.authorization);

    if (!token) {
      return res
        .status(401)
        .json({ message: "Missing Authorization Bearer token" });
    }

    const admin = getFirebaseAdmin();
    const decoded = await admin.auth().verifyIdToken(token);

    req.user = {
      uid: decoded.uid,
      email: decoded.email,
      name: decoded.name,
      picture: decoded.picture,
      claims: decoded, // aquí va role, etc.
    };

    return next();
  } catch (e) {
    return res.status(401).json({ message: "Invalid or expired token" });
  }
}

// Opcional: si hay token lo valida, si no deja pasar
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

export function requireSuperadmin(req, res, next) {
  // tu rol viene en custom claims => req.user.claims.role
  const role = req.user?.claims?.role;

  if (role !== "superadmin") {
    return res.status(403).json({ message: "Permission denied" });
  }

  return next();
}
