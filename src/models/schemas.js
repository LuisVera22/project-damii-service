import { z } from "zod";

export const SearchRequestSchema = z.object({
  query: z.string().min(1, "query es requerida"),
  topK: z.number().int().min(1).max(20).optional(),
});

const TimeRangeSchema = z.object({
  from: z.string().nullable().optional(), // YYYY-MM-DD
  to: z.string().nullable().optional(),
});

const SummarySchema = z.object({
  fileId: z.string().nullable().optional(),
  titleQuery: z.string().nullable().optional(),
  maxChars: z.number().int().min(2000).max(30000).optional().default(12000),
});

export const SearchPlanSchema = z.object({
  mode: z.enum(["search", "recent", "title", "summarize"]).default("search"),

  // para search semántico
  driveQuery: z.string().nullable().optional(),
  candidatesK: z.number().int().min(10).max(100).optional().default(40),
  shouldRerank: z.boolean().optional().default(true),

  // para title
  titleQuery: z.string().nullable().optional(),

  // filtros generales
  mimeTypes: z.array(z.string()).optional().default([]),
  timeRange: TimeRangeSchema.optional().default({ from: null, to: null }),
  sort: z.enum(["relevance", "modifiedTime", "createdTime"]).optional().default("relevance"),
  topK: z.number().int().min(1).max(20).optional(),

  // para summarize
  summary: SummarySchema.optional(),

  explain: z.string().optional().default(""),
});
