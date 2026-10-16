import { z } from "zod";

/** Dates are stored as `YYYY-MM-DD` strings so they sort correctly in Cypher. */
export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");

export const idParam = z.string().uuid("Invalid id");

const HONORIFICS = /\b(mr|mrs|ms|miss|shri|sri|smt|kumari|km|dr|adv|advocate|ld|learned|sh|hon'?ble|justice)\b\.?/g;

/** Normalised name used to spot the same person written differently ("Adv. R. Mehta" vs "r mehta"). */
export function nameKey(name: string): string {
  return name
    .toLowerCase()
    .replace(HONORIFICS, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Today's date in India (YYYY-MM-DD). Courts, deadlines and "overdue" follow IST, not UTC. */
export const todayIST = () => new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);
