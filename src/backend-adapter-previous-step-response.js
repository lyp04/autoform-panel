// Response contracts for previous-step recipe and lookup operations.
import { addBusinessValueArray, addStringArray, isPlainObject } from "./backend-adapter-primitives.js";

export function validatePreviousStepRecipeResponseOperation(operation, errors, required) {
  if (!isPlainObject(operation)) {
    if (required) errors.push("operations.previousSteps must be configured");
    return;
  }
  addStringArray(errors, operation.retryableMessagePatterns,
    "operations.previousSteps.retryableMessagePatterns", { allowEmpty: true });
  addStringArray(errors, operation.alreadyExistsMessagePatterns,
    "operations.previousSteps.alreadyExistsMessagePatterns", { allowEmpty: true });
}

export function validatePreviousStepLookupResponseOperation(operation, errors, required) {
  if (!isPlainObject(operation)) {
    if (required) errors.push("operations.previousSteps must be configured");
    return;
  }
  addBusinessValueArray(errors, operation.missingResponseCodes,
    "operations.previousSteps.missingResponseCodes", { allowEmpty: true });
  if (Array.isArray(operation.missingResponseCodes)) {
    const seen = new Set();
    operation.missingResponseCodes.forEach((value, index) => {
      const key = (typeof value === "string" ? value.trim() : String(value));
      if (seen.has(key)) {
        errors.push(`operations.previousSteps.missingResponseCodes[${index}] must not be duplicated`);
      }
      seen.add(key);
    });
  }
  addStringArray(errors, operation.missingMessagePatterns,
    "operations.previousSteps.missingMessagePatterns", { allowEmpty: true });
}

/** Strict capability check used when a published profile enables previous-step handling. */
export function validatePreviousStepRecipeResponseConfig(adapter) {
  const errors = [];
  validatePreviousStepLookupResponseOperation(adapter?.operations?.previousSteps, errors, true);
  validatePreviousStepRecipeResponseOperation(adapter?.operations?.previousSteps, errors, true);
  return errors;
}

