export class DriveController {
  constructor({ driveService }) {
    this.driveService = driveService;
  }

  listar = async (req, res, next) => {
    try {
      const folderId = req.query.folderId ? String(req.query.folderId) : undefined;
      const pageToken = req.query.pageToken ? String(req.query.pageToken) : undefined;

      const resp = await this.driveService.listarArchivos({ folderId, pageToken });
      res.json(resp);
    } catch (e) {
      next(e);
    }
  };
}
