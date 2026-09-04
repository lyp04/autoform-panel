// The configuration error type and the generic parse/merge/collect helpers every rule uses.

export class BackendConfigurationError extends Error {
  constructor(errors) {
    const list = Array.isArray(errors) ? errors : [String(errors)];
    super(`backend adapter is not configured: ${list.join("; ")}`);
    this.name = "BackendConfigurationError";
    this.errors = list;
  }
}

export function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

export function mergeObjects(base, incoming) {
  const out = isPlainObject(base) ? clone(base) : {};
  if (!isPlainObject(incoming)) return out;
  for (const [key, value] of Object.entries(incoming)) {
    if (isPlainObject(value) && isPlainObject(out[key])) out[key] = mergeObjects(out[key], value);
    else out[key] = clone(value);
  }
  return out;
}

export function parseObject(value, label) {
  if (value === undefined || value === null || value === "") return {};
  if (isPlainObject(value)) return clone(value);
  if (typeof value !== "string") throw new BackendConfigurationError(`${label} must be a JSON object`);
  try {
    const parsed = JSON.parse(value);
    if (!isPlainObject(parsed)) throw new Error("must be an object");
    return parsed;
  } catch (error) {
    throw new BackendConfigurationError(`${label} is invalid JSON (${error.message})`);
  }
}

export function configuredValues(value) {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null || value === "") return [];
  if (typeof value !== "string") return [value];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return value.split(",").map((item) => item.trim()).filter(Boolean);
  }
}

export function addRequiredString(errors, value, path) {
  if (typeof value !== "string" || !value.trim()) errors.push(`${path} is required`);
}

export function addDistinctFieldNames(errors, value, keys, path) {
  const firstKeyByValue = new Map();
  for (const key of keys) {
    const field = typeof value?.[key] === "string" ? value[key].trim() : "";
    if (!field) continue;
    if (firstKeyByValue.has(field)) {
      errors.push(`${path}.${key} must differ from ${path}.${firstKeyByValue.get(field)}`);
    } else {
      firstKeyByValue.set(field, key);
    }
  }
}

export function addStringArray(errors, value, path, { allowEmpty = false } = {}) {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0)) {
    errors.push(`${path} must be ${allowEmpty ? "an" : "a non-empty"} array`);
    return;
  }
  value.forEach((item, index) => {
    if (typeof item !== "string" || !item.trim()) errors.push(`${path}[${index}] must be a non-empty string`);
  });
}

export function addBusinessValueArray(errors, value, path, { allowEmpty = false } = {}) {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0)) {
    errors.push(`${path} must be ${allowEmpty ? "an" : "a non-empty"} array`);
    return;
  }
  value.forEach((item, index) => {
    const valid = (typeof item === "string" && item.trim())
      || (typeof item === "number" && Number.isFinite(item))
      || typeof item === "boolean";
    if (!valid) errors.push(`${path}[${index}] must be a string, number or boolean`);
  });
}

function normalizedBusinessValue(value) {
  return typeof value === "string" ? value.trim() : String(value);
}

export function addUniqueBusinessValueArray(errors, value, path, { allowEmpty = false } = {}) {
  addBusinessValueArray(errors, value, path, { allowEmpty });
  if (!Array.isArray(value)) return;
  const seen = new Set();
  value.forEach((item, index) => {
    const key = normalizedBusinessValue(item);
    if (seen.has(key)) errors.push(`${path}[${index}] must not be duplicated`);
    seen.add(key);
  });
}

export function addUniqueStringArray(errors, value, path, { allowEmpty = false } = {}) {
  addStringArray(errors, value, path, { allowEmpty });
  if (!Array.isArray(value)) return;
  const seen = new Set();
  value.forEach((item, index) => {
    if (typeof item !== "string" || !item.trim()) return;
    const key = item.trim();
    if (seen.has(key)) errors.push(`${path}[${index}] must not be duplicated`);
    seen.add(key);
  });
}

