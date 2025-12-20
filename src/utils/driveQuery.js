export function buildDriveQ({ folderId, driveExpr, mimeTypes, timeRange }) {
  const parts = [];
  if (folderId) parts.push(`'${folderId}' in parents`);
  parts.push("trashed=false");

  if (driveExpr && String(driveExpr).trim()) {
    parts.push(`(${String(driveExpr).trim()})`);
  }

  if (Array.isArray(mimeTypes) && mimeTypes.length) {
    const mt = mimeTypes.map((m) => `mimeType='${m}'`).join(" or ");
    parts.push(`(${mt})`);
  }

  // filtros por modifiedTime (RFC3339 básico)
  if (timeRange?.from) parts.push(`modifiedTime >= '${timeRange.from}T00:00:00Z'`);
  if (timeRange?.to) parts.push(`modifiedTime <= '${timeRange.to}T23:59:59Z'`);

  return parts.join(" and ");
}
