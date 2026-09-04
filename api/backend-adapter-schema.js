// The adapter itself: base URL, endpoints, request transport, response envelope, auth,
// pagination and fields.
import { AUTHORING_ENDPOINTS, BACKEND_ADAPTER_VERSION, CORE_APP_ENDPOINTS, ENDPOINT_KEYS, REQUIRED_FORM_FIELDS, REQUIRED_OPTION_FIELDS, REQUIRED_TEMPLATE_FIELDS } from "./backend-adapter-constants.js";
import { validateConversion } from "./backend-adapter-conversion.js";
import { validateOperations } from "./backend-adapter-operations.js";
import { allowOnly, placeholderBaseUrl } from "./backend-adapter-outcome-policy.js";
import { addRequiredString, addStringArray, isPlainObject } from "./backend-adapter-primitives.js";
import { validatePrinting } from "./backend-adapter-printing.js";

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

