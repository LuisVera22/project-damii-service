import { google } from "googleapis";
import { buildDriveQ } from "../utils/driveQuery.js";

export class DriveClient {
  constructor() {
    const auth = new google.auth.GoogleAuth({
      scopes: ["https://www.googleapis.com/auth/drive.readonly"],
    });
    this.drive = google.drive({ version: "v3", auth });
  }

  async searchInFolder({ folderId, driveExpr, pageSize }) {
    const q = buildDriveQ({ folderId, driveExpr });

    const res = await this.drive.files.list({
      q,
      pageSize,
      fields: "files(id,name,mimeType,webViewLink,modifiedTime)",
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });

    return (res.data.files ?? []).map((f) => ({
      id: f.id,
      name: f.name,
      mimeType: f.mimeType,
      webViewLink: f.webViewLink,
      modifiedTime: f.modifiedTime,
    }));
  }

  // LISTADO DE ARCHIVOS EN CARPETA
  async listFolder({ folderId, pageToken, pageSize = 50 }) {
    const q = [`'${folderId}' in parents`, "trashed=false"].join(" and ");

    const res = await this.drive.files.list({
      q,
      pageSize,
      pageToken: pageToken || undefined,
      orderBy: "folder,name",
      fields:
        "nextPageToken,files(id,name,mimeType,createdTime,modifiedTime,parents,webViewLink,iconLink)",
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });

    return {
      files: (res.data.files ?? []).map((f) => ({
        id: f.id,
        nombre: f.name,
        tipo: f.mimeType,
        creado: f.createdTime,
        modificado: f.modifiedTime,
        carpetaPadre: folderId,
        vistaWeb: f.webViewLink,
        icono: f.iconLink,
      })),
      nextPageToken: res.data.nextPageToken ?? null,
    };
  }

  // LISTADO DE ARCHIVOS RECIENTES
  async listRecentInFolder({ folderId, pageSize = 10 }) {
    const q = [`'${folderId}' in parents`, "trashed=false"].join(" and ");

    const res = await this.drive.files.list({
      q,
      pageSize,
      orderBy: "modifiedTime desc",
      fields: "files(id,name,mimeType,modifiedTime,webViewLink,iconLink)",
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });

    return res.data.files ?? [];
  }
}
