// Shapes for the settings values the panel accepts: session-invalid signals, URLs and scalar sets.

export function validSessionInvalidCodes(value) {
  return Array.isArray(value) && value.every((item) =>
    (typeof item === "string" && item.trim() !== "")
    || (typeof item === "number" && Number.isFinite(item)));
}

export function validSessionInvalidHttpStatuses(value) {
  return Array.isArray(value)
    && new Set(value).size === value.length
    && value.every((item) => Number.isInteger(item) && item >= 100 && item <= 599);
}

export function validSessionInvalidMessagePatterns(value) {
  return Array.isArray(value)
    && value.every((item) => typeof item === "string" && item.trim() !== "");
}

export function normalizedUrl(value) {
  return typeof value === "string" ? value.trim().replace(/\/+$/u, "") : "";
}

export function normalizedScalarSet(value, { lowerCase = false } = {}) {
  if (!Array.isArray(value)) return null;
  return [...new Set(value.map((item) => {
    const text = String(item).trim();
    return lowerCase ? text.toLowerCase() : text;
  }).filter(Boolean))].sort();
}
