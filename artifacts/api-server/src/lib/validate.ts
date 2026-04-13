import type { Request, Response } from "express";
import { z } from "zod";

/**
 * Validates req.body against a Zod schema.
 * Returns parsed data or sends 400 and returns null.
 */
export function validateBody<T>(schema: z.ZodType<T>, req: Request, res: Response): T | null {
  const result = schema.safeParse(req.body);
  if (!result.success) {
    res.status(400).json({ error: "Validation error", details: result.error.flatten() });
    return null;
  }
  return result.data;
}

/**
 * Validates req.query against a Zod schema.
 * Returns parsed data or sends 400 and returns null.
 */
export function validateQuery<T>(schema: z.ZodType<T>, req: Request, res: Response): T | null {
  const result = schema.safeParse(req.query);
  if (!result.success) {
    res.status(400).json({ error: "Validation error", details: result.error.flatten() });
    return null;
  }
  return result.data;
}
