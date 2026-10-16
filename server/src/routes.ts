import { Router } from "express";
import { mediaRouter } from "./common/media/index.js";
import { caseRouter } from "./module/case/index.js";
import { healthRouter } from "./module/health/health.routes.js";

/** All routers are mounted here under /api/v1. Feature routers declare their full paths. */
export const apiRouter = Router();

apiRouter.use("/health", healthRouter);
apiRouter.use("/media", mediaRouter);
apiRouter.use(caseRouter);
