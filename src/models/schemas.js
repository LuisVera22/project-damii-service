import { z } from "zod";

export const DateRangeSchema = z.object({
  from: z.string().nullable().optional(), // YYYY-MM-DD
  to: z.string().nullable().optional(),   // YYYY-MM-DD
});

export const PlannerModeSchema = z.enum(["search", "recent", "list"]);

export const SortSchema = z.enum(["relevance", "modifiedTime", "createdTime"]);

export const SearchPlanSchema = z.object({
  mode: PlannerModeSchema.default("search"),
  driveQuery: z.string().nullable().optional(), // sintaxis Drive o null
  mimeTypes: z.array(z.string()).optional().default([]),
  dateRange: DateRangeSchema.optional().default({ from: null, to: null }),
  sort: SortSchema.optional().default("relevance"),
  topK: z.number().int().min(1).max(20).optional(),
  candidatesK: z.number().int().min(10).max(100).optional(),
  shouldRerank: z.boolean().optional().default(true),
  explain: z.string().optional().default(""),
});
