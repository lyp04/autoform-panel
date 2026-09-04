// Versioned contract shared by the panel browser, Worker and Android app.
//
// Deployment-specific values come from BACKEND_ADAPTER_JSON (Cloudflare var/secret) or from the
// private catalog's settings.backendAdapter. Public source code deliberately contains no live API
// host, endpoint path, business success code or backend field name.

export const BACKEND_ADAPTER_VERSION = 1;

const RESULT_OPERATOR_LABEL_MAX_LENGTH = 160;

const AUTHORING_ENDPOINTS = Object.freeze([
  "captcha",
  "login",
  "userInfo",
  "templateList",
  "templateDetail"
]);

const CORE_APP_ENDPOINTS = Object.freeze([
  "uploadFile",
  "submitEntry"
]);

const REQUIRED_TEMPLATE_FIELDS = Object.freeze([
  "id",
  "name",
  "sku",
  "step",
  "warehouseId",
  "fieldList"
]);

const REQUIRED_FORM_FIELDS = Object.freeze([
  "id",
  "type",
  "parentType",
  "typeName",
  "title",
  "englishTitle",
  "required",
  "visible",
  "maxCount",
  "options"
]);

const REQUIRED_OPTION_FIELDS = Object.freeze(["value", "label", "englishLabel", "quantity"]);

const CANONICAL_FIELD_KINDS = Object.freeze([
  "photo",
  "result",
  "items",
  "serial",
  "scan",
  "number",
  "singleChoice",
  "multipleChoice",
  "text"
]);

const RECIPE_SELECTOR_ATTRIBUTES = Object.freeze([
  "id",
  "kind",
  "type",
  "parentType",
  "typeName",
  "title",
  "englishTitle",
  "searchText",
  "required",
  "visible",
  "hasOptions"
]);

const RECIPE_SEARCH_TEXT_ATTRIBUTES = Object.freeze([
  "id", "type", "parentType", "typeName", "title", "englishTitle"
]);

const RECIPE_BUILDER_TYPES = Object.freeze([
  "literal", "present", "firstNonEmpty", "integer", "object"
]);

const RECIPE_CARDINALITIES = Object.freeze([
  "exactly_one", "first_in_backend_order"
]);

const RECIPE_ACTION_TYPES = Object.freeze([
  "serial", "photo", "fixedOption", "omit"
]);

const RECIPE_PATH_KEYS = Object.freeze({
  template: Object.freeze(["id", "name", "sku", "step", "warehouseId", "fieldList"]),
  field: Object.freeze([
    "id", "type", "parentType", "typeName", "title", "englishTitle", "required",
    "visible", "maxCount", "options", "kind", "searchText", "hasOptions"
  ]),
  option: Object.freeze(["id", "title", "englishTitle", "quantity", "searchText", "hasOptions"]),
  input: Object.freeze(["serial"]),
  identity: Object.freeze(["templateId", "expectedStep", "warehouseId", "sku"])
});

const RECIPE_LIMITS = Object.freeze({
  mapEntries: 32,
  rules: 32,
  selectorPredicates: 16,
  selectorTotalPredicates: 32,
  arrayItems: 16,
  builderDepth: 8,
  builderNodes: 512,
  objectMembers: 32,
  literalDepth: 12,
  literalItems: 256,
  idLength: 128,
  stringLength: 4096
});

export const CONTROLLED_RECOVERY_VERSION = 1;
export const CONTROLLED_RECOVERY_OPERATIONS = Object.freeze([
  "FINAL_SUBMISSION",
  "PREVIOUS_STEP_RECIPE",
  "MULTIPART_UPLOAD"
]);

export const SUBMIT_OUTCOME_POLICY_VERSION = 1;
export const PREVIOUS_STEP_RECIPE_OUTCOME_POLICY_VERSION = 1;

const ENDPOINT_KEYS = Object.freeze([
  ...AUTHORING_ENDPOINTS,
  ...CORE_APP_ENDPOINTS,
  "loginVerify",
  "printerState",
  "messageList",
  "labelRetry",
  "detectionData",
  "snRepetition"
]);

export class BackendConfigurationError extends Error {
  constructor(errors) {
    const list = Array.isArray(errors) ? errors : [String(errors)];
    super(`backend adapter is not configured: ${list.join("; ")}`);
    this.name = "BackendConfigurationError";
    this.errors = list;
  }
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function mergeObjects(base, incoming) {
  const out = isPlainObject(base) ? clone(base) : {};
  if (!isPlainObject(incoming)) return out;
  for (const [key, value] of Object.entries(incoming)) {
    if (isPlainObject(value) && isPlainObject(out[key])) out[key] = mergeObjects(out[key], value);
    else out[key] = clone(value);
  }
  return out;
}

function parseObject(value, label) {
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

function configuredValues(value) {
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

function addRequiredString(errors, value, path) {
  if (typeof value !== "string" || !value.trim()) errors.push(`${path} is required`);
}

function addDistinctFieldNames(errors, value, keys, path) {
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

function addStringArray(errors, value, path, { allowEmpty = false } = {}) {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0)) {
    errors.push(`${path} must be ${allowEmpty ? "an" : "a non-empty"} array`);
    return;
  }
  value.forEach((item, index) => {
    if (typeof item !== "string" || !item.trim()) errors.push(`${path}[${index}] must be a non-empty string`);
  });
}

function addBusinessValueArray(errors, value, path, { allowEmpty = false } = {}) {
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

function addUniqueBusinessValueArray(errors, value, path, { allowEmpty = false } = {}) {
  addBusinessValueArray(errors, value, path, { allowEmpty });
  if (!Array.isArray(value)) return;
  const seen = new Set();
  value.forEach((item, index) => {
    const key = normalizedBusinessValue(item);
    if (seen.has(key)) errors.push(`${path}[${index}] must not be duplicated`);
    seen.add(key);
  });
}

function addUniqueStringArray(errors, value, path, { allowEmpty = false } = {}) {
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

function validateSubmitOutcomePolicy(operation, errors, required = false) {
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

function validatePreviousStepRecipeOutcomePolicy(operation, errors, required = false) {
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

function validateOptionalOperatorLabel(errors, value, path) {
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

function validateOptionalOperatorLabelI18n(errors, value, path) {
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

function allowOnly(errors, value, allowed, path) {
  if (!isPlainObject(value)) return;
  const keys = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (!keys.has(key)) errors.push(`${path}.${key} is not supported`);
  }
}

function placeholderBaseUrl(value) {
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

/** Validate the full adapter used for panel authoring.
 *
 * loginVerify is optional because many generic backends perform login in one request. App-only
 * endpoints and printing fields may be present and are preserved, but are validated by their
 * consumer so a deployment can turn those features off without inventing unused routes. */
export function validateBackendAdapter(adapter) {
  const errors = [];
  if (!isPlainObject(adapter)) return ["backendAdapter must be an object"];
  allowOnly(errors, adapter,
    ["version", "baseUrl", "endpoints", "request", "response", "auth", "pagination", "fields", "conversion", "operations", "printing"],
    "backendAdapter");
  if (adapter.version !== BACKEND_ADAPTER_VERSION) {
    errors.push(`version must be ${BACKEND_ADAPTER_VERSION}`);
  }
  addRequiredString(errors, adapter.baseUrl, "baseUrl");
  if (typeof adapter.baseUrl === "string" && adapter.baseUrl.trim()) {
    try {
      const url = new URL(adapter.baseUrl);
      if (url.protocol !== "https:" && url.protocol !== "http:") errors.push("baseUrl must use http or https");
      if (placeholderBaseUrl(adapter.baseUrl)) errors.push("baseUrl is still an example placeholder");
    } catch {
      errors.push("baseUrl must be an absolute URL");
    }
  }

  if (!isPlainObject(adapter.endpoints)) errors.push("endpoints must be an object");
  else {
    allowOnly(errors, adapter.endpoints, ENDPOINT_KEYS, "endpoints");
    [...AUTHORING_ENDPOINTS, ...CORE_APP_ENDPOINTS].forEach((key) =>
      addRequiredString(errors, adapter.endpoints[key], `endpoints.${key}`));
  }

  if (!isPlainObject(adapter.request)) {
    errors.push("request must be an object");
  } else {
    allowOnly(errors, adapter.request,
      ["bodyEncoding", "authScheme", "fingerprintHeader", "webUserAgent", "webAcceptLanguage"],
      "request");
    if (!['form', 'json'].includes(adapter.request.bodyEncoding)) {
      errors.push('request.bodyEncoding must be "form" or "json"');
    }
    addRequiredString(errors, adapter.request.authScheme, "request.authScheme");
    if (adapter.request.fingerprintHeader !== undefined && typeof adapter.request.fingerprintHeader !== "string") {
      errors.push("request.fingerprintHeader must be a string");
    }
    if (typeof adapter.request.webUserAgent !== "string") {
      errors.push("request.webUserAgent must be an explicit string");
    }
    if (typeof adapter.request.webAcceptLanguage !== "string") {
      errors.push("request.webAcceptLanguage must be an explicit string");
    }
  }

  if (!isPlainObject(adapter.response)) {
    errors.push("response must be an object");
  } else {
    const compatibilityKeys = [
      "successFieldsWhenCodeMissing",
      "dataRootWhenCodeMissing",
      "rejectMessageWhenCodeMissing"
    ];
    allowOnly(errors, adapter.response,
      ["codeField", "dataField", "messageFields", "successValues", ...compatibilityKeys],
      "response");
    if (adapter.response.codeField !== undefined && typeof adapter.response.codeField !== "string") {
      errors.push("response.codeField must be a string");
    }
    if (adapter.response.dataField !== undefined && typeof adapter.response.dataField !== "string") {
      errors.push("response.dataField must be a string");
    }
    addStringArray(errors, adapter.response.messageFields, "response.messageFields");
    if (adapter.response.codeField) {
      if (!Array.isArray(adapter.response.successValues) || adapter.response.successValues.length === 0) {
        errors.push("response.successValues must be a non-empty array when response.codeField is set");
      }
    }
    const declaredCompatibilityKeys = compatibilityKeys.filter((key) =>
      Object.prototype.hasOwnProperty.call(adapter.response, key));
    if (declaredCompatibilityKeys.length > 0 && declaredCompatibilityKeys.length < compatibilityKeys.length) {
      for (const key of compatibilityKeys) {
        if (!Object.prototype.hasOwnProperty.call(adapter.response, key)) {
          errors.push(`response.${key} must be declared with the code-missing compatibility group`);
        }
      }
    }
    if (Object.prototype.hasOwnProperty.call(
      adapter.response, "successFieldsWhenCodeMissing")) {
      addStringArray(errors, adapter.response.successFieldsWhenCodeMissing,
        "response.successFieldsWhenCodeMissing");
      if (Array.isArray(adapter.response.successFieldsWhenCodeMissing)) {
        const seenPaths = new Set();
        adapter.response.successFieldsWhenCodeMissing.forEach((path, index) => {
          const normalized = typeof path === "string" ? path.trim() : "";
          if (normalized && seenPaths.has(normalized)) {
            errors.push(
              `response.successFieldsWhenCodeMissing[${index}] must not be duplicated`);
          }
          if (normalized) seenPaths.add(normalized);
        });
      }
    }
    for (const key of ["dataRootWhenCodeMissing", "rejectMessageWhenCodeMissing"]) {
      if (Object.prototype.hasOwnProperty.call(adapter.response, key)
          && typeof adapter.response[key] !== "boolean") {
        errors.push(`response.${key} must be a boolean`);
      }
    }
  }

  if (!isPlainObject(adapter.auth)) {
    errors.push("auth must be an object");
  } else {
    allowOnly(errors, adapter.auth,
      ["loginFields", "tokenFields", "userNameFields", "sessionProofCodes", "sessionInvalidHttpStatuses", "sessionInvalidCodes", "sessionInvalidMessagePatterns", "successFieldsWhenCodeMissing", "dataRootWhenCodeMissing"],
      "auth");
    if (!isPlainObject(adapter.auth.loginFields)) errors.push("auth.loginFields must be an object");
    else {
      allowOnly(errors, adapter.auth.loginFields, ["account", "password", "captcha", "client"], "auth.loginFields");
      ["account", "password", "captcha", "client"].forEach((key) =>
        addRequiredString(errors, adapter.auth.loginFields[key], `auth.loginFields.${key}`));
    }
    addStringArray(errors, adapter.auth.tokenFields, "auth.tokenFields");
    addStringArray(errors, adapter.auth.userNameFields, "auth.userNameFields");
    if (adapter.auth.successFieldsWhenCodeMissing !== undefined) {
      addStringArray(errors, adapter.auth.successFieldsWhenCodeMissing,
        "auth.successFieldsWhenCodeMissing");
      if (Array.isArray(adapter.auth.successFieldsWhenCodeMissing)) {
        const seenPaths = new Set();
        adapter.auth.successFieldsWhenCodeMissing.forEach((path, index) => {
          const normalized = typeof path === "string" ? path.trim() : "";
          if (normalized && seenPaths.has(normalized)) {
            errors.push(`auth.successFieldsWhenCodeMissing[${index}] must not be duplicated`);
          }
          if (normalized) seenPaths.add(normalized);
        });
      }
    }
    if (adapter.auth.dataRootWhenCodeMissing !== undefined
        && typeof adapter.auth.dataRootWhenCodeMissing !== "boolean") {
      errors.push("auth.dataRootWhenCodeMissing must be a boolean");
    }
    if (adapter.auth.sessionProofCodes !== undefined && !Array.isArray(adapter.auth.sessionProofCodes)) {
      errors.push("auth.sessionProofCodes must be an array");
    }
    if (!Array.isArray(adapter.auth.sessionInvalidCodes)) {
      errors.push("auth.sessionInvalidCodes must be an array");
    }
    if (!Array.isArray(adapter.auth.sessionInvalidHttpStatuses)) {
      errors.push("auth.sessionInvalidHttpStatuses must be an array");
    } else {
      const seenStatuses = new Set();
      adapter.auth.sessionInvalidHttpStatuses.forEach((status, index) => {
        if (!Number.isInteger(status) || status < 100 || status > 599 || seenStatuses.has(status)) {
          errors.push(`auth.sessionInvalidHttpStatuses[${index}] must be a unique HTTP status from 100 to 599`);
        }
        seenStatuses.add(status);
      });
    }
    addStringArray(errors, adapter.auth.sessionInvalidMessagePatterns,
      "auth.sessionInvalidMessagePatterns", { allowEmpty: true });
  }

  if (!isPlainObject(adapter.pagination)) {
    errors.push("pagination must be an object");
  } else {
    allowOnly(errors, adapter.pagination, ["pageParam", "pageStart", "keywordParam"], "pagination");
    addRequiredString(errors, adapter.pagination.pageParam, "pagination.pageParam");
    if (!Number.isInteger(adapter.pagination.pageStart)) errors.push("pagination.pageStart must be an integer");
    addRequiredString(errors, adapter.pagination.keywordParam, "pagination.keywordParam");
  }

  if (!isPlainObject(adapter.fields)) {
    errors.push("fields must be an object");
  } else {
    allowOnly(errors, adapter.fields,
      ["captchaClient", "captchaImage", "templateList", "template", "formField", "option"], "fields");
    addRequiredString(errors, adapter.fields.captchaClient, "fields.captchaClient");
    addRequiredString(errors, adapter.fields.captchaImage, "fields.captchaImage");
    addStringArray(errors, adapter.fields.templateList, "fields.templateList");
    for (const [group, keys] of [
      ["template", REQUIRED_TEMPLATE_FIELDS],
      ["formField", REQUIRED_FORM_FIELDS],
      ["option", REQUIRED_OPTION_FIELDS]
    ]) {
      if (!isPlainObject(adapter.fields[group])) errors.push(`fields.${group} must be an object`);
      else {
        allowOnly(errors, adapter.fields[group], keys, `fields.${group}`);
        keys.forEach((key) => addRequiredString(errors, adapter.fields[group][key], `fields.${group}.${key}`));
      }
    }
  }
  validateConversion(adapter.conversion, errors);
  validateOperations(adapter.operations, adapter.endpoints, errors);
  validatePrinting(adapter, errors);
  return errors;
}

function validateConversion(conversion, errors) {
  if (!isPlainObject(conversion)) {
    errors.push("conversion must be an object");
    return;
  }
  allowOnly(errors, conversion, ["fieldKinds", "result"], "conversion");
  if (!isPlainObject(conversion.fieldKinds)) {
    errors.push("conversion.fieldKinds must be an object");
  } else {
    allowOnly(errors, conversion.fieldKinds, CANONICAL_FIELD_KINDS, "conversion.fieldKinds");
    for (const kind of CANONICAL_FIELD_KINDS) {
      addBusinessValueArray(errors, conversion.fieldKinds[kind], `conversion.fieldKinds.${kind}`, { allowEmpty: true });
    }
  }
  const result = conversion.result;
  if (!isPlainObject(result)) {
    errors.push("conversion.result must be an object");
    return;
  }
  allowOnly(errors, result, ["includeUnmapped", "mappings"], "conversion.result");
  if (typeof result.includeUnmapped !== "boolean") {
    errors.push("conversion.result.includeUnmapped must be a boolean");
  }
  if (!Array.isArray(result.mappings)) {
    errors.push("conversion.result.mappings must be an array");
    return;
  }
  const keys = new Set();
  result.mappings.forEach((mapping, index) => {
    const path = `conversion.result.mappings[${index}]`;
    if (!isPlainObject(mapping)) {
      errors.push(`${path} must be an object`);
      return;
    }
    allowOnly(errors, mapping,
      ["key", "label", "labelI18n", "operatorLabel", "operatorLabelI18n", "uiColor",
        "include", "submitValue", "matchValues", "matchLabelPatterns"], path);
    addRequiredString(errors, mapping.key, `${path}.key`);
    if (typeof mapping.key === "string" && mapping.key.trim()) {
      if (keys.has(mapping.key)) errors.push(`${path}.key must be unique`);
      keys.add(mapping.key);
    }
    if (mapping.label !== undefined && typeof mapping.label !== "string") {
      errors.push(`${path}.label must be a string`);
    }
    if (mapping.labelI18n !== undefined) {
      if (!isPlainObject(mapping.labelI18n)) errors.push(`${path}.labelI18n must be an object`);
      else for (const [language, value] of Object.entries(mapping.labelI18n)) {
        if (!["en", "es"].includes(language) || typeof value !== "string") {
          errors.push(`${path}.labelI18n must contain only en/es strings`);
          break;
        }
      }
    }
    validateOptionalOperatorLabel(errors, mapping.operatorLabel,
      `${path}.operatorLabel`);
    validateOptionalOperatorLabelI18n(errors, mapping.operatorLabelI18n,
      `${path}.operatorLabelI18n`);
    if (mapping.uiColor !== undefined && !/^#[0-9a-fA-F]{6}$/.test(String(mapping.uiColor))) {
      errors.push(`${path}.uiColor must be a six-digit hex color`);
    }
    if (mapping.include !== undefined && typeof mapping.include !== "boolean") {
      errors.push(`${path}.include must be a boolean`);
    }
    // submitValue is deliberately allowed to be any JSON value. It is deployment data copied
    // verbatim into the generated profile, so the public converter never invents a payload shape.
    addBusinessValueArray(errors, mapping.matchValues, `${path}.matchValues`, { allowEmpty: true });
    addStringArray(errors, mapping.matchLabelPatterns, `${path}.matchLabelPatterns`, { allowEmpty: true });
    (Array.isArray(mapping.matchLabelPatterns) ? mapping.matchLabelPatterns : []).forEach((pattern, patternIndex) => {
      try {
        new RegExp(pattern, "i");
      } catch {
        errors.push(`${path}.matchLabelPatterns[${patternIndex}] must be a valid regular expression`);
      }
    });
  });
}

function validateOperations(operations, endpoints, errors) {
  if (!isPlainObject(operations)) {
    errors.push("operations must be an object");
    return;
  }
  allowOnly(errors, operations,
    ["upload", "ocr", "submit", "previousSteps", "duplicateCheck", "templateDetail", "recovery"], "operations");
  if (!isPlainObject(operations.upload)) {
    errors.push("operations.upload must be an object");
  } else {
    allowOnly(errors, operations.upload, ["multipartField", "resultPath"], "operations.upload");
    addRequiredString(errors, operations.upload.multipartField, "operations.upload.multipartField");
    addRequiredString(errors, operations.upload.resultPath, "operations.upload.resultPath");
  }
  if (operations.ocr !== undefined && !isPlainObject(operations.ocr)) {
    errors.push("operations.ocr must be an object");
  } else if (isPlainObject(operations.ocr)) {
    allowOnly(errors, operations.ocr, ["multipartField", "userInfoUrlFields", "resultPaths"], "operations.ocr");
    addRequiredString(errors, operations.ocr.multipartField, "operations.ocr.multipartField");
    addStringArray(errors, operations.ocr.userInfoUrlFields, "operations.ocr.userInfoUrlFields");
    addStringArray(errors, operations.ocr.resultPaths, "operations.ocr.resultPaths");
  }
  if (!isPlainObject(operations.submit)) {
    errors.push("operations.submit must be an object");
  } else {
    allowOnly(errors, operations.submit,
      ["templateIdField", "warehouseIdField", "skuField", "dataField", "videoIdField", "videoIdValue", "materialItemMapping", "retryableMessagePatterns", "missingMaterialMessagePatterns", "outcomePolicy"],
      "operations.submit");
    for (const key of ["templateIdField", "warehouseIdField", "skuField", "dataField", "videoIdField"]) {
      addRequiredString(errors, operations.submit[key], `operations.submit.${key}`);
    }
    addDistinctFieldNames(errors, operations.submit,
      ["templateIdField", "warehouseIdField", "skuField", "dataField", "videoIdField"],
      "operations.submit");
    if (!isPlainObject(operations.submit.materialItemMapping)) {
      errors.push("operations.submit.materialItemMapping must be an object");
    } else {
      allowOnly(errors, operations.submit.materialItemMapping,
        ["codeField", "nameField", "quantityField"], "operations.submit.materialItemMapping");
      for (const key of ["codeField", "nameField", "quantityField"]) {
        addRequiredString(errors, operations.submit.materialItemMapping[key], `operations.submit.materialItemMapping.${key}`);
      }
      addDistinctFieldNames(errors, operations.submit.materialItemMapping,
        ["codeField", "nameField", "quantityField"],
        "operations.submit.materialItemMapping");
    }
    if (!Object.prototype.hasOwnProperty.call(operations.submit, "videoIdValue")) {
      errors.push("operations.submit.videoIdValue is required");
    }
    addStringArray(errors, operations.submit.retryableMessagePatterns,
      "operations.submit.retryableMessagePatterns", { allowEmpty: true });
    addStringArray(errors, operations.submit.missingMaterialMessagePatterns,
      "operations.submit.missingMaterialMessagePatterns", { allowEmpty: true });
    validateSubmitOutcomePolicy(operations.submit, errors, false);
  }
  if (operations.previousSteps !== undefined && !isPlainObject(operations.previousSteps)) {
    errors.push("operations.previousSteps must be an object");
  } else if (isPlainObject(operations.previousSteps)) {
    allowOnly(errors, operations.previousSteps,
      ["queryFields", "itemsPath", "itemDataPath", "serialPath",
        "missingResponseCodes", "missingMessagePatterns",
        "retryableMessagePatterns", "alreadyExistsMessagePatterns",
        "recipeOutcomePolicy", "recipeResolvers", "optionValueBuilders"],
      "operations.previousSteps");
    addRequiredString(errors, endpoints?.detectionData, "endpoints.detectionData");
    const query = operations.previousSteps.queryFields;
    if (!isPlainObject(query)) errors.push("operations.previousSteps.queryFields must be an object");
    else {
      allowOnly(errors, query, ["templateId", "warehouseId", "sku", "serial"], "operations.previousSteps.queryFields");
      for (const key of ["templateId", "warehouseId", "sku", "serial"]) {
        addRequiredString(errors, query[key], `operations.previousSteps.queryFields.${key}`);
      }
    }
    for (const key of ["itemsPath", "itemDataPath", "serialPath"]) {
      addRequiredString(errors, operations.previousSteps[key], `operations.previousSteps.${key}`);
    }
    const lookupPolicyKeys = ["missingResponseCodes", "missingMessagePatterns"];
    if (lookupPolicyKeys.some((key) => Object.prototype.hasOwnProperty.call(operations.previousSteps, key))) {
      validatePreviousStepLookupResponseOperation(operations.previousSteps, errors, true);
    }
    const recipePolicyKeys = ["retryableMessagePatterns", "alreadyExistsMessagePatterns"];
    if (recipePolicyKeys.some((key) => Object.prototype.hasOwnProperty.call(operations.previousSteps, key))) {
      validatePreviousStepRecipeResponseOperation(operations.previousSteps, errors, true);
    }
    validatePreviousStepRecipeOutcomePolicy(operations.previousSteps, errors, false);
    const dynamicRecipeKeys = ["recipeResolvers", "optionValueBuilders"];
    if (dynamicRecipeKeys.some((key) => Object.prototype.hasOwnProperty.call(operations.previousSteps, key))) {
      validateDynamicPreviousStepOperation(operations.previousSteps, errors, true);
    }
  }
  if (operations.duplicateCheck !== undefined && !isPlainObject(operations.duplicateCheck)) {
    errors.push("operations.duplicateCheck must be an object");
  } else if (isPlainObject(operations.duplicateCheck)) {
    allowOnly(errors, operations.duplicateCheck,
      ["queryFields", "itemsPath", "dateFields", "dateTransforms", "epochUnits", "dateFormats", "timeZone",
        "epochDigitLengths", "numericFractionPolicy", "textParseConsumption",
        "plausibilityScope", "timeZoneSource", "rootValueEnabled",
        "numericEpochPrecision"],
      "operations.duplicateCheck");
    addRequiredString(errors, endpoints?.snRepetition, "endpoints.snRepetition");
    const query = operations.duplicateCheck.queryFields;
    if (!isPlainObject(query)) errors.push("operations.duplicateCheck.queryFields must be an object");
    else {
      allowOnly(errors, query, ["templateId", "serial"], "operations.duplicateCheck.queryFields");
      for (const key of ["templateId", "serial"]) {
        addRequiredString(errors, query[key], `operations.duplicateCheck.queryFields.${key}`);
      }
    }
    addRequiredString(errors, operations.duplicateCheck.itemsPath, "operations.duplicateCheck.itemsPath");
    addStringArray(errors, operations.duplicateCheck.dateFields, "operations.duplicateCheck.dateFields");
    // A deployed v1 adapter may predate explicit date parsing. Keep it usable for Panel login and
    // migration, but reject partial new configuration here. Publishing a profile that actually
    // enables duplicate checking invokes validateDuplicateDateParsingConfig with required=true.
    const parsingKeys = ["dateTransforms", "epochUnits", "dateFormats", "timeZone"];
    if (parsingKeys.some((key) => Object.prototype.hasOwnProperty.call(operations.duplicateCheck, key))) {
      validateDuplicateDateParsingOperation(operations.duplicateCheck, errors, true);
    }
    validateDuplicateDateCompatibilityPolicy(operations.duplicateCheck, errors);
  }
  if (!isPlainObject(operations.templateDetail)) {
    errors.push("operations.templateDetail must be an object");
  } else {
    allowOnly(errors, operations.templateDetail,
      ["idParam", "alternateEntryResolvers", "existingQuantityPolicy"],
      "operations.templateDetail");
    addRequiredString(errors, operations.templateDetail.idParam, "operations.templateDetail.idParam");
    validateExistingMaterialQuantityPolicy(operations.templateDetail, errors);
    if (Object.prototype.hasOwnProperty.call(operations.templateDetail,
      "alternateEntryResolvers")) {
      validateAlternateEntryOverrideResolvers(operations.templateDetail, errors, true);
    }
  }
  if (Object.prototype.hasOwnProperty.call(operations, "recovery")) {
    validateControlledRecoveryOperation(operations.recovery, errors, true);
  }
}

function validateExistingMaterialQuantityPolicy(templateDetail, errors) {
  if (!Object.prototype.hasOwnProperty.call(templateDetail, "existingQuantityPolicy")) return;
  if (!["strict_live_match", "profile_authoritative"]
    .includes(templateDetail.existingQuantityPolicy)) {
    errors.push("operations.templateDetail.existingQuantityPolicy must be one of: strict_live_match, profile_authoritative");
  }
}

function validateControlledRecoveryOperation(operation, errors, required) {
  if (!isPlainObject(operation)) {
    if (required) errors.push("operations.recovery must be configured");
    return;
  }
  allowOnly(errors, operation, [
    "version", "issuanceMode", "evidenceAlgorithm", "keyId", "publicKeySpkiHex",
    "maxEvidenceAgeSeconds", "reconciliationContractSha256", "enabledOperations"
  ], "operations.recovery");
  if (operation.version !== CONTROLLED_RECOVERY_VERSION) {
    errors.push(`operations.recovery.version must be ${CONTROLLED_RECOVERY_VERSION}`);
  }
  if (operation.issuanceMode !== "panel_signed_exact_reconciliation") {
    errors.push("operations.recovery.issuanceMode must be panel_signed_exact_reconciliation");
  }
  if (operation.evidenceAlgorithm !== "RS256") {
    errors.push("operations.recovery.evidenceAlgorithm must be RS256");
  }
  if (typeof operation.keyId !== "string" || operation.keyId.length === 0
      || operation.keyId.length > 128 || !/^[A-Za-z0-9_.-]+$/u.test(operation.keyId)) {
    errors.push("operations.recovery.keyId must be a bounded safe identifier");
  }
  const publicKey = operation.publicKeySpkiHex;
  // rsaEncryption OID inside a bounded DER SubjectPublicKeyInfo. Android performs the authoritative
  // KeyFactory check before accepting the capability; this synchronous Worker check rejects random
  // hex and non-RSA placeholders before a private catalog can be published.
  if (typeof publicKey !== "string" || publicKey.length < 512 || publicKey.length > 8192
      || (publicKey.length % 2) !== 0 || !/^[0-9a-f]+$/u.test(publicKey)
      || !publicKey.slice(0, 256).includes("06092a864886f70d010101")) {
    errors.push("operations.recovery.publicKeySpkiHex must be a bounded lowercase RSA SPKI DER value");
  }
  if (!Number.isInteger(operation.maxEvidenceAgeSeconds)
      || operation.maxEvidenceAgeSeconds <= 0
      || operation.maxEvidenceAgeSeconds > 3600) {
    errors.push("operations.recovery.maxEvidenceAgeSeconds must be an integer from 1 to 3600");
  }
  if (typeof operation.reconciliationContractSha256 !== "string"
      || !/^[0-9a-f]{64}$/u.test(operation.reconciliationContractSha256)) {
    errors.push("operations.recovery.reconciliationContractSha256 must be lowercase SHA-256");
  }
  if (!Array.isArray(operation.enabledOperations) || operation.enabledOperations.length === 0) {
    errors.push("operations.recovery.enabledOperations must be a non-empty array");
  } else {
    const seen = new Set();
    operation.enabledOperations.forEach((value, index) => {
      if (!CONTROLLED_RECOVERY_OPERATIONS.includes(value)) {
        errors.push(`operations.recovery.enabledOperations[${index}] must be one of: ${CONTROLLED_RECOVERY_OPERATIONS.join(", ")}`);
      } else if (seen.has(value)) {
        errors.push(`operations.recovery.enabledOperations[${index}] must not be duplicated`);
      }
      seen.add(value);
    });
  }
}

/**
 * Strict release-only capability gate. Ordinary Panel migration may omit recovery so the installed
 * App and existing catalog remain usable, but an official release must call this with every remote
 * side-effect kind it actually ships. A capability declaration is not proof of backend semantics;
 * its reconciliationContractSha256 must separately match the private replay attestation.
 */
export function validateControlledRecoveryConfig(
  adapter,
  { required = true, requiredOperations = CONTROLLED_RECOVERY_OPERATIONS } = {}
) {
  const errors = [];
  const operation = adapter?.operations?.recovery;
  validateControlledRecoveryOperation(operation, errors, required);
  if (!isPlainObject(operation)) return errors;
  const enabled = new Set(Array.isArray(operation.enabledOperations)
    ? operation.enabledOperations : []);
  for (const requiredOperation of requiredOperations || []) {
    if (!CONTROLLED_RECOVERY_OPERATIONS.includes(requiredOperation)) {
      errors.push(`required recovery operation is unknown: ${String(requiredOperation)}`);
    } else if (!enabled.has(requiredOperation)) {
      errors.push(`operations.recovery.enabledOperations must include ${requiredOperation}`);
    }
  }
  return errors;
}

function validatePreviousStepRecipeResponseOperation(operation, errors, required) {
  if (!isPlainObject(operation)) {
    if (required) errors.push("operations.previousSteps must be configured");
    return;
  }
  addStringArray(errors, operation.retryableMessagePatterns,
    "operations.previousSteps.retryableMessagePatterns", { allowEmpty: true });
  addStringArray(errors, operation.alreadyExistsMessagePatterns,
    "operations.previousSteps.alreadyExistsMessagePatterns", { allowEmpty: true });
}

function validatePreviousStepLookupResponseOperation(operation, errors, required) {
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

function recipeId(value) {
  return typeof value === "string" && value.trim() !== ""
    && value.length <= RECIPE_LIMITS.idLength
    && /^[A-Za-z][A-Za-z0-9_.-]*$/.test(value)
    && !["__proto__", "prototype", "constructor"].includes(value);
}

function addRecipeId(errors, value, path) {
  if (!recipeId(value)) {
    errors.push(`${path} must match [A-Za-z][A-Za-z0-9_.-]* and contain at most ${RECIPE_LIMITS.idLength} characters`);
  }
}

function addBoundedAttributeArray(errors, value, path) {
  if (!Array.isArray(value)) {
    errors.push(`${path} must be an array`);
    return;
  }
  if (value.length > RECIPE_SEARCH_TEXT_ATTRIBUTES.length) {
    errors.push(`${path} must contain at most ${RECIPE_SEARCH_TEXT_ATTRIBUTES.length} items`);
  }
  const seen = new Set();
  value.forEach((attribute, index) => {
    if (!RECIPE_SEARCH_TEXT_ATTRIBUTES.includes(attribute)) {
      errors.push(`${path}[${index}] must be one of: ${RECIPE_SEARCH_TEXT_ATTRIBUTES.join(", ")}`);
    } else if (seen.has(attribute)) {
      errors.push(`${path}[${index}] must not be duplicated`);
    }
    seen.add(attribute);
  });
}

function validateRecipePredicate(predicate, path, errors, knownKinds) {
  if (!isPlainObject(predicate)) {
    errors.push(`${path} must be an object`);
    return;
  }
  allowOnly(errors, predicate,
    ["attribute", "caseSensitive", "equalsAny", "containsAny", "present"], path);
  if (!RECIPE_SELECTOR_ATTRIBUTES.includes(predicate.attribute)) {
    errors.push(`${path}.attribute must be one of: ${RECIPE_SELECTOR_ATTRIBUTES.join(", ")}`);
  }
  if (typeof predicate.caseSensitive !== "boolean") {
    errors.push(`${path}.caseSensitive must be a boolean`);
  }
  const operators = ["equalsAny", "containsAny", "present"]
    .filter((key) => Object.prototype.hasOwnProperty.call(predicate, key));
  if (operators.length !== 1) {
    errors.push(`${path} must contain exactly one of: equalsAny, containsAny, present`);
    return;
  }
  const operator = operators[0];
  if (operator === "present") {
    if (typeof predicate.present !== "boolean") errors.push(`${path}.present must be a boolean`);
    return;
  }
  const values = predicate[operator];
  if (!Array.isArray(values) || values.length === 0) {
    errors.push(`${path}.${operator} must be a non-empty array`);
    return;
  }
  if (values.length > RECIPE_LIMITS.arrayItems) {
    errors.push(`${path}.${operator} must contain at most ${RECIPE_LIMITS.arrayItems} items`);
  }
  values.forEach((item, index) => {
    if (operator === "containsAny") {
      if (typeof item !== "string" || item.length === 0
          || item.length > RECIPE_LIMITS.stringLength) {
        errors.push(`${path}.${operator}[${index}] must be a non-empty string of at most ${RECIPE_LIMITS.stringLength} characters`);
      }
      return;
    }
    const scalar = item === null || typeof item === "string" || typeof item === "boolean"
      || (typeof item === "number" && Number.isFinite(item));
    if (!scalar || (typeof item === "string" && item.length > RECIPE_LIMITS.stringLength)) {
      errors.push(`${path}.${operator}[${index}] must be a bounded JSON scalar`);
    }
  });
  if (predicate.attribute === "kind" && operator === "containsAny") {
    errors.push(`${path}.containsAny is not supported for attribute=kind`);
  }
  if (predicate.attribute === "kind" && operator === "equalsAny" && knownKinds instanceof Set) {
    values.forEach((item, index) => {
      if (typeof item !== "string" || !knownKinds.has(item)) {
        errors.push(`${path}.equalsAny[${index}] must reference kindSelectors.kind`);
      }
    });
  }
}

function validateRecipeSelector(selector, path, errors, knownKinds = null) {
  if (!isPlainObject(selector)) {
    errors.push(`${path} must be an object`);
    return;
  }
  allowOnly(errors, selector, ["allOf", "anyOf", "noneOf"], path);
  let count = 0;
  for (const key of ["allOf", "anyOf", "noneOf"]) {
    if (!Object.prototype.hasOwnProperty.call(selector, key)) continue;
    const predicates = selector[key];
    if (!Array.isArray(predicates) || predicates.length === 0) {
      errors.push(`${path}.${key} must be a non-empty array`);
      continue;
    }
    if (predicates.length > RECIPE_LIMITS.selectorPredicates) {
      errors.push(`${path}.${key} must contain at most ${RECIPE_LIMITS.selectorPredicates} predicates`);
    }
    count += predicates.length;
    predicates.slice(0, RECIPE_LIMITS.selectorPredicates).forEach((predicate, index) =>
      validateRecipePredicate(predicate, `${path}.${key}[${index}]`, errors, knownKinds));
  }
  if (count === 0) errors.push(`${path} must contain at least one predicate`);
  if (count > RECIPE_LIMITS.selectorTotalPredicates) {
    errors.push(`${path} must contain at most ${RECIPE_LIMITS.selectorTotalPredicates} predicates in total`);
  }
}

function selectorReferencesAttribute(selector, attribute) {
  if (!isPlainObject(selector)) return false;
  return ["allOf", "anyOf", "noneOf"].some((key) =>
    Array.isArray(selector[key])
      && selector[key].some((predicate) => predicate?.attribute === attribute));
}

function validateRecipePath(value, path, errors, allowedRoots = Object.keys(RECIPE_PATH_KEYS)) {
  if (typeof value !== "string" || value.length === 0 || value.length > 512) {
    errors.push(`${path} must be a non-empty path of at most 512 characters`);
    return;
  }
  const segments = value.split(".");
  if (!allowedRoots.includes(segments[0]) || segments.length < 2 || segments.length > 16
      || segments.some((segment) => !/^[A-Za-z][A-Za-z0-9_-]*$/.test(segment)
        || ["__proto__", "prototype", "constructor"].includes(segment))) {
    errors.push(`${path} must be a bounded mapped path rooted at template, field, option, input or identity`);
  } else if (!RECIPE_PATH_KEYS[segments[0]].includes(segments[1])) {
    errors.push(`${path} must reference a supported ${segments[0]} attribute`);
  }
}

function validateRecipeLiteral(value, path, errors, depth = 0, state = { items: 0 }) {
  if (depth > RECIPE_LIMITS.literalDepth) {
    errors.push(`${path} exceeds maximum literal depth ${RECIPE_LIMITS.literalDepth}`);
    return;
  }
  state.items += 1;
  if (state.items > RECIPE_LIMITS.literalItems) {
    if (state.items === RECIPE_LIMITS.literalItems + 1) {
      errors.push(`${path} exceeds maximum literal size ${RECIPE_LIMITS.literalItems}`);
    }
    return;
  }
  if (value === null || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) errors.push(`${path} must contain only finite JSON numbers`);
    return;
  }
  if (typeof value === "string") {
    if (value.length > RECIPE_LIMITS.stringLength) {
      errors.push(`${path} string must contain at most ${RECIPE_LIMITS.stringLength} characters`);
    }
    return;
  }
  if (Array.isArray(value)) {
    if (value.length > RECIPE_LIMITS.literalItems) {
      errors.push(`${path} array must contain at most ${RECIPE_LIMITS.literalItems} items`);
    }
    value.slice(0, RECIPE_LIMITS.literalItems).forEach((item, index) =>
      validateRecipeLiteral(item, `${path}[${index}]`, errors, depth + 1, state));
    return;
  }
  if (isPlainObject(value)) {
    const entries = Object.entries(value);
    if (entries.length > RECIPE_LIMITS.literalItems) {
      errors.push(`${path} object must contain at most ${RECIPE_LIMITS.literalItems} members`);
    }
    entries.slice(0, RECIPE_LIMITS.literalItems).forEach(([key, item]) => {
      if (!recipeId(key) || ["__proto__", "prototype", "constructor"].includes(key)) {
        errors.push(`${path}.${key} is not a safe bounded member name`);
      }
      validateRecipeLiteral(item, `${path}.${key}`, errors, depth + 1, state);
    });
    return;
  }
  errors.push(`${path} must be JSON data`);
}

function validateRecipeBuilder(builder, path, errors, depth = 0,
                               allowedRoots = Object.keys(RECIPE_PATH_KEYS),
                               budget = { count: 0, reported: false }) {
  if (!isPlainObject(builder)) {
    errors.push(`${path} must be a builder object`);
    return;
  }
  budget.count += 1;
  if (budget.count > RECIPE_LIMITS.builderNodes) {
    if (!budget.reported) {
      errors.push(`${path} exceeds maximum builder node count ${RECIPE_LIMITS.builderNodes}`);
      budget.reported = true;
    }
    return;
  }
  if (depth > RECIPE_LIMITS.builderDepth) {
    errors.push(`${path} exceeds maximum builder depth ${RECIPE_LIMITS.builderDepth}`);
    return;
  }
  if (!RECIPE_BUILDER_TYPES.includes(builder.type)) {
    errors.push(`${path}.type must be one of: ${RECIPE_BUILDER_TYPES.join(", ")}`);
    return;
  }
  if (builder.type === "literal") {
    allowOnly(errors, builder, ["type", "value"], path);
    if (!Object.prototype.hasOwnProperty.call(builder, "value")) errors.push(`${path}.value is required`);
    else validateRecipeLiteral(builder.value, `${path}.value`, errors);
    return;
  }
  if (builder.type === "present") {
    allowOnly(errors, builder, ["type", "path", "fallbackIfMissing"], path);
    validateRecipePath(builder.path, `${path}.path`, errors, allowedRoots);
    if (!Object.prototype.hasOwnProperty.call(builder, "fallbackIfMissing")) {
      errors.push(`${path}.fallbackIfMissing is required`);
    } else {
      validateRecipeLiteral(builder.fallbackIfMissing, `${path}.fallbackIfMissing`, errors);
    }
    return;
  }
  if (builder.type === "firstNonEmpty") {
    allowOnly(errors, builder, ["type", "paths"], path);
    if (!Array.isArray(builder.paths) || builder.paths.length === 0) {
      errors.push(`${path}.paths must be a non-empty array`);
    } else {
      if (builder.paths.length > RECIPE_LIMITS.arrayItems) {
        errors.push(`${path}.paths must contain at most ${RECIPE_LIMITS.arrayItems} items`);
      }
      const seen = new Set();
      builder.paths.slice(0, RECIPE_LIMITS.arrayItems).forEach((item, index) => {
        validateRecipePath(item, `${path}.paths[${index}]`, errors, allowedRoots);
        if (seen.has(item)) errors.push(`${path}.paths[${index}] must not be duplicated`);
        seen.add(item);
      });
    }
    return;
  }
  if (builder.type === "integer") {
    allowOnly(errors, builder, ["type", "path", "default"], path);
    validateRecipePath(builder.path, `${path}.path`, errors, allowedRoots);
    if (!Number.isSafeInteger(builder.default)) errors.push(`${path}.default must be a safe integer`);
    return;
  }
  allowOnly(errors, builder, ["type", "members"], path);
  if (!isPlainObject(builder.members) || Object.keys(builder.members).length === 0) {
    errors.push(`${path}.members must be a non-empty object`);
    return;
  }
  const entries = Object.entries(builder.members);
  if (entries.length > RECIPE_LIMITS.objectMembers) {
    errors.push(`${path}.members must contain at most ${RECIPE_LIMITS.objectMembers} members`);
  }
  entries.slice(0, RECIPE_LIMITS.objectMembers).forEach(([key, member]) => {
    if (!recipeId(key) || key.includes(".")
        || ["__proto__", "prototype", "constructor"].includes(key)) {
      errors.push(`${path}.members.${key} is not a safe bounded member name`);
    }
    validateRecipeBuilder(member, `${path}.members.${key}`, errors, depth + 1,
      allowedRoots, budget);
  });
}

function validateOptionSelector(value, path, errors) {
  if (!isPlainObject(value)) {
    errors.push(`${path} must be an object`);
    return;
  }
  allowOnly(errors, value, ["selector", "cardinality", "literalOverride"], path);
  validateRecipeSelector(value.selector, `${path}.selector`, errors);
  if (!RECIPE_CARDINALITIES.includes(value.cardinality)) {
    errors.push(`${path}.cardinality must be one of: ${RECIPE_CARDINALITIES.join(", ")}`);
  }
  if (Object.prototype.hasOwnProperty.call(value, "literalOverride")) {
    validateRecipeLiteral(value.literalOverride, `${path}.literalOverride`, errors);
  }
}

function validateRecipeAction(action, path, errors, builderIds) {
  if (!isPlainObject(action)) {
    errors.push(`${path} must be an object`);
    return;
  }
  if (!RECIPE_ACTION_TYPES.includes(action.type)) {
    errors.push(`${path}.type must be one of: ${RECIPE_ACTION_TYPES.join(", ")}`);
    return;
  }
  if (action.type === "serial") {
    allowOnly(errors, action, ["type"], path);
    return;
  }
  if (action.type === "photo") {
    allowOnly(errors, action, ["type", "source", "joinWith"], path);
    addRecipeId(errors, action.source, `${path}.source`);
    if (typeof action.joinWith !== "string"
        || action.joinWith.length > RECIPE_LIMITS.stringLength) {
      errors.push(`${path}.joinWith must be a string of at most ${RECIPE_LIMITS.stringLength} characters`);
    }
    return;
  }
  if (action.type === "omit") {
    allowOnly(errors, action, ["type", "allowRequired"], path);
    if (typeof action.allowRequired !== "boolean") errors.push(`${path}.allowRequired must be a boolean`);
    return;
  }
  allowOnly(errors, action,
    ["type", "optionSelectors", "valueBuilder", "onNoMatch"], path);
  if (!Array.isArray(action.optionSelectors) || action.optionSelectors.length === 0) {
    errors.push(`${path}.optionSelectors must be a non-empty array`);
  } else {
    if (action.optionSelectors.length > RECIPE_LIMITS.arrayItems) {
      errors.push(`${path}.optionSelectors must contain at most ${RECIPE_LIMITS.arrayItems} items`);
    }
    action.optionSelectors.slice(0, RECIPE_LIMITS.arrayItems).forEach((selector, index) =>
      validateOptionSelector(selector, `${path}.optionSelectors[${index}]`, errors));
  }
  addRecipeId(errors, action.valueBuilder, `${path}.valueBuilder`);
  if (recipeId(action.valueBuilder) && !builderIds.has(action.valueBuilder)) {
    errors.push(`${path}.valueBuilder must reference operations.previousSteps.optionValueBuilders`);
  }
  if (!["reject", "use_value_builder"].includes(action.onNoMatch)) {
    errors.push(`${path}.onNoMatch must be one of: reject, use_value_builder`);
  }
}

function validateRecipeResolver(resolver, path, errors, builderIds, builderBudget) {
  if (!isPlainObject(resolver)) {
    errors.push(`${path} must be an object`);
    return;
  }
  allowOnly(errors, resolver,
    ["version", "identity", "searchTextAttributes", "optionSearchTextAttributes", "kindSelectors", "rules"], path);
  if (resolver.version !== 1) errors.push(`${path}.version must be 1`);
  if (!isPlainObject(resolver.identity)) {
    errors.push(`${path}.identity must be an object`);
  } else {
    allowOnly(errors, resolver.identity,
      ["templateId", "expectedStep", "warehouseId", "sku"], `${path}.identity`);
    for (const key of ["templateId", "expectedStep", "warehouseId", "sku"]) {
      if (!Object.prototype.hasOwnProperty.call(resolver.identity, key)) {
        errors.push(`${path}.identity.${key} is required`);
      } else {
        validateRecipeBuilder(resolver.identity[key], `${path}.identity.${key}`, errors, 0,
          ["template", "input"], builderBudget);
      }
    }
  }
  addBoundedAttributeArray(errors, resolver.searchTextAttributes,
    `${path}.searchTextAttributes`);
  addBoundedAttributeArray(errors, resolver.optionSearchTextAttributes,
    `${path}.optionSearchTextAttributes`);
  const kinds = new Set();
  if (!Array.isArray(resolver.kindSelectors)) {
    errors.push(`${path}.kindSelectors must be an array`);
  } else {
    if (resolver.kindSelectors.length === 0) {
      errors.push(`${path}.kindSelectors must be non-empty`);
    }
    if (resolver.kindSelectors.length > RECIPE_LIMITS.rules) {
      errors.push(`${path}.kindSelectors must contain at most ${RECIPE_LIMITS.rules} items`);
    }
    resolver.kindSelectors.slice(0, RECIPE_LIMITS.rules).forEach((item, index) => {
      const itemPath = `${path}.kindSelectors[${index}]`;
      if (!isPlainObject(item)) {
        errors.push(`${itemPath} must be an object`);
        return;
      }
      allowOnly(errors, item, ["kind", "selector"], itemPath);
      addRecipeId(errors, item.kind, `${itemPath}.kind`);
      if (recipeId(item.kind) && kinds.has(item.kind)) errors.push(`${itemPath}.kind must be unique`);
      kinds.add(item.kind);
      validateRecipeSelector(item.selector, `${itemPath}.selector`, errors);
      if (selectorReferencesAttribute(item.selector, "kind")) {
        errors.push(`${itemPath}.selector must not derive kind from kind`);
      }
    });
  }
  if (!Array.isArray(resolver.rules) || resolver.rules.length === 0) {
    errors.push(`${path}.rules must be a non-empty array`);
  } else {
    if (resolver.rules.length > RECIPE_LIMITS.rules) {
      errors.push(`${path}.rules must contain at most ${RECIPE_LIMITS.rules} items`);
    }
    resolver.rules.slice(0, RECIPE_LIMITS.rules).forEach((rule, index) => {
      const rulePath = `${path}.rules[${index}]`;
      if (!isPlainObject(rule)) {
        errors.push(`${rulePath} must be an object`);
        return;
      }
      allowOnly(errors, rule, ["selector", "cardinality", "action"], rulePath);
      validateRecipeSelector(rule.selector, `${rulePath}.selector`, errors, kinds);
      if (!RECIPE_CARDINALITIES.includes(rule.cardinality)) {
        errors.push(`${rulePath}.cardinality must be one of: ${RECIPE_CARDINALITIES.join(", ")}`);
      }
      validateRecipeAction(rule.action, `${rulePath}.action`, errors, builderIds);
    });
    const serialActions = resolver.rules.filter((rule) => rule?.action?.type === "serial").length;
    if (serialActions !== 1) errors.push(`${path}.rules must contain exactly one serial action`);
  }
}

function validateDynamicPreviousStepOperation(operation, errors, required) {
  if (!isPlainObject(operation)) {
    if (required) errors.push("operations.previousSteps must be configured");
    return;
  }
  const builders = operation.optionValueBuilders;
  const builderIds = new Set(isPlainObject(builders) ? Object.keys(builders) : []);
  const namedBuilderBudget = { count: 0, reported: false };
  if (!isPlainObject(builders)) {
    errors.push("operations.previousSteps.optionValueBuilders must be an object");
  } else {
    const entries = Object.entries(builders);
    if (entries.length > RECIPE_LIMITS.mapEntries) {
      errors.push(`operations.previousSteps.optionValueBuilders must contain at most ${RECIPE_LIMITS.mapEntries} entries`);
    }
    entries.slice(0, RECIPE_LIMITS.mapEntries).forEach(([id, builder]) => {
      addRecipeId(errors, id, `operations.previousSteps.optionValueBuilders.${id}`);
      validateRecipeBuilder(builder, `operations.previousSteps.optionValueBuilders.${id}`, errors,
        0, Object.keys(RECIPE_PATH_KEYS), namedBuilderBudget);
    });
  }
  const resolvers = operation.recipeResolvers;
  if (!isPlainObject(resolvers)) {
    errors.push("operations.previousSteps.recipeResolvers must be an object");
  } else {
    const entries = Object.entries(resolvers);
    if (entries.length > RECIPE_LIMITS.mapEntries) {
      errors.push(`operations.previousSteps.recipeResolvers must contain at most ${RECIPE_LIMITS.mapEntries} entries`);
    }
    entries.slice(0, RECIPE_LIMITS.mapEntries).forEach(([id, resolver]) => {
      addRecipeId(errors, id, `operations.previousSteps.recipeResolvers.${id}`);
      validateRecipeResolver(resolver,
        `operations.previousSteps.recipeResolvers.${id}`, errors, builderIds,
        { count: namedBuilderBudget.count, reported: namedBuilderBudget.reported });
    });
  }
}

/** Strict schema check used only when a profile selects dynamic template-detail recipes. */
export function validateDynamicPreviousStepConfig(adapter) {
  const errors = [];
  validateDynamicPreviousStepOperation(adapter?.operations?.previousSteps, errors, true);
  return errors;
}

/** Cross-check profile resolver and photo-source aliases after both documents validate. */
export function validateDynamicPreviousStepReferences(adapter, recipes) {
  const errors = [];
  const resolvers = adapter?.operations?.previousSteps?.recipeResolvers;
  for (const recipe of Array.isArray(recipes) ? recipes : []) {
    const path = recipe?.path || "workflow.previousSteps.templates[]";
    const resolverId = recipe?.template?.resolverId;
    const resolver = isPlainObject(resolvers) ? resolvers[resolverId] : undefined;
    if (!isPlainObject(resolver)) {
      errors.push(`${path}.resolverId must reference operations.previousSteps.recipeResolvers`);
      continue;
    }
    const aliases = new Set(isPlainObject(recipe.template.sources)
      ? Object.keys(recipe.template.sources) : []);
    const usedAliases = new Set();
    (Array.isArray(resolver.rules) ? resolver.rules : []).forEach((rule, index) => {
      if (rule?.action?.type === "photo" && typeof rule.action.source === "string") {
        usedAliases.add(rule.action.source);
        if (!aliases.has(rule.action.source)) {
          errors.push(`${path}.sources must define alias ${JSON.stringify(rule.action.source)} used by resolver rule ${index}`);
        }
      }
    });
    for (const alias of aliases) {
      if (!usedAliases.has(alias)) {
        errors.push(`${path}.sources alias ${JSON.stringify(alias)} is not used by its resolver`);
      }
    }
  }
  return errors;
}

function validateAlternateEntryOverrideResolver(resolver, path, errors) {
  if (!isPlainObject(resolver)) {
    errors.push(`${path} must be an object`);
    return;
  }
  allowOnly(errors, resolver, [
    "version", "searchTextAttributes", "optionSearchTextAttributes",
    "fieldSelector", "optionSelector", "valueBuilder"
  ], path);
  if (resolver.version !== 1) errors.push(`${path}.version must be 1`);
  addBoundedAttributeArray(errors, resolver.searchTextAttributes,
    `${path}.searchTextAttributes`);
  addBoundedAttributeArray(errors, resolver.optionSearchTextAttributes,
    `${path}.optionSearchTextAttributes`);
  validateRecipeSelector(resolver.fieldSelector, `${path}.fieldSelector`, errors);
  validateRecipeSelector(resolver.optionSelector, `${path}.optionSelector`, errors);
  if (selectorReferencesAttribute(resolver.fieldSelector, "kind")) {
    errors.push(`${path}.fieldSelector must not reference kind`);
  }
  if (selectorReferencesAttribute(resolver.optionSelector, "kind")) {
    errors.push(`${path}.optionSelector must not reference kind`);
  }
  validateRecipeBuilder(resolver.valueBuilder, `${path}.valueBuilder`, errors, 0,
    ["template", "field", "option", "identity"], { count: 0, reported: false });
}

function validateAlternateEntryOverrideResolvers(templateDetail, errors, required) {
  if (!isPlainObject(templateDetail)) {
    if (required) errors.push("operations.templateDetail must be configured");
    return;
  }
  const resolvers = templateDetail.alternateEntryResolvers;
  if (!isPlainObject(resolvers)) {
    if (required) {
      errors.push("operations.templateDetail.alternateEntryResolvers must be an object");
    }
    return;
  }
  const entries = Object.entries(resolvers);
  if (entries.length > RECIPE_LIMITS.mapEntries) {
    errors.push(`operations.templateDetail.alternateEntryResolvers must contain at most ${RECIPE_LIMITS.mapEntries} entries`);
  }
  entries.slice(0, RECIPE_LIMITS.mapEntries).forEach(([id, resolver]) => {
    addRecipeId(errors, id, `operations.templateDetail.alternateEntryResolvers.${id}`);
    validateAlternateEntryOverrideResolver(resolver,
      `operations.templateDetail.alternateEntryResolvers.${id}`, errors);
  });
}

/** Strict adapter capability check used when an entry declares live override providers. */
export function validateAlternateEntryOverrideConfig(adapter) {
  const errors = [];
  addRequiredString(errors, adapter?.endpoints?.templateDetail,
    "endpoints.templateDetail");
  addRequiredString(errors, adapter?.operations?.templateDetail?.idParam,
    "operations.templateDetail.idParam");
  validateAlternateEntryOverrideResolvers(adapter?.operations?.templateDetail, errors, true);
  return errors;
}

/** Cross-check every profile provider reference against the adapter resolver map. */
export function validateAlternateEntryOverrideReferences(adapter, providers) {
  const errors = [];
  const resolvers = adapter?.operations?.templateDetail?.alternateEntryResolvers;
  for (const item of Array.isArray(providers) ? providers : []) {
    const path = item?.path || "workflow.alternateEntries.entries[].dynamicOverrideProviders[]";
    const resolverId = item?.provider?.resolverId;
    if (typeof resolverId !== "string" || !isPlainObject(resolvers?.[resolverId])) {
      errors.push(`${path}.resolverId must reference operations.templateDetail.alternateEntryResolvers`);
    }
  }
  return errors;
}

function validateDuplicateDateParsingOperation(operation, errors, required) {
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

function validateDuplicateDateCompatibilityPolicy(operation, errors) {
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

function validatePrinting(adapter, errors) {
  const printing = adapter.printing;
  if (printing === undefined) return;
  if (!isPlainObject(printing)) {
    errors.push("printing must be an object");
    return;
  }
  allowOnly(errors, printing,
    ["enabled", "allowJobsArrayWhenCodeMissing", "online", "jobsPath", "query", "fields", "values", "retryIdField"], "printing");
  if (typeof printing.enabled !== "boolean") errors.push("printing.enabled must be a boolean");
  if (printing.allowJobsArrayWhenCodeMissing !== undefined
      && typeof printing.allowJobsArrayWhenCodeMissing !== "boolean") {
    errors.push("printing.allowJobsArrayWhenCodeMissing must be a boolean");
  }
  if (printing.enabled !== true) {
    if (isPlainObject(printing.online)) {
      allowOnly(errors, printing.online, ["statusPath", "values"], "printing.online");
    }
    if (isPlainObject(printing.query)) {
      allowOnly(errors, printing.query, ["serialParam", "pageParam", "pageStart"], "printing.query");
    }
    if (isPlainObject(printing.fields)) {
      allowOnly(errors, printing.fields, ["id", "serial", "type", "status"], "printing.fields");
    }
    if (isPlainObject(printing.values)) {
      allowOnly(errors, printing.values, ["acceptedTypes", "printed", "failed", "ongoing"], "printing.values");
    }
    return;
  }
  if (isPlainObject(adapter.endpoints)) {
    for (const key of ["printerState", "messageList", "labelRetry"]) {
      addRequiredString(errors, adapter.endpoints[key], `endpoints.${key}`);
    }
  }
  if (!isPlainObject(printing.online)) {
    errors.push("printing.online must be an object");
  } else {
    allowOnly(errors, printing.online, ["statusPath", "values"], "printing.online");
    addRequiredString(errors, printing.online.statusPath, "printing.online.statusPath");
    addBusinessValueArray(errors, printing.online.values, "printing.online.values");
  }
  addRequiredString(errors, printing.jobsPath, "printing.jobsPath");
  if (!isPlainObject(printing.query)) {
    errors.push("printing.query must be an object");
  } else {
    allowOnly(errors, printing.query, ["serialParam", "pageParam", "pageStart"], "printing.query");
    addRequiredString(errors, printing.query.serialParam, "printing.query.serialParam");
    addRequiredString(errors, printing.query.pageParam, "printing.query.pageParam");
    if (!Number.isInteger(printing.query.pageStart) || printing.query.pageStart < 0) {
      errors.push("printing.query.pageStart must be a non-negative integer");
    }
  }
  if (!isPlainObject(printing.fields)) {
    errors.push("printing.fields must be an object");
  } else {
    allowOnly(errors, printing.fields, ["id", "serial", "type", "status"], "printing.fields");
    for (const key of ["id", "serial", "type", "status"]) {
      addRequiredString(errors, printing.fields[key], `printing.fields.${key}`);
    }
  }
  if (!isPlainObject(printing.values)) {
    errors.push("printing.values must be an object");
  } else {
    allowOnly(errors, printing.values, ["acceptedTypes", "printed", "failed", "ongoing"], "printing.values");
    for (const key of ["acceptedTypes", "printed", "failed", "ongoing"]) {
      addBusinessValueArray(errors, printing.values[key], `printing.values.${key}`);
    }
    const statusOwners = new Map();
    for (const key of ["printed", "failed", "ongoing"]) {
      for (const value of Array.isArray(printing.values[key]) ? printing.values[key] : []) {
        const normalized = String(value).trim();
        if (!normalized) continue;
        if (statusOwners.has(normalized) && statusOwners.get(normalized) !== key) {
          errors.push(`printing.values status ${JSON.stringify(normalized)} appears in both ${statusOwners.get(normalized)} and ${key}`);
        } else {
          statusOwners.set(normalized, key);
        }
      }
    }
  }
  addRequiredString(errors, printing.retryIdField, "printing.retryIdField");
}

/** Resolve catalog > env > legacy flat settings, while never supplying a production fallback. */
export function resolveBackendAdapter(env = {}, settings = {}) {
  const legacy = {
    baseUrl: settings.backendApiBase || env.BACKEND_API_BASE || "",
    endpoints: isPlainObject(settings.endpoints) ? settings.endpoints : {}
  };
  const fromEnv = parseObject(env.BACKEND_ADAPTER_JSON, "BACKEND_ADAPTER_JSON");
  const fromCatalog = parseObject(settings.backendAdapter, "settings.backendAdapter");
  let adapter = mergeObjects(mergeObjects(legacy, fromEnv), fromCatalog);

  // One-release migration input for deployments that already configured this old secret. It does
  // not add a business code by itself and never appears in the tracked example.
  if (adapter.auth && adapter.auth.sessionProofCodes === undefined && env.BACKEND_SESSION_PROOF_CODES) {
    adapter.auth.sessionProofCodes = configuredValues(env.BACKEND_SESSION_PROOF_CODES);
  }
  if (adapter.auth && !Object.prototype.hasOwnProperty.call(fromCatalog.auth || {}, "sessionInvalidCodes")
      && Array.isArray(settings.sessionInvalidCodes)) {
    adapter.auth.sessionInvalidCodes = clone(settings.sessionInvalidCodes);
  }
  if (adapter.auth && !Object.prototype.hasOwnProperty.call(fromCatalog.auth || {}, "sessionInvalidHttpStatuses")
      && Array.isArray(settings.sessionInvalidHttpStatuses)) {
    adapter.auth.sessionInvalidHttpStatuses = clone(settings.sessionInvalidHttpStatuses);
  }
  if (adapter.auth && !Object.prototype.hasOwnProperty.call(fromCatalog.auth || {}, "sessionInvalidMessagePatterns")
      && Array.isArray(settings.sessionInvalidMessagePatterns)) {
    adapter.auth.sessionInvalidMessagePatterns = clone(settings.sessionInvalidMessagePatterns);
  }

  const errors = validateBackendAdapter(adapter);
  if (errors.length) throw new BackendConfigurationError(errors);
  adapter.baseUrl = adapter.baseUrl.replace(/\/+$/, "");
  return adapter;
}

/** Restrict the unauthenticated bootstrap response to values required by the browser login/editor. */
export function panelBootstrapAdapter(adapter) {
  const endpointNames = ["captcha", "loginVerify", "login", "userInfo", "templateList", "templateDetail"];
  const endpoints = {};
  for (const name of endpointNames) {
    if (typeof adapter.endpoints[name] === "string" && adapter.endpoints[name]) endpoints[name] = adapter.endpoints[name];
  }
  return {
    version: adapter.version,
    baseUrl: adapter.baseUrl,
    endpoints,
    request: clone(adapter.request),
    response: clone(adapter.response),
    auth: {
      loginFields: clone(adapter.auth.loginFields),
      tokenFields: clone(adapter.auth.tokenFields),
      userNameFields: clone(adapter.auth.userNameFields),
      successFieldsWhenCodeMissing:
        clone(adapter.auth.successFieldsWhenCodeMissing),
      dataRootWhenCodeMissing: adapter.auth.dataRootWhenCodeMissing
    },
    pagination: clone(adapter.pagination),
    fields: clone(adapter.fields),
    conversion: clone(adapter.conversion)
  };
}

/** Dot-path accessor shared by response and field mapping code. Empty path means the root value. */
export function valueAt(value, path) {
  if (path === undefined || path === null || path === "" || path === "$") return value;
  return String(path).split(".").reduce((current, key) =>
    current === undefined || current === null ? undefined : current[key], value);
}

export function firstValueAt(value, paths) {
  for (const path of paths || []) {
    const found = valueAt(value, path);
    if (found !== undefined && found !== null && found !== "") return found;
  }
  return undefined;
}

function sameBusinessValue(left, right) {
  if (typeof left === typeof right) return left === right;
  return String(left) === String(right);
}

function canonicalFieldKind(rawType, fieldKinds) {
  for (const kind of CANONICAL_FIELD_KINDS) {
    const configured = fieldKinds?.[kind] || [];
    if (configured.some((value) => sameBusinessValue(value, rawType))) return kind;
  }
  return "unknown";
}

function canonicalOption(raw, map) {
  return {
    value: valueAt(raw, map.value),
    name: valueAt(raw, map.label),
    en_name: valueAt(raw, map.englishLabel),
    num: valueAt(raw, map.quantity)
  };
}

function resultMapping(option, mappings) {
  const label = `${option.name || ""} ${option.en_name || ""}`.trim();
  return (mappings || []).find((mapping) =>
    (mapping.matchValues || []).some((value) => sameBusinessValue(value, option.value))
      || (mapping.matchLabelPatterns || []).some((pattern) => new RegExp(pattern, "i").test(label)));
}

function canonicalFormField(raw, map, optionMap, conversion) {
  const rawOptions = valueAt(raw, map.options);
  const rawType = valueAt(raw, map.type);
  const kind = canonicalFieldKind(rawType, conversion?.fieldKinds);
  const options = Array.isArray(rawOptions) ? rawOptions.map((option) => canonicalOption(option, optionMap)) : [];
  if (kind === "result") {
    options.forEach((option, index) => {
      const mapping = resultMapping(option, conversion?.result?.mappings);
      option.resultKey = mapping?.key || `option-${index + 1}`;
      option.resultLabel = mapping?.label || option.name || option.en_name || option.resultKey;
      if (mapping?.labelI18n) option.resultLabelI18n = clone(mapping.labelI18n);
      if (mapping?.operatorLabel) option.resultOperatorLabel = mapping.operatorLabel;
      if (mapping?.operatorLabelI18n) {
        option.resultOperatorLabelI18n = clone(mapping.operatorLabelI18n);
      }
      if (mapping?.uiColor) option.resultUiColor = mapping.uiColor;
      option.resultValue = mapping && Object.prototype.hasOwnProperty.call(mapping, "submitValue")
        ? clone(mapping.submitValue)
        : clone(option.value);
      option.includeInResults = mapping ? mapping.include !== false : conversion?.result?.includeUnmapped !== false;
    });
  }
  return {
    field: valueAt(raw, map.id),
    kind,
    type: rawType,
    parent_type: valueAt(raw, map.parentType),
    type_name: valueAt(raw, map.typeName),
    title: valueAt(raw, map.title),
    en_title: valueAt(raw, map.englishTitle),
    required: valueAt(raw, map.required),
    visible: valueAt(raw, map.visible),
    count: valueAt(raw, map.maxCount),
    option_list: options
  };
}

/** Convert a deployment-specific template envelope to the converter's stable public schema. */
export function canonicalTemplate(raw, adapter) {
  const map = adapter.fields.template;
  const rawFields = valueAt(raw, map.fieldList);
  return {
    id: valueAt(raw, map.id),
    name: valueAt(raw, map.name),
    sku: valueAt(raw, map.sku),
    process_id: valueAt(raw, map.step),
    warehouse_id: valueAt(raw, map.warehouseId),
    field_list: Array.isArray(rawFields)
      ? rawFields.map((field) => canonicalFormField(field, adapter.fields.formField, adapter.fields.option, adapter.conversion))
      : []
  };
}

export function templateItems(data, adapter) {
  for (const path of adapter.fields.templateList) {
    const items = valueAt(data, path);
    if (Array.isArray(items)) return items.map((item) => canonicalTemplate(item, adapter));
  }
  return [];
}
