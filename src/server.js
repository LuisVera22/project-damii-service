import { assertEnv, env } from "./config/env.js";
import { createApp } from "./app.js";

import { DriveClient } from "./clients/drive.client.js";
import { VertexClient } from "./clients/vertex.client.js";
import { SearchService } from "./services/search.service.js";
import { SearchController } from "./controllers/search.controller.js";
import { createSearchRoutes } from "./routes/search.routes.js";

assertEnv();

// Clients
const driveClient = new DriveClient();
const vertexClient = new VertexClient({
  project: env.gcpProjectId,
  location: env.gcpLocation,
  model: env.vertexModel
});

// Services
const searchService = new SearchService({ env, driveClient, vertexClient });

// Controllers
const searchController = new SearchController({ searchService });

// Routes
const searchRoutes = createSearchRoutes({ searchController });

// App
const app = createApp({ searchRoutes });

app.listen(env.port, () => {
  console.log(`API listening on :${env.port}`);
});
