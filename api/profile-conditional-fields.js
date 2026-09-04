// Conditional result fields and the notification skip list.
import { isPlainObject, requireString } from "./profile-primitives.js";
import { jsonValuesEqual } from "./profile-runtime-config.js";

export function validateNotifySkipItems(value, materialCodes, errors) {
  if (value === undefined) return;
  if (!Array.isArray(value)) {
    errors.push("notifySkipMaterials must be an array");
    return;
  }
  const seen = new Set();
  value.forEach((code, index) => {
    requireString(code, `notifySkipMaterials[${index}]`, errors);
    if (typeof code !== "string" || !code.trim()) return;
    if (seen.has(code)) errors.push(`notifySkipMaterials[${index}] must be unique`);
    else seen.add(code);
    if (!materialCodes.has(code)) errors.push(`notifySkipMaterials[${index}] must reference materialGroups`);
  });
}

export function validateConditionalFields(value, resultKeys, errors) {
  if (value === undefined) return;
  if (!Array.isArray(value)) {
    errors.push("conditionalFields must be an array");
    return;
  }
  value.forEach((field, index) => {
    const path = `conditionalFields[${index}]`;
    if (!isPlainObject(field)) {
      errors.push(`${path} must be an object`);
      return;
    }
    requireString(field.field, `${path}.field`, errors);
    for (const key of ["perResult", "perGrade"]) {
      validateConditionalResultMap(field[key], `${path}.${key}`, resultKeys, errors);
    }
    if (isPlainObject(field.perResult) && isPlainObject(field.perGrade)
        && !jsonValuesEqual(field.perResult, field.perGrade)) {
      errors.push(`${path}.perGrade must deeply equal perResult during staged migration`);
    }
  });
}

function validateConditionalResultMap(value, path, resultKeys, errors) {
  if (value === undefined) return;
  if (!isPlainObject(value)) {
    errors.push(`${path} must be an object`);
    return;
  }
  for (const [key, selected] of Object.entries(value)) {
    if (resultKeys.size > 0 && !resultKeys.has(key)) {
      errors.push(`${path}.${key} must reference gradeMap`);
    }
    if (!Array.isArray(selected)) errors.push(`${path}.${key} must be an array`);
  }
}

