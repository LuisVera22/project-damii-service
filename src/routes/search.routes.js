import { Router } from "express";

export function createSearchRoutes({ searchController }) {
  const router = Router();

  router.post("/buscar", searchController.buscar);

  return router;
}
