import { Router } from "express";
import { env } from "../../config/env.js";
import { ApiResponse } from "../../common/utils/index.js";
import { getGraph } from "../../common/db/index.js";

export const healthRouter = Router();

/** GET /api/v1/health */
healthRouter.get("/", async (_req, res) => {
  let falkordb: "up" | "down" = "up";
  try {
    await getGraph().roQuery("RETURN 1");
  } catch {
    falkordb = "down";
  }

  const data = {
    status: falkordb === "up" ? "ok" : "degraded",
    uptime: Math.round(process.uptime()),
    services: {
      falkordb,
      imagekit: env.IMAGEKIT_PRIVATE_KEY ? "configured" : "not_configured",
      openai: env.OPENAI_API_KEY ? "configured" : "not_configured",
    },
  };
  new ApiResponse(
    falkordb === "up" ? 200 : 503,
    falkordb === "up" ? "All systems operational" : "FalkorDB is unavailable",
    data,
  ).send(res);
});
