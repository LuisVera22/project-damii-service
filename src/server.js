import { assertEnv, env } from "./config/env.js";
import { createApp } from "./app.js";

import { DriveClient } from "./clients/drive.client.js";
import { VertexClient } from "./clients/vertex.client.js";
import { SearchService } from "./services/search.service.js";
import { SearchController } from "./controllers/search.controller.js";
import { createSearchRoutes } from "./routes/search.routes.js";
import { DriveService } from "./services/drive.service.js";
import { DriveController } from "./controllers/drive.controller.js";
import { createDriveRoutes } from "./routes/drive.routes.js";
import { UsersService } from "./services/users.service.js";
import { UsersController } from "./controllers/users.controller.js";
import { createUsersRoutes } from "./routes/users.routes.js";


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
const driveService = new DriveService({ env, driveClient });
const usersService = new UsersService();

// Controllers
const searchController = new SearchController({ searchService });
const driveController = new DriveController({ driveService });
const usersController = new UsersController({ usersService });

// Routes
const searchRoutes = createSearchRoutes({ searchController });
const driveRoutes = createDriveRoutes({ driveController });
const usersRoutes = createUsersRoutes({ usersController });

// App
const app = createApp({ searchRoutes, driveRoutes, usersRoutes });

app.listen(env.port, () => {
  console.log(`API listening on :${env.port}`);
});
