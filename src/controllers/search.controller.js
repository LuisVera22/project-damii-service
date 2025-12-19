import { SearchRequestSchema } from "../models/schemas.js";
import { HttpError } from "../utils/errors.js";

export class SearchController {
  constructor({ searchService }) {
    this.searchService = searchService;
  }

  buscar = async (req, res, next) => {
    try {
      const parsed = SearchRequestSchema.safeParse(req.body);
      if (!parsed.success) throw new HttpError(400, "query es requerido");

      const payload = await this.searchService.search(parsed.data);
      res.json(payload);
    } catch (err) {
      next(err);
    }
  };
}
