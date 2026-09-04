// The submission round payload: its items, fields and template container.
import { ISO_DATE_TIME_PATTERN, MAX_DETAIL_LENGTH, MAX_IDENTIFIER_LENGTH, MAX_LABEL_LENGTH, MAX_ROUND_COUNT, MAX_ROUND_ITEMS, MAX_TIMESTAMP_LENGTH, SUBMISSION_ROUND_FIELDS } from "./notification-adapter-constants.js";
import { boundedString, isPlainObject, parseIsoOffsetDateTime, validateStringArray } from "./notification-adapter-primitives.js";

function validateMissingItems(value, errors) {
  const path = "data.missingItems";
  if (!Array.isArray(value)) {
    errors.push(`${path} must be an array`);
    return;
  }
  if (value.length > MAX_ROUND_ITEMS) {
    errors.push(`${path} must not contain more than ${MAX_ROUND_ITEMS} items`);
  }
  value.forEach((item, index) => {
    const itemPath = `${path}[${index}]`;
    if (!isPlainObject(item)) {
      errors.push(`${itemPath} must be an object`);
      return;
    }
    for (const key of Object.keys(item)) {
      if (!new Set(["label", "affectedCount"]).has(key)) {
        errors.push(`${itemPath}.${key} is not supported`);
      }
    }
    if (!boundedString(item.label, MAX_LABEL_LENGTH)) {
      errors.push(`${itemPath}.label must be a non-empty string not exceeding ${MAX_LABEL_LENGTH} characters`);
    }
    if (!Number.isInteger(item.affectedCount)
        || item.affectedCount < 1 || item.affectedCount > MAX_ROUND_COUNT) {
      errors.push(`${itemPath}.affectedCount must be an integer from 1 to ${MAX_ROUND_COUNT}`);
    }
  });
}

export function validateSubmissionRoundData(data) {
  const errors = [];
  if (!isPlainObject(data)) return ["data must be an object"];
  const allowed = new Set(SUBMISSION_ROUND_FIELDS);
  for (const key of Object.keys(data)) {
    if (!allowed.has(key)) errors.push(`data.${key} is not supported`);
  }
  for (const key of SUBMISSION_ROUND_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(data, key)) {
      errors.push(`data.${key} is required`);
    }
  }
  if (typeof data.success !== "boolean") errors.push("data.success must be a boolean");
  if (!boundedString(data.profileLabel, MAX_LABEL_LENGTH)) {
    errors.push(`data.profileLabel must be a non-empty string not exceeding ${MAX_LABEL_LENGTH} characters`);
  }
  if (!boundedString(data.operatorLabel, MAX_LABEL_LENGTH, { allowEmpty: true })) {
    errors.push(`data.operatorLabel must be a string not exceeding ${MAX_LABEL_LENGTH} characters`);
  }
  if (!boundedString(data.completedAt, MAX_TIMESTAMP_LENGTH)
      || !ISO_DATE_TIME_PATTERN.test(data.completedAt)
      || !parseIsoOffsetDateTime(data.completedAt)) {
    errors.push("data.completedAt must be an ISO-8601 date-time with an explicit offset");
  }
  if (!Number.isInteger(data.submittedCount)
      || data.submittedCount < 0 || data.submittedCount > MAX_ROUND_COUNT) {
    errors.push(`data.submittedCount must be an integer from 0 to ${MAX_ROUND_COUNT}`);
  }
  validateMissingItems(data.missingItems, errors);
  validateStringArray(data.newMissingItems, "data.newMissingItems", MAX_LABEL_LENGTH, errors);
  validateStringArray(data.recoveredItems, "data.recoveredItems", MAX_LABEL_LENGTH, errors);
  validateStringArray(data.errors, "data.errors", MAX_DETAIL_LENGTH, errors);
  validateStringArray(data.unconfirmedIdentifiers,
    "data.unconfirmedIdentifiers", MAX_IDENTIFIER_LENGTH, errors);
  validateStringArray(data.networkAffectedIdentifiers,
    "data.networkAffectedIdentifiers", MAX_IDENTIFIER_LENGTH, errors);
  return errors;
}

export function validateTemplateContainer(value, path, errors, depth = 0) {
  if (depth > 8) {
    errors.push(`${path} must not exceed 8 levels`);
    return;
  }
  if (typeof value === "string") {
    if (value.length > 4000) errors.push(`${path} strings must not exceed 4000 characters`);
    return;
  }
  if (Array.isArray(value)) {
    if (value.length > 100) errors.push(`${path} arrays must not contain more than 100 items`);
    value.forEach((item, index) => validateTemplateContainer(item, `${path}[${index}]`, errors, depth + 1));
    return;
  }
  if (isPlainObject(value)) {
    const entries = Object.entries(value);
    if (entries.length > 100) errors.push(`${path} objects must not contain more than 100 fields`);
    for (const [key, item] of entries) {
      if (!boundedString(key, 128)) errors.push(`${path} contains an invalid field name`);
      validateTemplateContainer(item, `${path}.${key}`, errors, depth + 1);
    }
  }
}
