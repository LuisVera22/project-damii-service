import { getFirebaseAdmin } from "../config/firebaseAdmin.js";
import { Resend } from "resend";
import { env } from "../config/env.js";

function randomPassword(length = 24) {
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let out = "";
  for (let i = 0; i < length; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => {
    const map = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" };
    return map[c] || c;
  });
}

function inviteEmailTemplate({ firstName, lastName, role, resetLink }) {
  return `
  <div style="font-family:Arial,sans-serif;line-height:1.5;color:#0f172a">
    <h2 style="margin:0 0 12px 0;">Hola ${escapeHtml(firstName)} 👋</h2>
    <p style="margin:0 0 12px 0;">Se creó tu acceso al sistema administrativo.</p>

    <p style="margin:0 0 16px 0;">
      <b>Nombre:</b> ${escapeHtml(firstName)} ${escapeHtml(lastName)}<br/>
      <b>Rol:</b> ${escapeHtml(role)}<br/>
      <b>Usuario:</b> ${escapeHtml("")}
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
    this.resend = new Resend(env.resendApiKey);
  }

  async createUserAndInvite({ firstName, lastName, role, email, createdByUid }) {
    const normalizedEmail = String(email).trim().toLowerCase();

    // 1) Crear usuario Auth con password temporal (NO se envía)
    const tempPassword = randomPassword(24);

    const userRecord = await this.admin.auth().createUser({
      email: normalizedEmail,
      password: tempPassword,
      displayName: `${firstName} ${lastName}`,
      emailVerified: false,
    });

    const uid = userRecord.uid;

    // 2) Guardar en Firestore
    await this.admin.firestore().doc(`users/${uid}`).set(
      {
        firstName,
        lastName,
        role,
        email: normalizedEmail,
        status: "active",
        createdAt: this.admin.firestore.FieldValue.serverTimestamp(),
        createdBy: createdByUid,
      },
      { merge: true }
    );

    // 3) Custom claim role
    await this.admin.auth().setCustomUserClaims(uid, { role });

    // 4) Reset link
    const resetLink = await this.admin.auth().generatePasswordResetLink(
      normalizedEmail,
      {
        url: env.resetPasswordRedirectUrl,
        handleCodeInApp: false,
      }
    );

    // 5) Email (Resend)
    if (!env.resendFrom) {
      const err = new Error("Missing RESEND_FROM");
      err.code = "missing-email-config";
      throw err;
    }

    await this.resend.emails.send({
      from: env.resendFrom,
      to: normalizedEmail,
      subject: "Invitación: crea tu contraseña",
      html: inviteEmailTemplate({ firstName, lastName, role, resetLink }),
    });

    return { uid };
  }
}
