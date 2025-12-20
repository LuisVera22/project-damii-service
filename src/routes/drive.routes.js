import { Router } from "express";
import { requireFirebaseAuth } from "../middleware/firebaseAuth.middleware.js";

export function createDriveRoutes({ driveController }) {
  const router = Router();

  // GET /api/archivos?folderId=&pageToken=
  router.get("/archivos", requireFirebaseAuth, driveController.listar);

  return router;
}
