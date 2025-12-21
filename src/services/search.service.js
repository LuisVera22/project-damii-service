import { HttpError } from "../utils/errors.js";
import { safeToken } from "../utils/json.js";

export class SearchService {
  constructor({ env, driveClient, vertexClient }) {
    this.env = env;
    this.drive = driveClient;
    this.vertex = vertexClient;
  }

  async search({ query, topK }) {
    const { driveFolderId, rerankTopN, defaultTopK } = this.env;

    // driveFolderId es la "carpeta raíz" del árbol a buscar
    if (!driveFolderId)
      throw new HttpError(500, "DRIVE_FOLDER_ID no configurado");

    // 0) Intención desde lenguaje natural (Vertex plan)
    const plan = await this.vertex.buildPlan({ userQuery: query, defaultTopK });
    const finalTopK = Math.max(
      1,
      Math.min(topK ?? plan.topK ?? defaultTopK, 20)
    );

    // Helper: búsqueda recursiva dentro del árbol (raíz + descendientes)
    const searchTree = async ({
      driveExpr,
      pageSize,
      mimeTypes,
      timeRange,
    }) => {
      return this.drive.searchInTree({
        rootFolderId: driveFolderId,
        driveExpr,
        pageSize,
        mimeTypes,
        timeRange,
      });
    };

    // 1) RECENT (recursivo)
    if (plan.mode === "recent") {
      const docs = await this.drive.listRecentInTree({
        rootFolderId: driveFolderId,
        pageSize: finalTopK,
      });

      const files = (docs ?? []).map((d) => ({
        id: d.id,
        title: d.name,
        link: d.webViewLink,
        score: 0,
        reason: "Archivo reciente (ordenado por fecha de modificación).",
      }));

      return {
        status: "ok",
        total: files.length,
        query,
        answer: files.length
          ? `Aquí tienes los ${files.length} archivos más recientes dentro del árbol.`
          : "No encontré archivos recientes dentro del árbol de tu carpeta raíz.",
        files,
        meta: { mode: "recent", explain: plan.explain ?? "" },
      };
    }

    // 2) TITLE (alta precisión por nombre, pero recursivo)
    if (plan.mode === "title") {
      // Usa el plan (si viene armado) para mejorar coincidencia + no carpetas
      const fallbackTitle = safeToken(plan.titleQuery || query);
      const driveExpr = plan.driveQuery || `name contains '${fallbackTitle}'`;

      const candidates = await searchTree({
        driveExpr,
        pageSize: Math.max(finalTopK, 10),
        mimeTypes: plan.mimeTypes,
        timeRange: plan.timeRange,
      });

      const results = candidates.slice(0, finalTopK).map((d) => ({
        id: d.id,
        title: d.name,
        link: d.webViewLink,
        score: 0,
        reason: "Coincidencia por título/nombre dentro del árbol.",
      }));

      const answer = results.length
        ? `Encontré ${results.length} archivo(s) que coinciden con el título solicitado dentro del árbol.`
        : "No encontré archivos con ese nombre dentro del árbol. Prueba con una parte del título.";

      return {
        status: "ok",
        total: results.length,
        query,
        answer,
        files: results,
        meta: {
          mode: "title",
          explain: plan.explain ?? "",
          candidates: candidates.length,
        },
      };
    }

    // 3) SUMMARIZE (resolver archivo dentro del árbol y resumir)
    if (plan.mode === "summarize") {
      const maxChars = plan.summary?.maxChars ?? 12000;

      // 3.1) resolver fileId: directo o por titleQuery (recursivo)
      let fileId = plan.summary?.fileId ?? null;

      if (!fileId) {
        const tq = safeToken(plan.summary?.titleQuery || query);

        // Usa plan.driveQuery si viene, para que el planner controle candidatos
        const driveExpr = plan.driveQuery || `name contains '${tq}'`;

        const pick = await searchTree({
          driveExpr,
          pageSize: 5,
        });

        fileId = pick?.[0]?.id ?? null;
      }

      if (!fileId) {
        return {
          status: "ok",
          total: 0,
          query,
          answer:
            "No pude identificar qué documento resumir dentro del árbol. Intenta decir el nombre exacto del archivo.",
          files: [],
          meta: { mode: "summarize", explain: plan.explain ?? "" },
        };
      }

      // 3.2) meta + extracción de texto
      const meta = await this.drive.getFileMeta(fileId);
      const mt = meta.mimeType;

      let text = "";
      try {
        if (mt === "application/vnd.google-apps.document") {
          text = await this.drive.exportGoogleDocText(fileId);
        } else if (mt?.startsWith("text/")) {
          text = await this.drive.downloadTextFile(fileId);
        } else {
          text = ""; // PDF/DOCX: por ahora no parseamos aquí
        }
      } catch {
        text = "";
      }

      // 3.3) resumen
      const summary = await this.vertex.summarizeText({
        userQuery: query,
        docTitle: meta.name,
        docText: text ? String(text).slice(0, maxChars) : "",
        mimeType: mt,
      });

      const files = [
        {
          id: meta.id,
          title: meta.name,
          link: meta.webViewLink,
          score: 1,
          reason: "Documento resumido.",
        },
      ];

      return {
        status: "ok",
        total: 1,
        query,
        answer:
          summary ||
          `Puedo resumir “${meta.name}”, pero no pude extraer texto de este tipo de archivo aún.`,
        files,
        meta: { mode: "summarize", mimeType: mt, explain: plan.explain ?? "" },
      };
    }

    // 4) SEARCH (contexto: nombre + fullText + filtros, recursivo)
    const driveExpr =
      plan.driveQuery ||
      `name contains '${safeToken(query)}' or fullText contains '${safeToken(
        query
      )}'`;

    const candidates = await searchTree({
      driveExpr,
      pageSize: plan.candidatesK ?? 40,
      mimeTypes: plan.mimeTypes,
      timeRange: plan.timeRange,
    });

    const shouldRerank = plan.shouldRerank !== false && candidates.length > 3;
    let results;

    if (shouldRerank) {
      const topForRerank = candidates.slice(
        0,
        Math.min(candidates.length, rerankTopN)
      );
      results = await this.vertex.rerank({
        userQuery: query,
        candidates: topForRerank,
        topK: finalTopK,
      });
    } else {
      results = candidates.slice(0, finalTopK).map((d) => ({
        id: d.id,
        title: d.name,
        link: d.webViewLink,
        score: 0,
        reason: "Coincidencia directa en Drive dentro del árbol.",
      }));
    }

    const files = results.map((r) => ({
      id: r.id,
      title: r.title,
      link: r.link,
      score: r.score,
      reason: r.reason,
    }));

    let answer = "";
    if (files.length === 0) {
      // NO hay archivos → mensaje fijo, sin IA
      answer =
        "No encontré documentos relacionados. Prueba con otra frase o usa términos más específicos.";
    } else {
      // SÍ hay archivos → la IA SOLO describe, nunca niega resultados
      const aiAnswer = await this.vertex.answerWithFiles({
        userQuery: query,
        files: files.slice(0, 10),
      });

      // Si la IA responde algo raro o vacío, usamos fallback seguro
      answer =
        aiAnswer && !/no encontr(e|ó)|no hay|ningún documento/i.test(aiAnswer)
          ? aiAnswer
          : `Encontré ${files.length} documento(s) relacionados con tu búsqueda.`;
    }

    return {
      status: "ok",
      total: files.length,
      query,
      answer,
      files,
      meta: {
        mode: "search",
        explain: plan.explain ?? "",
        candidates: candidates.length,
        reranked: shouldRerank,
      },
    };
  }
}
