import { Router } from "express";
import { mediaRouter } from "./common/media/index.js";
import { caseRouter } from "./module/case/index.js";
import { complianceRouter } from "./module/compliance/index.js";
import { documentRouter } from "./module/document/index.js";
import { factCheckRouter } from "./module/factcheck/index.js";
import { healthRouter } from "./module/health/health.routes.js";
import { hearingRouter } from "./module/hearing/index.js";
import { intakeRouter } from "./module/intake/index.js";
import { qaRouter } from "./module/qa/index.js";
import { transcriptRouter } from "./module/transcript/index.js";

/** All routers are mounted here under /api/v1. Feature routers declare their full paths. */
export const apiRouter = Router();

apiRouter.use("/health", healthRouter);
apiRouter.use("/media", mediaRouter);
apiRouter.use(caseRouter);
apiRouter.use(hearingRouter);
apiRouter.use(documentRouter);
apiRouter.use(transcriptRouter);
apiRouter.use(intakeRouter);
apiRouter.use(factCheckRouter);
apiRouter.use(complianceRouter);
apiRouter.use(qaRouter);
