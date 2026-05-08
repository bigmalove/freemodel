import app from "./app";
import { logger } from "./lib/logger";
import { initSettings } from "./lib/settings";
import { initModels } from "./lib/models";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

async function main() {
  try {
    await Promise.all([initSettings(), initModels()]);
    logger.info("Persistent state loaded from database");
  } catch (err) {
    logger.warn({ err }, "Failed to load state from database, using defaults");
  }

  const server = app.listen(port, (err) => {
    if (err) {
      logger.error({ err }, "Error listening on port");
      process.exit(1);
    }

    logger.info({ port }, "Server listening");
  });

  server.setTimeout(600_000);
  server.keepAliveTimeout = 600_000;
}

main().catch((err) => {
  logger.error({ err }, "Fatal error during startup");
  process.exit(1);
});
