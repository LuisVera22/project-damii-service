import { google } from "googleapis";
import { buildDriveQ } from "../utils/driveQuery.js";

export class DriveClient {
  constructor() {
    const auth = new google.auth.GoogleAuth({
      scopes: ["https://www.googleapis.com/auth/drive.readonly"]
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
      includeItemsFromAllDrives: true
    });

    return (res.data.files ?? []).map((f) => ({
      id: f.id,
      name: f.name,
      mimeType: f.mimeType,
      webViewLink: f.webViewLink,
      modifiedTime: f.modifiedTime
    }));
  }
}
