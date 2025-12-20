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

    if (!driveFolderId) throw new HttpError(500, "DRIVE_FOLDER_ID no configurado");

    const plan = await this.vertex.buildPlan({ userQuery: query, defaultTopK });
    const finalTopK = Math.max(1, Math.min(topK ?? plan.topK ?? defaultTopK, 20));

    // 1) RECENT
    if (plan.mode === "recent") {
      const docs = await this.drive.listRecentInFolder({ folderId: driveFolderId, pageSize: finalTopK });
      const files = (docs ?? []).map((d) => ({
        id: d.id, title: d.name, link: d.webViewLink, score: 0,
        reason: "Archivo reciente (ordenado por fecha de modificación)."
      }));

      return {
        status: "ok",
        total: files.length,
        query,
        answer: files.length
          ? `Aquí tienes los ${files.length} archivos más recientes.`
          : "No encontré archivos recientes en tu carpeta.",
        files,
        meta: { mode: "recent", explain: plan.explain ?? "" }
      };
    }

    // 2) TITLE (alta precisión por nombre)
    if (plan.mode === "title") {
      const title = safeToken(plan.titleQuery || query);
      const driveExpr = `name contains '${title}'`; // precisión por título

      const candidates = await this.drive.searchInFolder({
        folderId: driveFolderId,
        driveExpr,
        pageSize: Math.max(finalTopK, 10),
        mimeTypes: plan.mimeTypes,
        timeRange: plan.timeRange
      });

      const results = candidates.slice(0, finalTopK).map((d) => ({
        id: d.id, title: d.name, link: d.webViewLink, score: 0,
        reason: "Coincidencia por título/nombre."
      }));

      const answer = results.length
        ? `Encontré ${results.length} archivo(s) que coinciden con el título solicitado.`
        : "No encontré archivos con ese nombre. Prueba con una parte del título o revisa la carpeta.";

      return {
        status: "ok",
        total: results.length,
        query,
        answer,
        files: results,
        meta: { mode: "title", explain: plan.explain ?? "", candidates: candidates.length }
      };
    }

    // 3) SUMMARIZE
    if (plan.mode === "summarize") {
      const maxChars = plan.summary?.maxChars ?? 12000;

      // 3.1) resolver fileId: directo o por titleQuery
      let fileId = plan.summary?.fileId ?? null;

      if (!fileId) {
        const tq = safeToken(plan.summary?.titleQuery || query);
        const pick = await this.drive.searchInFolder({
          folderId: driveFolderId,
          driveExpr: `name contains '${tq}'`,
          pageSize: 5
        });
        fileId = pick?.[0]?.id ?? null;
      }

      if (!fileId) {
        return {
          status: "ok",
          total: 0,
          query,
          answer: "No pude identificar qué documento resumir. Intenta decir el nombre exacto del archivo.",
          files: [],
          meta: { mode: "summarize", explain: plan.explain ?? "" }
        };
      }

      const meta = await this.drive.getFileMeta(fileId);

      // 3.2) extraer texto (MVP: Google Docs + text/plain)
      let text = "";
      const mt = meta.mimeType;

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

      // 3.3) pedir resumen a Vertex
      const summary = await this.vertex.summarizeText({
        userQuery: query,
        docTitle: meta.name,
        docText: text ? String(text).slice(0, maxChars) : "",
        mimeType: mt
      });

      const files = [{
        id: meta.id,
        title: meta.name,
        link: meta.webViewLink,
        score: 1,
        reason: "Documento resumido."
      }];

      return {
        status: "ok",
        total: 1,
        query,
        answer: summary || `Puedo resumir “${meta.name}”, pero no pude extraer texto de este tipo de archivo aún.`,
        files,
        meta: { mode: "summarize", mimeType: mt, explain: plan.explain ?? "" }
      };
    }

    // 4) SEARCH (contexto)
    const driveExpr =
      plan.driveQuery ||
      `name contains '${safeToken(query)}' or fullText contains '${safeToken(query)}'`;

    const candidates = await this.drive.searchInFolder({
      folderId: driveFolderId,
      driveExpr,
      pageSize: plan.candidatesK ?? 40,
      mimeTypes: plan.mimeTypes,
      timeRange: plan.timeRange
    });

    const shouldRerank = plan.shouldRerank !== false && candidates.length > 3;
    let results;

    if (shouldRerank) {
      const topForRerank = candidates.slice(0, Math.min(candidates.length, rerankTopN));
      results = await this.vertex.rerank({
        userQuery: query,
        candidates: topForRerank,
        topK: finalTopK
      });
    } else {
      results = candidates.slice(0, finalTopK).map((d) => ({
        id: d.id,
        title: d.name,
        link: d.webViewLink,
        score: 0,
        reason: "Coincidencia directa en Drive."
      }));
    }

    const files = results.map((r) => ({
      id: r.id, title: r.title, link: r.link, score: r.score, reason: r.reason
    }));

    let answer = "";
    if (files.length > 0) {
      answer = await this.vertex.answerWithFiles({ userQuery: query, files: files.slice(0, 10) });
    }
    if (!answer) {
      answer = files.length
        ? `Encontré ${files.length} archivo(s) relacionados.`
        : "No encontré documentos relacionados en tu carpeta. Prueba con otra frase.";
    }

    return {
      status: "ok",
      total: files.length,
      query,
      answer,
      files,
      meta: { mode: "search", explain: plan.explain ?? "", candidates: candidates.length, reranked: shouldRerank }
    };
  }
}
