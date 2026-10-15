import { Router } from "express";
import { healthRouter } from "./module/health/health.routes.js";
import { mediaRouter } from "./common/media/index.js";

/** All feature routers are mounted here under /api/v1. */
export const apiRouter = Router();

apiRouter.use("/health", healthRouter);
apiRouter.use("/media", mediaRouter);
// Next: /cases, /intake, /search, /briefs (see plan.md section 5)
