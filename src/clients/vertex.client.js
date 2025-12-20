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
      Eres un planificador para buscar en Google Drive dentro de UNA carpeta.

      Devuelve SOLO JSON válido según este esquema:

      {
        "mode": "search|recent|list",
        "driveQuery": "string o null",
        "mimeTypes": ["..."],
        "dateRange": {"from":"YYYY-MM-DD o null","to":"YYYY-MM-DD o null"},
        "sort": "relevance|modifiedTime|createdTime",
        "topK": ${defaultTopK},
        "candidatesK": 40,
        "shouldRerank": true,
        "explain": "1 línea sobre por qué elegiste ese modo"
      }

      REGLAS:
      - Si el usuario pide “últimos/recientes/nuevos/cargados”, usa mode="recent" y sort="modifiedTime". driveQuery debe ser null.
      - Si el usuario pide “listar/mostrar archivos”, usa mode="list" y sort="modifiedTime". driveQuery debe ser null.
      - Si el usuario pide un tema, usa mode="search" y driveQuery usando sintaxis Drive:
        ejemplo: (name contains 'kotlin' or fullText contains 'kotlin') and (name contains 'android' or fullText contains 'android')
      - NO incluyas folderId, ni trashed=false.
      - NO uses operadores desconocidos.
      - No inventes información.

      Usuario: ${userQuery}
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
      // fallback robusto: detecta "recent" por heurística mínima y sino search
      return this.fallbackPlanSimple(userQuery, defaultTopK);
    }

    const p = parsed.data;

    // hardening numérico
    const topK = Math.max(1, Math.min(p.topK ?? defaultTopK, 20));
    const candidatesK = Math.max(10, Math.min(p.candidatesK ?? 40, 100));

    // hardening string
    const mode = p.mode ?? "search";
    const sort = p.sort ?? (mode === "search" ? "relevance" : "modifiedTime");

    // En recent/list no debería haber driveQuery
    const driveQuery =
      mode === "search"
        ? p.driveQuery && String(p.driveQuery).trim()
          ? String(p.driveQuery)
          : null
        : null;

    return {
      mode,
      driveQuery,
      mimeTypes: p.mimeTypes ?? [],
      dateRange: p.dateRange ?? { from: null, to: null },
      sort,
      topK,
      candidatesK,
      shouldRerank: p.shouldRerank !== false,
      explain: p.explain ?? "",
    };
  }

  fallbackPlanSimple(userQuery, defaultTopK) {
    const q = String(userQuery ?? "").toLowerCase();
    const isRecent =
      q.includes("último") ||
      q.includes("ultimos") ||
      q.includes("últimos") ||
      q.includes("reciente") ||
      q.includes("recientes") ||
      q.includes("nuevo") ||
      q.includes("nuevos") ||
      q.includes("cargado") ||
      q.includes("cargados");

    if (isRecent) {
      return {
        mode: "recent",
        driveQuery: null,
        mimeTypes: [],
        dateRange: { from: null, to: null },
        sort: "modifiedTime",
        topK: defaultTopK,
        candidatesK: 40,
        shouldRerank: false,
        explain:
          "Fallback: intención de archivos recientes detectada por keywords.",
      };
    }

    // fallback search básico
    const tok = safeToken(userQuery);
    return {
      mode: "search",
      driveQuery: `name contains '${tok}' or fullText contains '${tok}'`,
      mimeTypes: [],
      dateRange: { from: null, to: null },
      sort: "relevance",
      topK: defaultTopK,
      candidatesK: 40,
      shouldRerank: true,
      explain: "Fallback: búsqueda básica por nombre o contenido.",
    };
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
