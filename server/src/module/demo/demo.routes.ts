import { Router } from "express";
import { queryOne } from "../../common/db/index.js";
import { ApiError, ApiResponse } from "../../common/utils/index.js";
import { loadDemoCases } from "../../scripts/seed.js";
import { rateLimit } from "../auth/index.js";

export const demoRouter = Router();

const loading = new Set<string>();

/** GET /demo  -> are the demo cases already in this firm? */
demoRouter.get("/demo", async (req, res) => {
  const row = await queryOne<{ id: string }>("MATCH (c:Case {firmId: $firmId, demo: true}) RETURN c.id AS id LIMIT 1", {
    firmId: req.user!.firmId,
  });
  ApiResponse.ok({ loaded: Boolean(row), caseId: row?.id ?? null }).send(res);
});

/**
 * POST /demo  -> add the demo cases (synthetic data, fully analysed) to the firm.
 * No agent or OpenAI calls are made, so it is instant and free.
 */
demoRouter.post(
  "/demo",
  rateLimit({ windowMs: 60 * 60_000, max: 5, key: (req) => `demo:${req.user!.firmId}` }),
  async (req, res) => {
    const { firmId } = req.user!;
    if (loading.has(firmId)) throw ApiError.conflict("The demo cases are already being added");
    loading.add(firmId);
    try {
      const out = await loadDemoCases(firmId);
      ApiResponse.ok(out, out.loaded ? "Demo cases added" : "The demo cases are already in your firm").send(res);
    } finally {
      loading.delete(firmId);
    }
  },
);
