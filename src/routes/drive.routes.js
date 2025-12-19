import { Router } from "express";

export function createDriveRoutes({ driveController }) {
  const router = Router();

  // GET /api/archivos?folderId=&pageToken=
  router.get("/archivos", driveController.listar);

  return router;
}
