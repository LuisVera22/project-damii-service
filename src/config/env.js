import "dotenv/config";

const num = (v, def) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
};

export const env = {
  port: num(process.env.PORT, 8080),

  gcpProjectId: process.env.GCP_PROJECT_ID,
  gcpLocation: process.env.GCP_LOCATION ?? "us-central1",
  vertexModel: process.env.VERTEX_MODEL ?? "gemini-1.5-flash",

  driveFolderId: process.env.DRIVE_FOLDER_ID,

  maxDriveQueries: num(process.env.MAX_DRIVE_QUERIES, 4),
  pageSizePerQuery: num(process.env.PAGE_SIZE_PER_QUERY, 20),
  rerankTopN: num(process.env.RERANK_TOP_N, 25),
  defaultTopK: num(process.env.DEFAULT_TOP_K, 10),

  resendApiKey: process.env.RESEND_API_KEY,
  resendFrom: process.env.RESEND_FROM,
  resetPasswordRedirectUrl:
    process.env.RESET_PASSWORD_REDIRECT_URL || "http://localhost:4200/auth/sign-in",

  firebaseServiceAccountJson: process.env.FIREBASE_SERVICE_ACCOUNT_JSON
};

export function assertEnv() {
  const missing = [];
  if (!env.gcpProjectId) missing.push("GCP_PROJECT_ID");
  if (!env.driveFolderId) missing.push("DRIVE_FOLDER_ID");
  if (!env.resendApiKey) missing.push("RESEND_API_KEY");
  if (!env.resendFrom) missing.push("RESEND_FROM");

  if (missing.length) {
    throw new Error(`Faltan variables de entorno: ${missing.join(", ")}`);
  }
}
