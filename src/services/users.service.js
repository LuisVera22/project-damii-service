// src/services/users.service.js
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
      <a href="${resetLink}" style="display:inline-block;background:#16a34a;color:#fff;padding:10px 14px;border-radius:8px;text-decoration:none;">
        Crear contraseña
      </a>
    </p>

    <p style="margin:0;color:#475569;font-size:12px;">
      Si no esperabas este correo, puedes ignorarlo.
    </p>
  </div>`;
}

export class UsersService {
  constructor() {
    this.admin = getFirebaseAdmin();

    // Config obligatoria para email
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

    this.resend = new Resend(env.resendApiKey);
  }

  async createUserAndInvite({ firstName, lastName, role, email, createdByUid }) {
    const normalizedEmail = String(email).trim().toLowerCase();
    let uid = null;

    try {
      // 1) Crear usuario Auth con password temporal (NO se envía)
      const tempPassword = randomPassword(24);

      const userRecord = await this.admin.auth().createUser({
        email: normalizedEmail,
        password: tempPassword,
        displayName: `${String(firstName).trim()} ${String(lastName).trim()}`,
        emailVerified: false,
      });

      uid = userRecord.uid;

      // 2) Guardar en Firestore
      await this.admin.firestore().doc(`users/${uid}`).set(
        {
          firstName: String(firstName).trim(),
          lastName: String(lastName).trim(),
          role,
          email: normalizedEmail,
          status: "active",
          createdAt: this.admin.firestore.FieldValue.serverTimestamp(),
          createdBy: createdByUid,
        },
        { merge: true }
      );

      // 3) Custom claim role (opcional, útil si luego quieres usar claims)
      await this.admin.auth().setCustomUserClaims(uid, { role });

      // 4) Reset link
      if (!env.resetPasswordRedirectUrl) {
        const err = new Error("Missing RESET_PASSWORD_REDIRECT_URL");
        err.code = "missing-config";
        throw err;
      }

      const resetLink = await this.admin.auth().generatePasswordResetLink(
        normalizedEmail,
        {
          url: env.resetPasswordRedirectUrl,
          handleCodeInApp: false,
        }
      );

      // 5) Email (Resend) + validación de respuesta
      console.log("[mail] sending invite to:", normalizedEmail);
      console.log("[mail] from:", env.resendFrom);

      const resp = await this.resend.emails.send({
        from: env.resendFrom,
        to: normalizedEmail,
        subject: "Invitación: crea tu contraseña",
        html: inviteEmailTemplate({
          firstName,
          lastName,
          role,
          email: normalizedEmail,
          resetLink,
        }),
      });

      // IMPORTANTE: Resend puede “no lanzar” pero devolver error
      if (resp?.error) {
        console.error("[mail] resend error:", resp.error);
        const err = new Error(resp.error.message || "Resend failed");
        err.code = "resend-error";
        throw err;
      }

      console.log("[mail] sent ok:", resp?.data?.id ?? resp);

      return { uid };
    } catch (e) {
      // Rollback best-effort si el correo falla (o cualquier otra falla)
      if (uid) {
        await this.admin.auth().deleteUser(uid).catch(() => {});
        await this.admin.firestore().doc(`users/${uid}`).delete().catch(() => {});
      }
      throw e;
    }
  }
}
