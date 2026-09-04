// Migration from v2, adapter validation, and the events a caller may send.
import { ALLOWED_METHODS, DATA_KEY_PATTERN, EVENT_TYPE_PATTERN, MIGRATED_SUBMISSION_TEMPLATE, NOTIFICATION_ADAPTER_ROUND_VERSION, NOTIFICATION_ADAPTER_VERSION, NOTIFICATION_EVENT_SCHEMAS, V2_ALLOWED_KEYS } from "./notification-adapter-constants.js";
import { containsMessagePlaceholder, isJsonContainer, isPlainObject, validateEventTemplates } from "./notification-adapter-primitives.js";
import { validateSubmissionRoundData } from "./notification-adapter-round-data.js";
import { validateNotificationAdapterV3 } from "./notification-adapter-v3.js";

/**
 * Convert the old provider transport shape to v2 without accepting old free-form App messages.
 * Runtime diagnostics are deliberately not enabled by migration.
 */
export function migrateNotificationAdapter(adapter) {
  if (!isPlainObject(adapter)) return adapter;
  if (adapter.version !== 1) return JSON.parse(JSON.stringify(adapter));
  const migrated = {
    version: 2,
    url: adapter.url,
    method: adapter.method,
    bodyTemplate: adapter.bodyTemplate,
    eventTemplates: { "submission.summary": MIGRATED_SUBMISSION_TEMPLATE },
    successStatuses: adapter.successStatuses
  };
  if (adapter.response !== undefined) migrated.response = adapter.response;
  // Preserve unknown keys so validation still rejects unsafe legacy extensions such as headers.
  // Never carry a hand-added v1 eventTemplates object across the boundary: migration must not
  // silently authorize runtime diagnostics.
  for (const [key, value] of Object.entries(adapter)) {
    if (!["version", "url", "method", "bodyTemplate", "eventTemplates", "successStatuses", "response"].includes(key)) {
      migrated[key] = value;
    }
  }
  return JSON.parse(JSON.stringify(migrated));
}

function validateNotificationAdapterV2(adapter) {
  const errors = [];
  if (!adapter || typeof adapter !== "object" || Array.isArray(adapter)) {
    return ["notificationAdapter must be an object"];
  }
  for (const key of Object.keys(adapter)) {
    if (!V2_ALLOWED_KEYS.has(key)) errors.push(`notificationAdapter.${key} is not supported`);
  }
  if (adapter.version !== NOTIFICATION_ADAPTER_VERSION) {
    errors.push(`notificationAdapter.version must be ${NOTIFICATION_ADAPTER_VERSION}`);
  }
  if (typeof adapter.url !== "string" || !adapter.url.trim()) {
    errors.push("notificationAdapter.url is required");
  } else {
    try {
      const url = new URL(adapter.url);
      if (url.protocol !== "https:" && url.protocol !== "http:") {
        errors.push("notificationAdapter.url must use http or https");
      }
    } catch {
      errors.push("notificationAdapter.url must be an absolute URL");
    }
  }
  const method = String(adapter.method || "").toUpperCase();
  if (!ALLOWED_METHODS.has(method)) {
    errors.push(`notificationAdapter.method must be one of: ${[...ALLOWED_METHODS].join(", ")}`);
  }
  if (!isJsonContainer(adapter.bodyTemplate)) {
    errors.push("notificationAdapter.bodyTemplate must be a JSON object or array");
  } else if (!containsMessagePlaceholder(adapter.bodyTemplate)) {
    errors.push("notificationAdapter.bodyTemplate must contain {{message}}");
  }
  validateEventTemplates(adapter.eventTemplates, errors);
  if (!Array.isArray(adapter.successStatuses) || adapter.successStatuses.length === 0) {
    errors.push("notificationAdapter.successStatuses must be a non-empty array");
  } else {
    adapter.successStatuses.forEach((status, index) => {
      if (!Number.isInteger(status) || status < 100 || status > 599) {
        errors.push(`notificationAdapter.successStatuses[${index}] must be an HTTP status integer`);
      }
    });
  }
  if (adapter.response !== undefined) {
    if (!adapter.response || typeof adapter.response !== "object" || Array.isArray(adapter.response)) {
      errors.push("notificationAdapter.response must be an object");
    } else {
      for (const key of Object.keys(adapter.response)) {
        if (!["codePath", "successValues"].includes(key)) {
          errors.push(`notificationAdapter.response.${key} is not supported`);
        }
      }
      if (typeof adapter.response.codePath !== "string" || !adapter.response.codePath.trim()) {
        errors.push("notificationAdapter.response.codePath is required");
      }
      if (!Array.isArray(adapter.response.successValues) || adapter.response.successValues.length === 0) {
        errors.push("notificationAdapter.response.successValues must be a non-empty array");
      } else {
        adapter.response.successValues.forEach((value, index) => {
          const valid = (typeof value === "string" && value.trim())
            || (typeof value === "number" && Number.isFinite(value))
            || typeof value === "boolean";
          if (!valid) errors.push(`notificationAdapter.response.successValues[${index}] must be a string, number or boolean`);
        });
      }
    }
  }
  return errors;
}

export function validateNotificationAdapter(adapter) {
  if (!isPlainObject(adapter)) return ["notificationAdapter must be an object"];
  if (adapter.version === NOTIFICATION_ADAPTER_ROUND_VERSION) {
    return validateNotificationAdapterV3(adapter);
  }
  return validateNotificationAdapterV2(adapter);
}

export function notificationEventTypes(adapter) {
  if (adapter?.version === NOTIFICATION_ADAPTER_ROUND_VERSION) {
    return validateNotificationAdapterV3(adapter).length === 0 ? ["submission.round"] : [];
  }
  return isPlainObject(adapter?.eventTemplates) ? Object.keys(adapter.eventTemplates) : [];
}

function validEventValue(kind, value) {
  if (kind === "boolean") return typeof value === "boolean";
  if (kind === "nonNegativeInteger") return Number.isInteger(value) && value >= 0;
  if (kind === "failureStage") {
    return ["runtime", "uncaught", "print", "dns", "network", "submit"].includes(value);
  }
  if (kind === "failureCode") {
    return [
      "printer_not_ready", "reprint_api_failed", "reprint_api_error",
      "label_failed_after_retry", "null_throwable", "unknown_host", "io_exception",
      "security_exception", "state_exception", "argument_exception", "runtime_exception",
      "exception", "unknown_failure"
    ].includes(value);
  }
  if (kind === "failureSubphase") {
    return ["", "process_default", "pre_submit", "print_adapter", "submit_unit", "other"]
      .includes(value);
  }
  if (kind === "fingerprint") return typeof value === "string" && /^[0-9a-f]{8}$/i.test(value);
  if (kind === "appVersion") {
    return value === "unknown" || (typeof value === "string"
      && /^[0-9]{1,5}(?:\.[0-9]{1,5}){1,3}(?:[-+][A-Za-z0-9.-]{1,32})?$/.test(value));
  }
  if (kind === "gitHead") {
    return value === "unknown" || (typeof value === "string" && /^[0-9a-f]{7,40}$/i.test(value));
  }
  if (kind === "networkTransport") {
    return ["unknown", "none", "wifi", "cellular", "ethernet", "vpn", "bluetooth", "other"]
      .includes(value);
  }
  return false;
}

/** Strict App-to-Worker event validation. Free-form messages and unknown fields are rejected. */
export function validateNotificationEvent(value) {
  const errors = [];
  if (!isPlainObject(value)) return ["request must be an object"];
  for (const key of Object.keys(value)) {
    if (!["version", "type", "data"].includes(key)) errors.push(`${key} is not supported`);
  }
  if (value.version === NOTIFICATION_ADAPTER_ROUND_VERSION) {
    if (value.type !== "submission.round") errors.push("type must be submission.round for version 3");
    errors.push(...validateSubmissionRoundData(value.data));
    return errors;
  }
  if (value.version !== 2) errors.push("version must be 2");
  if (typeof value.type !== "string" || !EVENT_TYPE_PATTERN.test(value.type)) {
    errors.push("type must be a 1-64 character identifier");
  }
  const schema = NOTIFICATION_EVENT_SCHEMAS[value.type];
  if (!schema) errors.push("type is not supported");
  if (!isPlainObject(value.data)) {
    errors.push("data must be an object");
    return errors;
  }
  if (!schema) return errors;
  for (const key of Object.keys(value.data)) {
    if (!DATA_KEY_PATTERN.test(key) || !Object.prototype.hasOwnProperty.call(schema, key)) {
      errors.push(`data.${key} is not supported`);
    }
  }
  for (const [key, kind] of Object.entries(schema)) {
    if (!Object.prototype.hasOwnProperty.call(value.data, key)) {
      errors.push(`data.${key} is required`);
    } else if (!validEventValue(kind, value.data[key])) {
      errors.push(`data.${key} is invalid`);
    }
  }
  return errors;
}
