import cors from "cors";
import express from "express";
import helmet from "helmet";
import morgan from "morgan";
import { env, isProd } from "./config/env.js";
import { errorHandler, notFoundHandler, requestId } from "./common/middleware/index.js";
import { apiRouter } from "./routes.js";

export function createApp() {
  const app = express();

  app.use(requestId);
  app.use(helmet());
  app.use(cors({ origin: env.CLIENT_URL.split(","), credentials: true }));
  app.use(morgan(isProd ? "combined" : "dev"));
  app.use(express.json({ limit: "5mb" }));
  app.use(express.urlencoded({ extended: true }));

  app.use("/api/v1", apiRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
