import express from "express";
import cors from "cors";
import { errorMiddleware } from "./middleware/error.middleware.js";
import { createSearchRoutes } from "./routes/search.routes.js";

export function createApp({ searchRoutes, driveRoutes }) {
  const app = express();

  app.use(cors());
  app.use(express.json({ limit: "1mb" }));

  app.get("/health", (req, res) => res.json({ ok: true }));

  app.use("/api", searchRoutes);
  app.use("/api", driveRoutes);

  app.use(errorMiddleware);

  return app;
}
