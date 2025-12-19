import { HttpError } from "../utils/errors.js";

export class SearchService {
  constructor({ env, driveClient, vertexClient }) {
    this.env = env;
    this.drive = driveClient;
    this.vertex = vertexClient;
  }

  async search({ query, topK }) {
    const {
      driveFolderId,
      maxDriveQueries,
      pageSizePerQuery,
      rerankTopN,
      defaultTopK
    } = this.env;

    if (!driveFolderId) throw new HttpError(500, "DRIVE_FOLDER_ID no configurado");

    // 1) IA: plan
    const plan = await this.vertex.buildPlan({
      userQuery: query,
      maxDriveQueries,
      defaultTopK
    });

    const finalTopK = Math.max(1, Math.min(topK ?? plan.topK ?? defaultTopK, 20));

    // 2) Drive: múltiples queries + dedupe
    const dedup = new Map();
    const usedQueries = (plan.queries ?? []).slice(0, maxDriveQueries);

    for (const dq of usedQueries) {
      const docs = await this.drive.searchInFolder({
        folderId: driveFolderId,
        driveExpr: dq.driveExpr,
        mimeTypes: plan.mimeTypes,
        pageSize: pageSizePerQuery
      });

      for (const d of docs) {
        if (!dedup.has(d.id)) dedup.set(d.id, d);
      }
    }

    const candidates = Array.from(dedup.values());

    // 3) Rerank (gating simple)
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

    return {
      query,
      intent: plan.intent,
      expandedTerms: plan.expandedTerms ?? [],
      meta: {
        usedQueries: usedQueries.length,
        candidates: candidates.length,
        reranked: shouldRerank
      },
      results
    };
  }
}
