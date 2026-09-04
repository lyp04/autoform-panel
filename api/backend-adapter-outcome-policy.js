// Submit and previous-step recipe outcome policies, plus operator label helpers.
import { PREVIOUS_STEP_RECIPE_OUTCOME_POLICY_VERSION, RESULT_OPERATOR_LABEL_MAX_LENGTH, SUBMIT_OUTCOME_POLICY_VERSION } from "./backend-adapter-constants.js";
import { addUniqueBusinessValueArray, addUniqueStringArray, isPlainObject } from "./backend-adapter-primitives.js";

function validateOutcomeRules(value, path, errors) {
  if (!Array.isArray(value)) {
    errors.push(`${path} must be an array`);
    return;
  }
  // Panel owns the closed data shape only. Android evaluates conditions within one rule as AND
  // and evaluates the ordered rule list as OR against the actual backend response.
  value.forEach((rule, index) => {
    const rulePath = `${path}[${index}]`;
    if (!isPlainObject(rule)) {
      errors.push(`${rulePath} must be an object`);
      return;
    }
    allowOnly(errors, rule, ["codeValues", "messagePatterns"], rulePath);
    addUniqueBusinessValueArray(errors, rule.codeValues,
      `${rulePath}.codeValues`, { allowEmpty: true });
    addUniqueStringArray(errors, rule.messagePatterns,
      `${rulePath}.messagePatterns`, { allowEmpty: true });
    const hasCodes = Array.isArray(rule.codeValues) && rule.codeValues.length > 0;
    const hasMessages = Array.isArray(rule.messagePatterns) && rule.messagePatterns.length > 0;
    if (!hasCodes && !hasMessages) {
      errors.push(`${rulePath} must configure at least one code value or message pattern`);
    }
  });
}

export function validateSubmitOutcomePolicy(operation, errors, required = false) {
  const policy = operation?.outcomePolicy;
  if (!isPlainObject(policy)) {
    if (required) errors.push("operations.submit.outcomePolicy must be configured");
    else if (policy !== undefined) errors.push("operations.submit.outcomePolicy must be an object");
    return;
  }
  allowOnly(errors, policy, [
    "version", "evidenceSha256", "retryableNotWrittenRules",
    "missingMaterialNotWrittenRules"
  ], "operations.submit.outcomePolicy");
  if (policy.version !== SUBMIT_OUTCOME_POLICY_VERSION) {
    errors.push(`operations.submit.outcomePolicy.version must be ${SUBMIT_OUTCOME_POLICY_VERSION}`);
  }
  if (typeof policy.evidenceSha256 !== "string"
      || !/^[0-9a-f]{64}$/u.test(policy.evidenceSha256)) {
    errors.push("operations.submit.outcomePolicy.evidenceSha256 must be lowercase SHA-256");
  }
  validateOutcomeRules(policy.retryableNotWrittenRules,
    "operations.submit.outcomePolicy.retryableNotWrittenRules", errors);
  validateOutcomeRules(policy.missingMaterialNotWrittenRules,
    "operations.submit.outcomePolicy.missingMaterialNotWrittenRules", errors);
}

/** Strict capability check for backend-attested submit outcomes. Legacy adapters may omit it. */
export function validateSubmitOutcomePolicyConfig(
  adapter,
  { required = true, requireRetryRules = false, requireMissingMaterialRules = false } = {}
) {
  const errors = [];
  const operation = adapter?.operations?.submit;
  validateSubmitOutcomePolicy(operation, errors, required);
  const policy = operation?.outcomePolicy;
  if (!isPlainObject(policy)) return errors;
  if (requireRetryRules
      && (!Array.isArray(policy.retryableNotWrittenRules)
          || policy.retryableNotWrittenRules.length === 0)) {
    errors.push("operations.submit.outcomePolicy.retryableNotWrittenRules must be non-empty");
  }
  if (requireMissingMaterialRules
      && (!Array.isArray(policy.missingMaterialNotWrittenRules)
          || policy.missingMaterialNotWrittenRules.length === 0)) {
    errors.push("operations.submit.outcomePolicy.missingMaterialNotWrittenRules must be non-empty");
  }
  return errors;
}

export function validatePreviousStepRecipeOutcomePolicy(operation, errors, required = false) {
  const policy = operation?.recipeOutcomePolicy;
  if (!isPlainObject(policy)) {
    if (required) {
      errors.push("operations.previousSteps.recipeOutcomePolicy must be configured");
    } else if (policy !== undefined) {
      errors.push("operations.previousSteps.recipeOutcomePolicy must be an object");
    }
    return;
  }
  const path = "operations.previousSteps.recipeOutcomePolicy";
  allowOnly(errors, policy, [
    "version", "evidenceSha256", "retryableNotWrittenRules",
    "alreadyExistsAcknowledgedRules"
  ], path);
  if (policy.version !== PREVIOUS_STEP_RECIPE_OUTCOME_POLICY_VERSION) {
    errors.push(`${path}.version must be ${PREVIOUS_STEP_RECIPE_OUTCOME_POLICY_VERSION}`);
  }
  if (typeof policy.evidenceSha256 !== "string"
      || !/^[0-9a-f]{64}$/u.test(policy.evidenceSha256)) {
    errors.push(`${path}.evidenceSha256 must be lowercase SHA-256`);
  }
  validateOutcomeRules(policy.retryableNotWrittenRules,
    `${path}.retryableNotWrittenRules`, errors);
  validateOutcomeRules(policy.alreadyExistsAcknowledgedRules,
    `${path}.alreadyExistsAcknowledgedRules`, errors);
}

/** Strict capability check for backend-attested previous-step recipe POST outcomes. */
export function validatePreviousStepRecipeOutcomePolicyConfig(
  adapter,
  { required = true, requireRetryRules = false, requireAlreadyExistsRules = false } = {}
) {
  const errors = [];
  const operation = adapter?.operations?.previousSteps;
  validatePreviousStepRecipeOutcomePolicy(operation, errors, required);
  const policy = operation?.recipeOutcomePolicy;
  if (!isPlainObject(policy)) return errors;
  if (requireRetryRules
      && (!Array.isArray(policy.retryableNotWrittenRules)
          || policy.retryableNotWrittenRules.length === 0)) {
    errors.push(
      "operations.previousSteps.recipeOutcomePolicy.retryableNotWrittenRules must be non-empty");
  }
  if (requireAlreadyExistsRules
      && (!Array.isArray(policy.alreadyExistsAcknowledgedRules)
          || policy.alreadyExistsAcknowledgedRules.length === 0)) {
    errors.push(
      "operations.previousSteps.recipeOutcomePolicy.alreadyExistsAcknowledgedRules must be non-empty");
  }
  return errors;
}

export function validateOptionalOperatorLabel(errors, value, path) {
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

export function validateOptionalOperatorLabelI18n(errors, value, path) {
  if (value === undefined) return;
  if (!isPlainObject(value)) {
    errors.push(`${path} must be an object with en/es string values`);
    return;
  }
  allowOnly(errors, value, ["en", "es"], path);
  for (const locale of ["en", "es"]) {
    if (!Object.prototype.hasOwnProperty.call(value, locale)) continue;
    validateOptionalOperatorLabel(errors, value[locale], `${path}.${locale}`);
  }
}

export function allowOnly(errors, value, allowed, path) {
  if (!isPlainObject(value)) return;
  const keys = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (!keys.has(key)) errors.push(`${path}.${key} is not supported`);
  }
}

export function placeholderBaseUrl(value) {
  try {
    const host = new URL(value).hostname.toLowerCase();
    return host === "example.com"
      || host.endsWith(".example.com")
      || host === "example.net"
      || host.endsWith(".example.net")
      || host === "example.org"
      || host.endsWith(".example.org")
      || host.endsWith(".example.invalid")
      || host.startsWith("your-");
  } catch {
    return false;
  }
}

