export class DriveController {
  constructor({ driveService }) {
    this.driveService = driveService;
  }

  listar = async (req, res, next) => {
    try {
      const folderId = req.query.folderId ? String(req.query.folderId) : undefined;
      const pageToken = req.query.pageToken ? String(req.query.pageToken) : undefined;

      // viene del middleware requireFirebaseAuth
      const uid = req.user?.uid;

      const resp = await this.driveService.listarArchivos({
        folderId,
        pageToken,
        uid, // opcional: útil para auditoría / permisos / multi-tenant
      });

      res.json(resp);
    } catch (e) {
      next(e);
    }
  };
}
