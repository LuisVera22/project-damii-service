export function buildDriveQ({ folderId, driveExpr, mimeTypes }) {
  const parts = [`'${folderId}' in parents`, "trashed=false"];
  if (driveExpr && String(driveExpr).trim()) parts.push(`(${driveExpr})`);

  if (Array.isArray(mimeTypes) && mimeTypes.length) {
    const mt = mimeTypes.map((m) => `mimeType='${m}'`).join(" or ");
    parts.push(`(${mt})`);
  }

  return parts.join(" and ");
}
