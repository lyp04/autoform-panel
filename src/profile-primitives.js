// Generic assertion helpers shared by every profile rule module.

export function requireString(value, path, errors) {
  if (typeof value !== "string" || value.trim() === "") {
    errors.push(`${path} is required`);
  }
}

export function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function allowOnly(value, allowed, path, errors) {
  if (!isPlainObject(value)) return;
  const accepted = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (!accepted.has(key)) errors.push(`${path}.${key} is not supported`);
  }
}

export function validateRequiredPolicyAction(value, key, allowed, path, required, errors) {
  if (!required && value[key] === undefined) return;
  validateOneOf(value[key], allowed, path, errors);
}

export function validateIntegerRange(value, min, max, path, errors) {
  if (!Number.isInteger(value) || value < min || value > max) {
    errors.push(`${path} must be an integer from ${min} to ${max}`);
  }
}

// Lenient validator for an optional {en,es} sibling map. undefined/null -> OK (zh-only is valid).
// Otherwise it must be a plain object whose only keys are "en"/"es", each mapping to a string.
export function validateI18n(obj, key, path, errors) {
  const val = obj ? obj[key] : undefined;
  if (val === undefined || val === null) return;
  if (typeof val !== "object" || Array.isArray(val)) {
    errors.push(`${path} must be an object with en/es string values`);
    return;
  }
  for (const [k, v] of Object.entries(val)) {
    if (k !== "en" && k !== "es") {
      errors.push(`${path}.${k} is not a supported language (only en/es)`);
    } else if (typeof v !== "string") {
      errors.push(`${path}.${k} must be a string`);
    }
  }
}

const RESULT_OPERATOR_LABEL_MAX_LENGTH = 160;

export function validateOperatorLabel(value, path, errors) {
  if (value === undefined) return;
  if (typeof value !== "string" || !value.trim()) {
    errors.push(`${path} must be a non-empty string`);
    return;
  }
  if (value !== value.trim()) errors.push(`${path} must not have surrounding whitespace`);
  if (value.length > RESULT_OPERATOR_LABEL_MAX_LENGTH) {
    errors.push(`${path} must contain at most ${RESULT_OPERATOR_LABEL_MAX_LENGTH} characters`);
  }
}

export function validateOperatorLabelI18n(value, path, errors) {
  if (value === undefined) return;
  if (!isPlainObject(value)) {
    errors.push(`${path} must be an object with en/es string values`);
    return;
  }
  allowOnly(value, ["en", "es"], path, errors);
  for (const locale of ["en", "es"]) {
    if (!Object.prototype.hasOwnProperty.call(value, locale)) continue;
    validateOperatorLabel(value[locale], `${path}.${locale}`, errors);
  }
}

export function validateOneOf(value, allowed, path, errors) {
  if (!allowed.includes(value)) {
    errors.push(`${path} must be one of: ${allowed.join(", ")}`);
  }
}

