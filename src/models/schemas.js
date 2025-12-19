import { z } from "zod";

export const SearchRequestSchema = z.object({
  query: z.string().min(1),
  topK: z.number().int().min(1).max(20).optional()
});

export const SearchPlanSchema = z.object({
  intent: z.string().optional(),
  expandedTerms: z.array(z.string()).optional(),
  queries: z.array(z.object({
    kind: z.string(),
    driveExpr: z.string()
  })).optional(),
  mimeTypes: z.array(z.string()).optional(),
  preferRecentYears: z.number().int().optional(),
  candidatesK: z.number().int().optional(),
  topK: z.number().int().optional(),
  shouldRerank: z.boolean().optional()
});
