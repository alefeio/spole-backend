import { z } from "zod";

export const createSpaceSchema = z.object({
  name: z.string().min(1).max(200),
  type: z.string().min(1).max(80),
  description: z.string().max(4000).optional(),
  capacitySuggestion: z.number().int().positive().optional(),
  status: z.enum(["ACTIVE", "INACTIVE", "BLOCKED"]).optional()
});

export type CreateSpaceInput = z.infer<typeof createSpaceSchema>;
