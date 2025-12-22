import { getFirebaseAdmin } from "../config/firebaseAdmin.js";
import { Resend } from "resend";
import { env } from "../config/env.js";

function randomPassword(length = 24) {
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let out = "";
  for (let i = 0; i < length; i++) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => {
    const map = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;",
    };
    return map[c] || c;
  });
}

function inviteEmailTemplate({ firstName, lastName, role, email, resetLink }) {
  return `
  <div style="font-family:Arial,sans-serif;line-height:1.5;color:#0f172a">
    <h2 style="margin:0 0 12px 0;">Hola ${escapeHtml(firstName)} 👋</h2>
    <p style="margin:0 0 12px 0;">Se creó tu acceso al sistema administrativo.</p>

    <p style="margin:0 0 16px 0;">
      <b>Nombre:</b> ${escapeHtml(firstName)} ${escapeHtml(lastName)}<br/>
      <b>Rol:</b> ${escapeHtml(role)}<br/>
      <b>Usuario:</b> ${escapeHtml(email)}
    </p>

    <p style="margin:0 0 16px 0;">Para definir tu contraseña, haz clic aquí:</p>

    <p style="margin:0 0 20px 0;">
      <a href="${resetLink}"
         style="display:inline-block;background:#16a34a;color:#fff;padding:10px 14px;border-radius:8px;text-decoration:none;">
        Crear contraseña
      </a>
    </p>

    <p style="margin:0;color:#475569;font-size:12px;">
      Si no esperabas este correo, puedes ignorarlo.
    </p>
  </div>`;
}

function assertEmailConfig() {
  if (!env.resendApiKey) {
    const err = new Error("Missing RESEND_API_KEY");
    err.code = "missing-email-config";
    throw err;
  }

  if (!env.resendFrom) {
    const err = new Error("Missing RESEND_FROM");
    err.code = "missing-email-config";
    throw err;
  }

  // Si estás en modo gratis sin dominio, lo normal es usar @resend.dev
  // No es obligatorio, pero te avisa si pusiste un from que probablemente fallará.
  if (
    typeof env.resendFrom === "string" &&
    env.resendFrom.length > 0 &&
    !env.resendFrom.includes("@resend.dev")
  ) {
    console.warn(
      "[mail] RESEND_FROM no es @resend.dev. Si no tienes dominio verificado, puede fallar:",
      env.resendFrom
    );
  }
}

export class UsersService {
  constructor() {
    this.admin = getFirebaseAdmin();

    assertEmailConfig();

    if (!env.resetPasswordRedirectUrl) {
      const err = new Error("Missing RESET_PASSWORD_REDIRECT_URL");
      err.code = "missing-config";
      throw err;
    }

    this.resend = new Resend(env.resendApiKey);
  }

  /**
   * Crea un usuario en Firebase Auth + Firestore y envía invitación con link de "crear contraseña".
   * - Crea password temporal (NO se envía).
   * - Genera Password Reset Link (Firebase) para que el usuario defina su contraseña.
   * - Envía correo con Resend.
   * - Rollback best-effort si algo falla.
   */
  async createUserAndInvite({ firstName, lastName, role, email, createdByUid }) {
    const normalizedEmail = String(email).trim().toLowerCase();

    const safeFirstName = String(firstName ?? "").trim();
    const safeLastName = String(lastName ?? "").trim();
    const safeRole = String(role ?? "").trim();

    let uid = null;

    try {
      // 1) Crear usuario en Auth con password temporal (NO se envía)
      const tempPassword = randomPassword(24);

      const userRecord = await this.admin.auth().createUser({
        email: normalizedEmail,
        password: tempPassword,
        displayName: `${safeFirstName} ${safeLastName}`.trim(),
        emailVerified: false,
        disabled: false,
      });

      uid = userRecord.uid;

      // 2) Guardar en Firestore
      await this.admin.firestore().doc(`users/${uid}`).set(
        {
          firstName: safeFirstName,
          lastName: safeLastName,
          role: safeRole,
          email: normalizedEmail,

          // Recomendado: pending hasta que el usuario cree su contraseña
          // (si quieres dejarlo como "active" desde el inicio, cámbialo aquí)
          status: "pending",

          createdAt: this.admin.firestore.FieldValue.serverTimestamp(),
          createdBy: createdByUid ?? null,
        },
        { merge: true }
      );

      // 3) Custom claims (opcional)
      // Nota: los custom claims se reflejan cuando el usuario vuelve a iniciar sesión.
      await this.admin.auth().setCustomUserClaims(uid, { role: safeRole });

      // 4) Generar link de reset para que cree su contraseña
      const resetLink = await this.admin.auth().generatePasswordResetLink(
        normalizedEmail,
        {
          url: env.resetPasswordRedirectUrl,
          handleCodeInApp: false,
        }
      );

      // 5) Enviar correo
      console.log("[mail] sending invite to:", normalizedEmail);
      console.log("[mail] from:", env.resendFrom);

      const resp = await this.resend.emails.send({
        from: env.resendFrom,
        to: normalizedEmail,
        subject: "Invitación: crea tu contraseña",
        html: inviteEmailTemplate({
          firstName: safeFirstName,
          lastName: safeLastName,
          role: safeRole,
          email: normalizedEmail,
          resetLink,
        }),
      });

      // Resend puede responder con { error } sin lanzar excepción
      if (resp?.error) {
        console.error("[mail] resend error:", resp.error);
        const err = new Error(resp.error.message || "Resend failed");
        err.code = "resend-error";
        throw err;
      }

      console.log("[mail] sent ok:", resp?.data?.id ?? resp);

      return {
        uid,
        email: normalizedEmail,
        status: "pending",
      };
    } catch (e) {
      console.error("[createUserAndInvite] failed:", e?.message ?? e);

      // Error más entendible si el correo ya existe
      if (e?.code === "auth/email-already-exists") {
        const err = new Error("Ya existe un usuario con ese correo");
        err.code = "email-already-exists";
        throw err;
      }

      // Rollback best-effort si algo falló luego de crear al usuario
      if (uid) {
        await this.admin.auth().deleteUser(uid).catch(() => {});
        await this.admin.firestore().doc(`users/${uid}`).delete().catch(() => {});
      }

      throw e;
    }
  }
}