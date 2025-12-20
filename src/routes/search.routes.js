import { Router } from "express";
import { requireFirebaseAuth } from "../middleware/firebaseAuth.middleware.js";

export function createSearchRoutes({ searchController }) {
  const router = Router();

  router.post("/buscar", requireFirebaseAuth, searchController.buscar);

  return router;
}
