import { HttpError } from "../utils/errors.js";
import { safeToken } from "../utils/json.js";

export class SearchService {
  constructor({ env, driveClient, vertexClient }) {
    this.env = env;
    this.drive = driveClient;
    this.vertex = vertexClient;
  }

  async search({ query, topK }) {
    const {
      driveFolderId,
      rerankTopN,
      defaultTopK
    } = this.env;

    if (!driveFolderId) {
      throw new HttpError(500, "DRIVE_FOLDER_ID no configurado");
    }

    // 1) IA → planner simple
    const plan = await this.vertex.buildPlan({
      userQuery: query,
      defaultTopK
    });

    const finalTopK = Math.max(1, Math.min(topK ?? plan.topK ?? defaultTopK, 20));

    // MODE: RECENT  (últimos archivos)
    if (plan.mode === "recent") {
      const docs = await this.drive.listRecentInFolder({
        folderId: driveFolderId,
        pageSize: finalTopK
      });

      const files = docs.map((d) => ({
        id: d.id,
        title: d.name,
        link: d.webViewLink,
        score: 0,
        reason: "Archivo reciente (ordenado por fecha de modificación)."
      }));

      const answer = files.length
        ? `Aquí tienes los ${files.length} archivos más recientes de tu carpeta.`
        : "No encontré archivos recientes en tu carpeta.";

      return {
        status: "ok",
        total: files.length,
        query,
        answer,
        files,
        meta: { mode: "recent", explain: plan.explain }
      };
    }

    // MODE: LIST  (listar carpeta)
    if (plan.mode === "list") {
      const resp = await this.drive.listFolder({
        folderId: driveFolderId,
        pageSize: finalTopK,
        pageToken: null
      });

      const files = (resp.files ?? resp).map((d) => ({
        id: d.id,
        title: d.name ?? d.nombre,
        link: d.webViewLink ?? d.vistaWeb,
        score: 0,
        reason: "Listado de carpeta."
      }));

      const answer = files.length
        ? `Aquí tienes ${files.length} elementos de la carpeta.`
        : "No encontré archivos para listar.";

      return {
        status: "ok",
        total: files.length,
        query,
        answer,
        files,
        meta: { mode: "list", explain: plan.explain }
      };
    }

    // MODE: SEARCH (búsqueda semántica)
    const driveExpr =
      plan.driveQuery ||
      `name contains '${safeToken(query)}' or fullText contains '${safeToken(query)}'`;

    const candidates = await this.drive.searchInFolder({
      folderId: driveFolderId,
      driveExpr,
      pageSize: plan.candidatesK ?? 40,
      mimeTypes: plan.mimeTypes,
      dateRange: plan.dateRange
    });

    
    // RERANK
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

    
    // RESPUESTA NATURAL + FILES
    const files = results.map((r) => ({
      id: r.id,
      title: r.title,
      link: r.link,
      score: r.score,
      reason: r.reason
    }));

    let answer = "";
    if (files.length > 0) {
      answer = await this.vertex.answerWithFiles({
        userQuery: query,
        files: files.slice(0, 10)
      });
    }

    if (!answer) {
      answer =
        files.length === 0
          ? "No encontré documentos relacionados en tu carpeta. Prueba con otra frase."
          : `Encontré ${files.length} archivo(s) relacionados. Revisa la lista y dime cuál quieres abrir.`;
    }

    return {
      status: "ok",
      total: files.length,
      query,
      answer,
      files,
      meta: {
        mode: "search",
        explain: plan.explain,
        candidates: candidates.length,
        reranked: shouldRerank
      }
    };
  }
}