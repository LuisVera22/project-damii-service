import { google } from "googleapis";
import { buildDriveQ } from "../utils/driveQuery.js";

const FOLDER_MIME = "application/vnd.google-apps.folder";

export class DriveClient {
  constructor() {
    const auth = new google.auth.GoogleAuth({
      scopes: ["https://www.googleapis.com/auth/drive.readonly"],
    });
    this.drive = google.drive({ version: "v3", auth });
  }


  // Helpers internos (árbol)

  async _listChildren({ folderId, pageToken = null, pageSize = 200 }) {
    // Trae carpetas + archivos (hijos directos)
    const q = [`'${folderId}' in parents`, "trashed=false"].join(" and ");

    const res = await this.drive.files.list({
      q,
      pageSize,
      pageToken: pageToken || undefined,
      fields: "nextPageToken,files(id,name,mimeType,modifiedTime,createdTime,webViewLink,parents)",
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });

    return {
      files: res.data.files ?? [],
      nextPageToken: res.data.nextPageToken ?? null,
    };
  }

  async _walkFolderTree({ rootFolderId, maxFolders = 5000 }) {
    // BFS para obtener IDs de carpetas en el árbol
    const visited = new Set();
    const queue = [rootFolderId];
    visited.add(rootFolderId);

    while (queue.length) {
      const current = queue.shift();

      let pageToken = null;
      do {
        const { files, nextPageToken } = await this._listChildren({
          folderId: current,
          pageToken,
          pageSize: 200,
        });

        for (const f of files) {
          if (f?.mimeType === FOLDER_MIME && f?.id && !visited.has(f.id)) {
            visited.add(f.id);
            queue.push(f.id);
            if (visited.size >= maxFolders) {
              return Array.from(visited);
            }
          }
        }

        pageToken = nextPageToken;
      } while (pageToken);
    }

    return Array.from(visited);
  }


  // Métodos (1 nivel)

  async searchInFolder({ folderId, driveExpr, pageSize, mimeTypes, timeRange }) {
    const q = buildDriveQ({ folderId, driveExpr, mimeTypes, timeRange });

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


  /**
   * Busca dentro de la carpeta raíz y TODAS sus subcarpetas.
   * Recorre el árbol de carpetas y ejecuta tu buildDriveQ en cada carpeta.
   *
   * Nota: esto es "1 query por carpeta", funciona bien en árboles medianos.
   */
  async searchInTree({
    rootFolderId,
    driveExpr,
    pageSize = 40,
    mimeTypes,
    timeRange,
    maxFolders = 5000,
  }) {
    const folderIds = await this._walkFolderTree({ rootFolderId, maxFolders });

    const out = [];
    const seen = new Set();

    // Para limitar cuota, pedimos pocos por carpeta y acumulamos hasta pageSize global
    const perFolder = Math.max(10, Math.min(50, Math.ceil(pageSize / Math.max(1, Math.min(folderIds.length, 10)))));

    for (const folderId of folderIds) {
      if (out.length >= pageSize) break;

      const q = buildDriveQ({ folderId, driveExpr, mimeTypes, timeRange });

      const res = await this.drive.files.list({
        q,
        pageSize: perFolder,
        fields: "files(id,name,mimeType,webViewLink,modifiedTime)",
        supportsAllDrives: true,
        includeItemsFromAllDrives: true,
      });

      for (const f of res.data.files ?? []) {
        if (!f?.id || seen.has(f.id)) continue;
        if (f.mimeType === FOLDER_MIME) continue; // seguridad extra

        seen.add(f.id);
        out.push({
          id: f.id,
          name: f.name,
          mimeType: f.mimeType,
          webViewLink: f.webViewLink,
          modifiedTime: f.modifiedTime,
        });

        if (out.length >= pageSize) break;
      }
    }

    return out;
  }

  /**
   * Devuelve los N más recientes dentro del árbol (carpeta raíz + descendientes).
   * Junta candidatos por carpeta y luego ordena globalmente por modifiedTime.
   */
  async listRecentInTree({ rootFolderId, pageSize = 10, maxFolders = 5000 }) {
    const folderIds = await this._walkFolderTree({ rootFolderId, maxFolders });

    const all = [];
    const seen = new Set();

    // Pedimos una cantidad fija por carpeta para hacer merge (cuota vs calidad)
    const perFolder = 25;

    for (const folderId of folderIds) {
      const q = [`'${folderId}' in parents`, "trashed=false", `mimeType != '${FOLDER_MIME}'`].join(" and ");

      const res = await this.drive.files.list({
        q,
        pageSize: perFolder,
        orderBy: "modifiedTime desc",
        fields: "files(id,name,mimeType,modifiedTime,webViewLink,iconLink)",
        supportsAllDrives: true,
        includeItemsFromAllDrives: true,
      });

      for (const f of res.data.files ?? []) {
        if (!f?.id || seen.has(f.id)) continue;
        if (f.mimeType === FOLDER_MIME) continue;

        seen.add(f.id);
        all.push(f);
      }
    }

    all.sort((a, b) => {
      const ta = new Date(a.modifiedTime ?? 0).getTime();
      const tb = new Date(b.modifiedTime ?? 0).getTime();
      return tb - ta;
    });

    return all.slice(0, pageSize);
  }


  // Meta / export / download

  async getFileMeta(fileId) {
    const res = await this.drive.files.get({
      fileId,
      fields: "id,name,mimeType,webViewLink,modifiedTime",
      supportsAllDrives: true,
    });
    return res.data;
  }

  async exportGoogleDocText(fileId) {
    const res = await this.drive.files.export(
      { fileId, mimeType: "text/plain" },
      { responseType: "text" }
    );
    return res.data;
  }

  async downloadTextFile(fileId) {
    const res = await this.drive.files.get(
      { fileId, alt: "media", supportsAllDrives: true },
      { responseType: "text" }
    );
    return res.data;
  }
}
