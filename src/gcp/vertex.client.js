import { extractJson } from "../utils/json.js";

export class VertexClient {

  async answerWithFiles({ userQuery, files }) {
    const prompt = `
        Eres un asistente de biblioteca. 
        El usuario hizo una consulta y el sistema encontró una lista de archivos en Google Drive.

        Tu tarea:
        - Redacta una respuesta breve (2 a 5 oraciones) en español.
        - Menciona qué encontraste y qué recomendarías abrir primero.
        - Usa SOLO la información disponible en títulos y reasons. NO inventes contenido.
        - Devuelve SOLO JSON válido.

        Usuario: ${userQuery}

        Archivos:
        ${JSON.stringify(files)}

        Esquema:
        {"answer":"..."}
    `.trim();

    const resp = await this.client.models.generateContent(this.model, prompt);
    const raw = resp.text();

    const json = extractJson(raw);
    try {
      return JSON.parse(json)?.answer ?? "";
    } catch {
      return "";
    }
  }
}
