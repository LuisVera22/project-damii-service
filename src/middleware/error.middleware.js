import { HttpError } from "../utils/errors.js";

export function errorMiddleware(err, req, res, next) { // eslint-disable-line
  const status = err instanceof HttpError ? err.status : 500;

  const body = {
    error: err?.message ?? "Internal Server Error"
  };

  if (err instanceof HttpError && err.details) body.details = err.details;

  console.error(err);
  res.status(status).json(body);
}
