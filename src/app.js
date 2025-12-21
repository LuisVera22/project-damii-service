import express from "express";
import cors from "cors";
import { errorMiddleware } from "./middleware/error.middleware.js";
import { createSearchRoutes } from "./routes/search.routes.js";
import { createDriveRoutes } from "./routes/drive.routes.js";
import { requireFirebaseAuth } from "./middleware/firebaseAuth.middleware.js";

export function createApp({ searchRoutes, driveRoutes, usersRoutes }) {
  const app = express();

  app.use(cors());
  app.use(express.json({ limit: "1mb" }));

  app.get("/health", (req, res) => res.json({ ok: true }));
  
  // Protege todo /api
  app.use("/api", requireFirebaseAuth);

  app.use("/api", searchRoutes);
  app.use("/api", driveRoutes);
  app.use("/api", usersRoutes);

  app.use(errorMiddleware);

  return app;
}
