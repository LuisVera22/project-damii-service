import { HttpError } from "../utils/errors.js";

export class DriveService {
  constructor({ env, driveClient }) {
    this.env = env;
    this.drive = driveClient;
  }

  async listarArchivos({ folderId, pageToken }) {
    const fid = folderId || this.env.driveFolderId;
    if (!fid) throw new HttpError(500, "DRIVE_FOLDER_ID no configurado");

    const { files, nextPageToken } = await this.drive.listFolder({
      folderId: fid,
      pageToken,
      pageSize: 50,
    });

    return {
      ok: true,
      archivos: files,
      nextPageToken,
    };
  }
}
