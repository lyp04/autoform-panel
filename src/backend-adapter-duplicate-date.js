// Duplicate date parsing, its compatibility policy, and material refresh.
import { addBusinessValueArray, addRequiredString, addStringArray, isPlainObject } from "./backend-adapter-primitives.js";
import { validateExistingMaterialQuantityPolicy } from "./backend-adapter-recovery.js";

export function validateDuplicateDateParsingOperation(operation, errors, required) {
  if (!isPlainObject(operation)) {
    if (required) errors.push("operations.duplicateCheck must be configured");
    return;
  }
  addStringArray(errors, operation.dateTransforms,
    "operations.duplicateCheck.dateTransforms", { allowEmpty: true });
  if (Array.isArray(operation.dateTransforms)) {
    const allowed = new Set([
      "iso_t_to_space",
      "localized_ymd_to_dashes",
      "strip_fractional_suffix",
      "strip_trailing_z",
      "truncate_after_seconds"
    ]);
    const seen = new Set();
    operation.dateTransforms.forEach((transform, index) => {
      if (!allowed.has(transform)) {
        errors.push(`operations.duplicateCheck.dateTransforms[${index}] must be one of: ${[...allowed].join(", ")}`);
      }
      if (seen.has(transform)) {
        errors.push(`operations.duplicateCheck.dateTransforms[${index}] must not be duplicated`);
      } else {
        seen.add(transform);
      }
    });
  }
  addStringArray(errors, operation.epochUnits,
    "operations.duplicateCheck.epochUnits", { allowEmpty: true });
  if (Array.isArray(operation.epochUnits)) {
    const seen = new Set();
    operation.epochUnits.forEach((unit, index) => {
      if (!["seconds", "milliseconds"].includes(unit)) {
        errors.push(`operations.duplicateCheck.epochUnits[${index}] must be seconds or milliseconds`);
      } else if (seen.has(unit)) {
        errors.push(`operations.duplicateCheck.epochUnits[${index}] must not be duplicated`);
      } else {
        seen.add(unit);
      }
    });
  }
  addStringArray(errors, operation.dateFormats,
    "operations.duplicateCheck.dateFormats", { allowEmpty: true });
  if (Array.isArray(operation.epochUnits) && operation.epochUnits.length === 0
      && Array.isArray(operation.dateFormats) && operation.dateFormats.length === 0) {
    errors.push("operations.duplicateCheck must configure at least one epoch unit or date format");
  }
  addRequiredString(errors, operation.timeZone, "operations.duplicateCheck.timeZone");
  if (typeof operation.timeZone === "string" && operation.timeZone.trim()) {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: operation.timeZone });
    } catch {
      errors.push("operations.duplicateCheck.timeZone must be a valid IANA time zone");
    }
  }
}

export function validateDuplicateDateCompatibilityPolicy(operation, errors) {
  if (!isPlainObject(operation)) return;
  const keys = [
    "epochDigitLengths",
    "numericFractionPolicy",
    "textParseConsumption",
    "plausibilityScope",
    "timeZoneSource",
    "rootValueEnabled"
  ];
  const numericEpochPrecisionDeclared = Object.prototype.hasOwnProperty.call(
    operation, "numericEpochPrecision");
  if (!keys.some((key) => Object.prototype.hasOwnProperty.call(operation, key))
      && !numericEpochPrecisionDeclared) return;

  const path = "operations.duplicateCheck";
  if (!Array.isArray(operation.epochDigitLengths)) {
    errors.push(`${path}.epochDigitLengths must be an array`);
  } else {
    const seen = new Set();
    operation.epochDigitLengths.forEach((length, index) => {
      if (!Number.isInteger(length) || length < 1 || length > 19 || seen.has(length)) {
        errors.push(`${path}.epochDigitLengths[${index}] must be a unique integer from 1 to 19`);
      }
      seen.add(length);
    });
  }

  for (const [key, allowed] of [
    ["numericFractionPolicy", ["reject", "truncate"]],
    ["textParseConsumption", ["full", "prefix"]],
    ["plausibilityScope", ["all", "epoch_only"]],
    ["timeZoneSource", ["configured", "device"]]
  ]) {
    if (!allowed.includes(operation[key])) {
      errors.push(`${path}.${key} must be one of: ${allowed.join(", ")}`);
    }
  }
  if (typeof operation.rootValueEnabled !== "boolean") {
    errors.push(`${path}.rootValueEnabled must be a boolean`);
  }
  if (numericEpochPrecisionDeclared
      && !["exact", "minute_floor"].includes(operation.numericEpochPrecision)) {
    errors.push(`${path}.numericEpochPrecision must be one of: exact, minute_floor`);
  }
}

/** Strict capability check used only when a published profile enables duplicate checking. */
export function validateDuplicateDateParsingConfig(adapter) {
  const errors = [];
  const operation = adapter?.operations?.duplicateCheck;
  validateDuplicateDateParsingOperation(operation, errors, true);
  validateDuplicateDateCompatibilityPolicy(operation, errors);
  return errors;
}

/** Strict capability check used only by profiles that refresh item options before submit. */
export function validateMaterialRefreshConfig(adapter) {
  const errors = [];
  addRequiredString(errors, adapter?.endpoints?.templateDetail,
    "endpoints.templateDetail");
  addRequiredString(errors, adapter?.operations?.templateDetail?.idParam,
    "operations.templateDetail.idParam");
  addRequiredString(errors, adapter?.fields?.template?.fieldList,
    "fields.template.fieldList");
  for (const key of ["id", "type", "parentType", "typeName", "title", "englishTitle", "options"]) {
    addRequiredString(errors, adapter?.fields?.formField?.[key],
      `fields.formField.${key}`);
  }
  for (const key of ["value", "label", "englishLabel", "quantity"]) {
    addRequiredString(errors, adapter?.fields?.option?.[key], `fields.option.${key}`);
  }
  addBusinessValueArray(errors, adapter?.conversion?.fieldKinds?.items,
    "conversion.fieldKinds.items");
  if (isPlainObject(adapter?.operations?.templateDetail)) {
    validateExistingMaterialQuantityPolicy(adapter.operations.templateDetail, errors);
  }
  return errors;
}

