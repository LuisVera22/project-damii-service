export function buildDriveQ({ folderId, driveExpr }) {
  const parts = [
    `'${folderId}' in parents`,
    "trashed=false",
    "mimeType != 'application/vnd.google-apps.folder'"
  ];
  if (driveExpr && String(driveExpr).trim()) parts.push(`(${driveExpr})`);
  return parts.join(" and ");
}

