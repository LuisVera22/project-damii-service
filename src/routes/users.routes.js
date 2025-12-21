import { Router } from "express";
import { requireSuperadmin } from "../middleware/firebaseAuth.middleware.js";

export function createUsersRoutes({ usersController }) {
  const router = Router();

  router.post("/admin/users", requireSuperadmin, usersController.createUser);

  return router;
}
