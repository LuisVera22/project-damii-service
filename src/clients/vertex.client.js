import { VertexAI } from "@google-cloud/vertexai";
import { extractJson, safeToken } from "../utils/json.js";
import { SearchPlanSchema } from "../models/schemas.js";

const FOLDER_MIME = "application/vnd.google-apps.folder";
const FOLDER_GUARD = `mimeType != '${FOLDER_MIME}'`;

const normalizeSpaces = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
const driveEscape = (s) => String(s ?? "").replace(/'/g, "\\'");

const isFolder = (f) => f?.mimeType === FOLDER_MIME;

/**
 * Estricto: si NO hay mimeType, se descarta.
 * Esto evita que se cuelen carpetas cuando Drive API no retorna mimeType por fields.
 */
const onlyFiles = (arr = []) =>
  Array.isArray(arr) ? arr.filter((f) => f && f.mimeType && !isFolder(f)) : [];

const addFolderGuardToQuery = (q) => {
  const s = String(q ?? "").trim();
  if (!s) return FOLDER_GUARD;

  // Evita duplicar el guard si el LLM ya lo puso
  if (s.includes(FOLDER_MIME) && (s.includes("mimeType !=") || s.includes("mimeType!="))) {
    return s;
  }
  return `(${s}) and ${FOLDER_GUARD}`;
};

/**
 * Construye un q (Drive) razonable a partir de un título.
 * Tokeniza y arma un AND para mejorar precisión.
 */
const titleToDriveQuery = (title) => {
  const t = normalizeSpaces(title);
  if (!t) return FOLDER_GUARD;

  const tokens = t
    .split(" ")
    .map((x) => x.trim())
    .filter((x) => x.length >= 3)
    .slice(0, 6);

  if (tokens.length === 0) {
    const tok = safeToken(t);
    return addFolderGuardToQuery(`name contains '${driveEscape(tok)}'`);
  }

  const parts = tokens.map((x) => `name contains '${driveEscape(x)}'`);
  return addFolderGuardToQuery(parts.join(" and "));
};

export class VertexClient {
  constructor({ project, location, model }) {
    this.vertexAI = new VertexAI({ project, location });
    this.model = this.vertexAI.getGenerativeModel({ model });
  }

  async buildPlan({ userQuery, defaultTopK }) {
    const prompt = `
Eres un planificador para una biblioteca en Google Drive (dentro de UNA carpeta).
Devuelve SOLO JSON válido.

Esquema:
{
  "mode": "search|recent|title|summarize",
  "driveQuery": "string o null",
  "titleQuery": "string o null",
  "mimeTypes": ["..."],
  "timeRange": {"from":"YYYY-MM-DD o null","to":"YYYY-MM-DD o null"},
  "sort": "relevance|modifiedTime|createdTime",
  "topK": ${defaultTopK},
  "candidatesK": 40,
  "shouldRerank": true,
  "summary": {"fileId":"... o null","titleQuery":"... o null","maxChars":12000},
  "explain": "1 línea"
}

REGLAS:
- Si el usuario pide "últimos/recientes/nuevos", mode="recent", sort="modifiedTime".
- Si el usuario menciona un nombre de archivo específico o puedes buscar por similitud y/o intención:
  mode="title", usa titleQuery y TAMBIÉN llena driveQuery para traer candidatos por nombre.
- Si el usuario pide "resume/resúmeme/resumen de" un documento/libro/texto, mode="summarize".
  - Si menciona ID, pon summary.fileId.
  - Si menciona el nombre, pon summary.titleQuery con el nombre.
  - IMPORTANTE: si usas summary.titleQuery (nombre), TAMBIÉN llena driveQuery para traer candidatos por nombre.
- Si el usuario tiene la intención o pide un tema/contexto, mode="search" y driveQuery con sintaxis Drive:
  (name contains 'x' or fullText contains 'x') and ...
- NO incluyas folderId, ni trashed=false.
- IMPORTANTE: nunca incluyas carpetas; exclúyelas con:
  ${FOLDER_GUARD}
  (si hay driveQuery, combínalo con AND)
- No inventes información.
- Devuelve SOLO JSON.

Usuario: ${userQuery}
    `.trim();

    const resp = await this.model.generateContent({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
    });

    const text =
      resp?.response?.candidates?.[0]?.content?.parts?.map((p) => p.text).join("") ?? "";
    const json = extractJson(text);

    let plan;
    try {
      plan = JSON.parse(json);
    } catch {
      plan = null;
    }

    const parsed = SearchPlanSchema.safeParse(plan);
    if (!parsed.success) {
      return this.fallbackPlanSimple(userQuery, defaultTopK);
    }

    const p = parsed.data;

    const topK = Math.max(1, Math.min(p.topK ?? defaultTopK, 20));
    const candidatesK = Math.max(10, Math.min(p.candidatesK ?? 40, 100));

    const mode = p.mode ?? "search";
    const sort = p.sort ?? (mode === "search" ? "relevance" : "modifiedTime");

    const dateRange = p.dateRange ?? p.timeRange ?? { from: null, to: null };

    // 1) DriveQuery base (solo si mode=search)
    let driveQueryRaw =
      mode === "search" && p.driveQuery && String(p.driveQuery).trim()
        ? String(p.driveQuery).trim()
        : null;

    // 2) Si mode=title, construir query por nombre
    if (!driveQueryRaw && mode === "title" && p.titleQuery && String(p.titleQuery).trim()) {
      driveQueryRaw = titleToDriveQuery(p.titleQuery);
    }

    // 3) Si mode=summarize y no hay fileId pero sí titleQuery, construir query por nombre
    const sumTitle =
      p.summary?.titleQuery && String(p.summary.titleQuery).trim()
        ? String(p.summary.titleQuery).trim()
        : null;

    if (!driveQueryRaw && mode === "summarize" && !p.summary?.fileId && sumTitle) {
      driveQueryRaw = titleToDriveQuery(sumTitle);
    }

    // 4) Si sigue null, al menos aplica guard anti-carpetas
    const driveQuery = addFolderGuardToQuery(driveQueryRaw);

    return {
      mode,
      driveQuery,
      mimeTypes: p.mimeTypes ?? [],
      dateRange,
      sort,
      topK,
      candidatesK,
      shouldRerank: p.shouldRerank !== false,
      explain: p.explain ?? "",
      // Si lo usas en otra capa:
      titleQuery: p.titleQuery ?? null,
      summary: p.summary ?? null,
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
        driveQuery: FOLDER_GUARD,
        mimeTypes: [],
        dateRange: { from: null, to: null },
        sort: "modifiedTime",
        topK: defaultTopK,
        candidatesK: 40,
        shouldRerank: false,
        explain: "Fallback: intención de archivos recientes detectada por keywords.",
      };
    }

    const tok = safeToken(userQuery);
    return {
      mode: "search",
      driveQuery: addFolderGuardToQuery(
        `name contains '${driveEscape(tok)}' or fullText contains '${driveEscape(tok)}'`
      ),
      mimeTypes: [],
      dateRange: { from: null, to: null },
      sort: "relevance",
      topK: defaultTopK,
      candidatesK: 40,
      shouldRerank: true,
      explain: "Fallback: búsqueda básica por nombre o contenido.",
    };
  }

  async answerWithFiles({ userQuery, files }) {
    // Seguridad: jamás pasar carpetas al modelo
    const filtered = onlyFiles(files);

    const prompt = `
Eres un asistente de biblioteca.
Con base en la consulta del usuario y una lista de archivos encontrados, responde en 2–4 oraciones.
No inventes contenido de los documentos. Solo usa títulos y reasons.

Devuelve SOLO JSON válido:
{"answer":"..."}

Usuario: ${userQuery}
Archivos: ${JSON.stringify(filtered)}
    `.trim();

    const resp = await this.model.generateContent({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
    });

    const text =
      resp?.response?.candidates?.[0]?.content?.parts?.map((p) => p.text).join("") ?? "";
    const json = extractJson(text);

    try {
      return JSON.parse(json)?.answer ?? "";
    } catch {
      return "";
    }
  }

  async rerank({ userQuery, candidates, topK }) {
    // Seguridad: jamás rankear carpetas
    const filteredCandidates = onlyFiles(candidates);

    const items = filteredCandidates.map((d) => ({
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
{"ranked":[{"id":"...","score":0.0,"reason":"..."}]}
    `.trim();

    const resp = await this.model.generateContent({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
    });

    const text =
      resp?.response?.candidates?.[0]?.content?.parts?.map((p) => p.text).join("") ?? "";
    const json = extractJson(text);

    let ranked = [];
    try {
      ranked = JSON.parse(json)?.ranked ?? [];
    } catch {
      ranked = [];
    }

    const byId = new Map(filteredCandidates.map((d) => [d.id, d]));
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

    if (out.length < topK) {
      const used = new Set(out.map((x) => x.id));
      for (const d of filteredCandidates) {
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

  async summarizeText({ userQuery, docTitle, docText, mimeType }) {
    const prompt = `
Eres un asistente que resume documentos.
Si NO hay texto (docText vacío), dilo claramente y sugiere abrir el archivo.

Devuelve SOLO JSON: {"answer":"..."}

Usuario: ${userQuery}
Documento: ${docTitle}
mimeType: ${mimeType}
Texto (puede estar vacío):
${docText}
    `.trim();

    const resp = await this.model.generateContent({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
    });

    const text =
      resp?.response?.candidates?.[0]?.content?.parts?.map((p) => p.text).join("") ?? "";
    const json = extractJson(text);

    try {
      return JSON.parse(json)?.answer ?? "";
    } catch {
      return "";
    }
  }
}
