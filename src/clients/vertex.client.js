import { VertexAI } from "@google-cloud/vertexai";
import { extractJson, safeToken } from "../utils/json.js";
import { SearchPlanSchema } from "../models/schemas.js";

export class VertexClient {
  constructor({ project, location, model }) {
    this.vertexAI = new VertexAI({ project, location });
    this.model = this.vertexAI.getGenerativeModel({ model });
  }

  async buildPlan({ userQuery, maxDriveQueries, defaultTopK }) {
    const prompt = `
        Eres un "search planner" para Google Drive.
        El usuario escribe una intención en lenguaje natural y tú produces un plan para buscar archivos dentro de UNA carpeta.

        REGLAS:
        - Devuelve SOLO JSON válido (sin texto extra, sin markdown).
        - driveExpr debe usar sintaxis de Drive: name contains 'x', fullText contains 'x', and/or/or, y paréntesis.
        - NO incluyas: '<FOLDER_ID>' in parents, ni trashed=false (eso lo agrega el backend).
        - Genera varias estrategias (título, contenido, expansión, material didáctico).
        - Limita queries a ${maxDriveQueries}.
        - Incluye mimeTypes sugeridos si aplica (pdf/docx/pptx).

        Usuario: ${userQuery}

        Esquema:
        {
            "intent": "...",
            "expandedTerms": ["..."],
            "queries": [{"kind":"title|content|expanded|tutorial","driveExpr":"..."}],
            "mimeTypes": ["..."],
            "preferRecentYears": 3,
            "candidatesK": 40,
            "topK": ${defaultTopK},
            "shouldRerank": true
        }
    `.trim();

    const resp = await this.model.generateContent({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
    });

    const text =
      resp?.response?.candidates?.[0]?.content?.parts
        ?.map((p) => p.text)
        .join("") ?? "";
    const json = extractJson(text);

    // parse + validate + hardening
    let plan;
    try {
      plan = JSON.parse(json);
    } catch {
      plan = null;
    }

    const parsed = SearchPlanSchema.safeParse(plan);
    if (!parsed.success) {
      const tok = safeToken(userQuery);
      return this.fallbackPlan(tok, defaultTopK, maxDriveQueries);
    }

    const p = parsed.data;

    // hardening
    const queries = (p.queries ?? []).slice(0, maxDriveQueries);
    const topK = Math.max(1, Math.min(p.topK ?? defaultTopK, 20));
    const candidatesK = Math.max(10, Math.min(p.candidatesK ?? 40, 100));

    const finalPlan = {
      intent: p.intent ?? "unknown",
      expandedTerms: p.expandedTerms ?? [],
      queries: queries.length
        ? queries
        : [
            {
              kind: "baseline",
              driveExpr: `name contains '${safeToken(
                userQuery
              )}' or fullText contains '${safeToken(userQuery)}'`,
            },
          ],
      mimeTypes: p.mimeTypes ?? [],
      preferRecentYears: p.preferRecentYears ?? 3,
      candidatesK,
      topK,
      shouldRerank: p.shouldRerank !== false,
    };

    return finalPlan;
  }

  fallbackPlan(tok, defaultTopK, maxDriveQueries) {
    return {
      intent: "unknown",
      expandedTerms: [],
      queries: [
        {
          kind: "baseline",
          driveExpr: `name contains '${tok}' or fullText contains '${tok}'`,
        },
      ].slice(0, maxDriveQueries),
      mimeTypes: [
        "application/pdf",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      ],
      preferRecentYears: 3,
      candidatesK: 40,
      topK: defaultTopK,
      shouldRerank: true,
    };
  }

  async rerank({ userQuery, candidates, topK }) {
    const items = candidates.map((d) => ({
      id: d.id,
      title: d.name,
      mimeType: d.mimeType,
      modifiedTime: d.modifiedTime ?? null,
      link: d.webViewLink ?? null,
    }));

    const prompt = `
        Ordena los siguientes documentos según qué tan bien responden a la intención del usuario.
        Devuelve SOLO JSON válido (sin texto extra, sin markdown).

        REGLAS:
        - No inventes IDs. Usa solo IDs presentes en input.
        - Devuelve máximo ${topK} resultados.
        - reason debe ser una frase corta (<= 20 palabras).

        Usuario: ${userQuery}
        Documentos: ${JSON.stringify(items)}

        Esquema:
        {
            "ranked": [
                {"id":"...","score":0.0,"reason":"..."}
            ]
        }
    `.trim();

    const resp = await this.model.generateContent({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
    });

    const text =
      resp?.response?.candidates?.[0]?.content?.parts
        ?.map((p) => p.text)
        .join("") ?? "";
    const json = extractJson(text);

    let ranked = [];
    try {
      ranked = JSON.parse(json)?.ranked ?? [];
    } catch {
      ranked = [];
    }

    const byId = new Map(candidates.map((d) => [d.id, d]));
    const out = [];

    for (const r of ranked) {
      const id = String(r?.id ?? "");
      if (!byId.has(id)) continue;
      const d = byId.get(id);
      out.push({
        id,
        title: d.name,
        link: d.webViewLink,
        score: Number(r?.score ?? 0),
        reason: String(r?.reason ?? ""),
      });
      if (out.length >= topK) break;
    }

    // completar si faltan
    if (out.length < topK) {
      const used = new Set(out.map((x) => x.id));
      for (const d of candidates) {
        if (out.length >= topK) break;
        if (used.has(d.id)) continue;
        out.push({
          id: d.id,
          title: d.name,
          link: d.webViewLink,
          score: 0,
          reason: "Coincidencia directa en Drive.",
        });
      }
    }

    return out.slice(0, topK);
  }
}
