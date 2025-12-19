export function extractJson(s) {
  if (!s) return "{}";
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return "{}";
  return s.slice(start, end + 1);
}

export function safeToken(str) {
  return String(str ?? "")
    .trim()
    .slice(0, 60)
    .replace(/'/g, "")
    .replace(/\s+/g, " ");
}
