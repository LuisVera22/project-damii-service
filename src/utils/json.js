export function extractJson(raw) {
  if (!raw) return "{}";
  let s = String(raw).trim();

  // remove ```json fences
  if (s.startsWith("```")) {
    s = s.replace(/^```[a-zA-Z]*\s*/, "").replace(/\s*```$/, "").trim();
  }

  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start >= 0 && end > start) return s.slice(start, end + 1).trim();
  return s;
}

export function safeToken(str) {
  return String(str ?? "")
    .trim()
    .slice(0, 60)
    .replace(/'/g, "")
    .replace(/\s+/g, " ");
}
