import { randomUUID } from "node:crypto";
import type { RequestHandler } from "express";

export const requestId: RequestHandler = (req, res, next) => {
  const id = req.header("x-request-id") ?? randomUUID();
  res.locals.requestId = id;
  res.setHeader("x-request-id", id);
  next();
};
