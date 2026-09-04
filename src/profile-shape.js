// Value shapes shared across the profile rules: photo ordering, input sources, and the
// normalizers for serial numbers and grades.

export const PHOTO_ORDERS = Object.freeze(["fronts_then_backs", "front_back_per_unit"]);

export const PHOTO_INPUT_SOURCES = Object.freeze(["camera", "gallery", "file"]);

export function normalizeSn(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, "")
    .toUpperCase();
}

export function normalizeGrade(value, fallback = "") {
  const key = String(value || "").trim();
  return key || String(fallback || "").trim();
}

export function normalizePhotoOrder(value, fallback = "fronts_then_backs") {
  const order = String(value || "").trim();
  if (PHOTO_ORDERS.includes(order)) {
    return order;
  }
  return PHOTO_ORDERS.includes(fallback) ? fallback : "fronts_then_backs";
}

