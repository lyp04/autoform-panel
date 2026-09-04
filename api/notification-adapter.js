// Versioned JSON notification contract stored in Worker-only panel settings.
//
// Custom headers are intentionally unsupported: this private Worker setting must not become a
// general-purpose secret-header store. The App receives only the same-origin proxy endpoint. A
// deployment that needs header-based credentials can place a server-side relay in front of its provider.

export const NOTIFICATION_ADAPTER_VERSION = 2;
export const NOTIFICATION_ADAPTER_ROUND_VERSION = 3;

const V2_ALLOWED_KEYS = new Set([
  "version", "url", "method", "bodyTemplate", "eventTemplates", "successStatuses", "response"
]);
const V3_ALLOWED_KEYS = new Set(["version", "deliveries"]);
const V3_DELIVERY_NAMES = Object.freeze(["summary", "problem"]);
const V3_DELIVERY_KEYS = new Set([
  "url", "method", "bodyTemplate", "messageTemplate", "formatters", "successStatuses",
  "response", "timeoutMs"
]);
const V3_RESPONSE_KEYS = new Set(["textContains"]);
const V3_FORMATTER_TYPES = new Set(["length", "list", "isoLocalSeconds", "groupedCountList"]);
const V3_FORMATTER_KEYS = Object.freeze({
  length: new Set(["type"]),
  list: new Set(["type", "empty", "separator", "prefixEach"]),
  isoLocalSeconds: new Set(["type"]),
  groupedCountList: new Set([
    "type", "empty", "groupSeparator", "itemSeparator", "groupTemplate", "itemTemplate"
  ])
});
const ALLOWED_METHODS = new Set(["POST", "PUT", "PATCH"]);
const EVENT_TYPE_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;
const DATA_KEY_PATTERN = /^[A-Za-z][A-Za-z0-9]{0,63}$/;
const ISO_DATE_TIME_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;
const MAX_ROUND_COUNT = 1_000_000;
const MAX_ROUND_ITEMS = 100;
const MAX_LABEL_LENGTH = 160;
const MAX_IDENTIFIER_LENGTH = 128;
const MAX_DETAIL_LENGTH = 512;
const MAX_TIMESTAMP_LENGTH = 40;
const MAX_MESSAGE_TEMPLATE_TOKENS = 128;
const MAX_MESSAGE_CONDITIONAL_DEPTH = 4;
const MAX_FORMATTER_TEXT_LENGTH = 512;
const MAX_FORMATTER_SEPARATOR_LENGTH = 64;
const MAX_FORMATTER_TEMPLATE_LENGTH = 1000;
const MAX_RENDERED_MESSAGE_LENGTH = 128_000;

export const NOTIFICATION_EVENT_SCHEMAS = Object.freeze({
  "submission.summary": Object.freeze({
    success: "boolean",
    submittedCount: "nonNegativeInteger",
    errorCount: "nonNegativeInteger",
    unconfirmedPrintCount: "nonNegativeInteger",
    missingMaterialTypeCount: "nonNegativeInteger",
    newMissingMaterialTypeCount: "nonNegativeInteger",
    recoveredMaterialTypeCount: "nonNegativeInteger",
    networkAffectedCount: "nonNegativeInteger"
  }),
  "runtime.failure": Object.freeze({
    stage: "failureStage",
    errorCode: "failureCode",
    subphase: "failureSubphase",
    fingerprint: "fingerprint",
    appVersion: "appVersion",
    gitHead: "gitHead",
    androidSdk: "nonNegativeInteger",
    networkTransport: "networkTransport",
    networkValidated: "boolean",
    networkCaptive: "boolean",
    networkInternet: "boolean",
    networkMetered: "boolean",
    networkVpn: "boolean"
  })
});

const SUBMISSION_ROUND_FIELD_SHAPE = Object.freeze({
  success: "boolean",
  profileLabel: "string",
  operatorLabel: "string",
  completedAt: "isoOffsetDateTime",
  submittedCount: "integer",
  missingItems: "countedItemArray",
  newMissingItems: "stringArray",
  recoveredItems: "stringArray",
  errors: "stringArray",
  unconfirmedIdentifiers: "stringArray",
  networkAffectedIdentifiers: "stringArray"
});

export const SUBMISSION_ROUND_FIELDS = Object.freeze(Object.keys(SUBMISSION_ROUND_FIELD_SHAPE));

const MIGRATED_SUBMISSION_TEMPLATE = [
  "Submission summary:",
  "submitted={{submittedCount}}, errors={{errorCount}},",
  "unconfirmed={{unconfirmedPrintCount}}, missing types={{missingMaterialTypeCount}},",
  "new missing types={{newMissingMaterialTypeCount}}, recovered types={{recoveredMaterialTypeCount}},",
  "network affected={{networkAffectedCount}}"
].join(" ");

function isJsonContainer(value) {
  return value !== null && typeof value === "object";
}

function containsMessagePlaceholder(value) {
  if (typeof value === "string") return value.includes("{{message}}");
  if (Array.isArray(value)) return value.some(containsMessagePlaceholder);
  if (isJsonContainer(value)) return Object.values(value).some(containsMessagePlaceholder);
  return false;
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function templatePlaceholders(template) {
  return [...String(template || "").matchAll(/\{\{([^{}]*)\}\}/g)]
    .map((match) => match[1]);
}

function validateEventTemplates(value, errors) {
  if (!isPlainObject(value) || Object.keys(value).length === 0) {
    errors.push("notificationAdapter.eventTemplates must be a non-empty object");
    return;
  }
  for (const [type, template] of Object.entries(value)) {
    if (!EVENT_TYPE_PATTERN.test(type) || !NOTIFICATION_EVENT_SCHEMAS[type]) {
      errors.push(`notificationAdapter.eventTemplates.${type} is not a supported event type`);
      continue;
    }
    if (typeof template !== "string" || !template.trim()) {
      errors.push(`notificationAdapter.eventTemplates.${type} must be a non-empty string`);
      continue;
    }
    if (template.length > 4000) {
      errors.push(`notificationAdapter.eventTemplates.${type} must not exceed 4000 characters`);
    }
    const allowed = new Set(["type", ...Object.keys(NOTIFICATION_EVENT_SCHEMAS[type])]);
    for (const field of templatePlaceholders(template)) {
      if (!DATA_KEY_PATTERN.test(field) && field !== "type") {
        errors.push(`notificationAdapter.eventTemplates.${type} uses invalid placeholder {{${field}}}`);
      } else if (!allowed.has(field)) {
        errors.push(`notificationAdapter.eventTemplates.${type} uses unsupported placeholder {{${field}}}`);
      }
    }
  }
}

function boundedString(value, maxLength, { allowEmpty = false } = {}) {
  return typeof value === "string"
    && value.length <= maxLength
    && (allowEmpty || value.length > 0);
}

function parseIsoOffsetDateTime(value) {
  if (typeof value !== "string") return null;
  const match = value.match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|([+-])(\d{2}):(\d{2}))$/
  );
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const offsetHour = match[7] === "Z" ? 0 : Number(match[9]);
  const offsetMinute = match[7] === "Z" ? 0 : Number(match[10]);
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > daysInMonth[month - 1]
      || hour > 23 || minute > 59 || second > 59
      || offsetHour > 14 || offsetMinute > 59
      || (offsetHour === 14 && offsetMinute !== 0)) {
    return null;
  }
  return {
    localSeconds: `${match[1]}-${match[2]}-${match[3]} ${match[4]}:${match[5]}:${match[6]}`
  };
}

function validateStringArray(value, path, maxLength, errors) {
  if (!Array.isArray(value)) {
    errors.push(`${path} must be an array`);
    return;
  }
  if (value.length > MAX_ROUND_ITEMS) {
    errors.push(`${path} must not contain more than ${MAX_ROUND_ITEMS} items`);
  }
  value.forEach((item, index) => {
    if (!boundedString(item, maxLength)) {
      errors.push(`${path}[${index}] must be a non-empty string not exceeding ${maxLength} characters`);
    }
  });
}

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

function validateSubmissionRoundData(data) {
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

function validateTemplateContainer(value, path, errors, depth = 0) {
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

function controlledTemplateTokens(template, path, errors, {
  allowedPlaceholders,
  allowedConditionals = new Set(),
  allowConditionals = false,
  maxDepth = 0
}) {
  const tokens = [];
  let cursor = 0;
  let conditionalDepth = 0;
  let tokenLimitReported = false;
  while (cursor < template.length) {
    const open = template.indexOf("{{", cursor);
    const strayClose = template.indexOf("}}", cursor);
    if (strayClose !== -1 && (open === -1 || strayClose < open)) {
      errors.push(`${path} contains an unexpected }} token`);
      cursor = strayClose + 2;
      continue;
    }
    if (open === -1) {
      if (cursor < template.length) tokens.push({ kind: "text", value: template.slice(cursor) });
      break;
    }
    if (open > cursor) tokens.push({ kind: "text", value: template.slice(cursor, open) });
    const close = template.indexOf("}}", open + 2);
    if (close === -1) {
      errors.push(`${path} contains an unterminated {{ token`);
      break;
    }
    const raw = template.slice(open + 2, close);
    if (raw === "/if") {
      if (!allowConditionals) {
        errors.push(`${path} does not support conditional blocks`);
      } else if (conditionalDepth === 0) {
        errors.push(`${path} contains {{/if}} without a matching {{#if field}}`);
      } else {
        conditionalDepth--;
      }
      tokens.push({ kind: "ifEnd" });
    } else if (raw.startsWith("#if")) {
      const match = raw.match(/^#if ([A-Za-z][A-Za-z0-9]{0,63})$/);
      if (!allowConditionals) {
        errors.push(`${path} does not support conditional blocks`);
      } else if (!match) {
        errors.push(`${path} uses invalid conditional token {{${raw}}}`);
      } else {
        const field = match[1];
        if (!allowedConditionals.has(field)) {
          errors.push(`${path} uses unsupported conditional field ${field}`);
        }
        conditionalDepth++;
        if (conditionalDepth > maxDepth) {
          errors.push(`${path} conditional blocks must not exceed ${maxDepth} levels`);
        }
        tokens.push({ kind: "ifStart", field });
      }
    } else if (!DATA_KEY_PATTERN.test(raw) && raw !== "type") {
      errors.push(`${path} uses invalid placeholder {{${raw}}}`);
      tokens.push({ kind: "placeholder", field: raw });
    } else {
      if (!allowedPlaceholders.has(raw)) {
        errors.push(`${path} uses unsupported placeholder {{${raw}}}`);
      }
      tokens.push({ kind: "placeholder", field: raw });
    }
    if (tokens.length > MAX_MESSAGE_TEMPLATE_TOKENS && !tokenLimitReported) {
      errors.push(`${path} must not contain more than ${MAX_MESSAGE_TEMPLATE_TOKENS} template tokens`);
      tokenLimitReported = true;
    }
    cursor = close + 2;
  }
  if (conditionalDepth > 0) {
    errors.push(`${path} contains an unclosed {{#if field}} block`);
  }
  return tokens;
}

function validateRoundMessageTemplate(template, path, errors) {
  if (!boundedString(template, 4000)) {
    errors.push(`${path} must be a non-empty string not exceeding 4000 characters`);
    return;
  }
  controlledTemplateTokens(template, path, errors, {
    allowedPlaceholders: new Set(["type", ...SUBMISSION_ROUND_FIELDS]),
    allowedConditionals: new Set(SUBMISSION_ROUND_FIELDS),
    allowConditionals: true,
    maxDepth: MAX_MESSAGE_CONDITIONAL_DEPTH
  });
}

function validateFormatterText(value, path, maxLength, errors, allowEmpty = true) {
  if (!boundedString(value, maxLength, { allowEmpty })) {
    errors.push(`${path} must be a string not exceeding ${maxLength} characters`);
  }
}

function validateFormatterTemplate(value, path, allowedPlaceholders, errors) {
  if (!boundedString(value, MAX_FORMATTER_TEMPLATE_LENGTH)) {
    errors.push(`${path} must be a non-empty string not exceeding ${MAX_FORMATTER_TEMPLATE_LENGTH} characters`);
    return;
  }
  controlledTemplateTokens(value, path, errors, {
    allowedPlaceholders: new Set(allowedPlaceholders)
  });
}

function validateV3Formatters(formatters, path, errors) {
  if (formatters === undefined) return;
  if (!isPlainObject(formatters)) {
    errors.push(`${path} must be an object`);
    return;
  }
  const entries = Object.entries(formatters);
  if (entries.length > SUBMISSION_ROUND_FIELDS.length) {
    errors.push(`${path} must not contain more than ${SUBMISSION_ROUND_FIELDS.length} fields`);
  }
  for (const [field, formatter] of entries) {
    const itemPath = `${path}.${field}`;
    const fieldKind = SUBMISSION_ROUND_FIELD_SHAPE[field];
    if (!fieldKind) {
      errors.push(`${itemPath} is not a supported submission.round field`);
      continue;
    }
    if (!isPlainObject(formatter)) {
      errors.push(`${itemPath} must be an object`);
      continue;
    }
    const type = formatter.type;
    if (!V3_FORMATTER_TYPES.has(type)) {
      errors.push(`${itemPath}.type must be one of: ${[...V3_FORMATTER_TYPES].join(", ")}`);
      for (const key of Object.keys(formatter)) {
        if (key !== "type") errors.push(`${itemPath}.${key} is not supported`);
      }
      continue;
    }
    for (const key of Object.keys(formatter)) {
      if (!V3_FORMATTER_KEYS[type].has(key)) errors.push(`${itemPath}.${key} is not supported`);
    }
    const compatible = type === "length"
      ? fieldKind === "stringArray" || fieldKind === "countedItemArray"
      : type === "list"
        ? fieldKind === "stringArray"
        : type === "isoLocalSeconds"
          ? fieldKind === "isoOffsetDateTime"
          : fieldKind === "countedItemArray";
    if (!compatible) {
      errors.push(`${itemPath}.type ${type} is not supported for ${field}`);
    }
    if (type === "list") {
      validateFormatterText(formatter.empty, `${itemPath}.empty`, MAX_FORMATTER_TEXT_LENGTH, errors);
      validateFormatterText(formatter.separator, `${itemPath}.separator`,
        MAX_FORMATTER_SEPARATOR_LENGTH, errors);
      validateFormatterText(formatter.prefixEach, `${itemPath}.prefixEach`,
        MAX_FORMATTER_SEPARATOR_LENGTH, errors);
    } else if (type === "groupedCountList") {
      validateFormatterText(formatter.empty, `${itemPath}.empty`, MAX_FORMATTER_TEXT_LENGTH, errors);
      validateFormatterText(formatter.groupSeparator, `${itemPath}.groupSeparator`,
        MAX_FORMATTER_SEPARATOR_LENGTH, errors);
      validateFormatterText(formatter.itemSeparator, `${itemPath}.itemSeparator`,
        MAX_FORMATTER_SEPARATOR_LENGTH, errors);
      validateFormatterTemplate(formatter.groupTemplate, `${itemPath}.groupTemplate`,
        ["count", "items"], errors);
      validateFormatterTemplate(formatter.itemTemplate, `${itemPath}.itemTemplate`,
        ["index", "label", "count"], errors);
    }
  }
}

function validateV3Delivery(delivery, name, errors) {
  const path = `notificationAdapter.deliveries.${name}`;
  if (!isPlainObject(delivery)) {
    errors.push(`${path} must be an object`);
    return;
  }
  for (const key of Object.keys(delivery)) {
    if (!V3_DELIVERY_KEYS.has(key)) errors.push(`${path}.${key} is not supported`);
  }
  if (!boundedString(delivery.url, 2048)) {
    errors.push(`${path}.url is required and must not exceed 2048 characters`);
  } else {
    try {
      const url = new URL(delivery.url);
      if (url.protocol !== "https:" && url.protocol !== "http:") {
        errors.push(`${path}.url must use http or https`);
      }
    } catch {
      errors.push(`${path}.url must be an absolute URL`);
    }
  }
  const method = String(delivery.method || "").toUpperCase();
  if (!ALLOWED_METHODS.has(method)) {
    errors.push(`${path}.method must be one of: ${[...ALLOWED_METHODS].join(", ")}`);
  }
  if (!isJsonContainer(delivery.bodyTemplate)) {
    errors.push(`${path}.bodyTemplate must be a JSON object or array`);
  } else {
    validateTemplateContainer(delivery.bodyTemplate, `${path}.bodyTemplate`, errors);
    if (!containsMessagePlaceholder(delivery.bodyTemplate)) {
      errors.push(`${path}.bodyTemplate must contain {{message}}`);
    }
  }
  validateRoundMessageTemplate(delivery.messageTemplate, `${path}.messageTemplate`, errors);
  validateV3Formatters(delivery.formatters, `${path}.formatters`, errors);
  if (!Array.isArray(delivery.successStatuses) || delivery.successStatuses.length === 0) {
    errors.push(`${path}.successStatuses must be a non-empty array`);
  } else {
    const seen = new Set();
    delivery.successStatuses.forEach((status, index) => {
      if (!Number.isInteger(status) || status < 100 || status > 599) {
        errors.push(`${path}.successStatuses[${index}] must be an HTTP status integer`);
      } else if (seen.has(status)) {
        errors.push(`${path}.successStatuses[${index}] must not be duplicated`);
      }
      seen.add(status);
    });
  }
  if (!isPlainObject(delivery.response)) {
    errors.push(`${path}.response must be an object`);
  } else {
    for (const key of Object.keys(delivery.response)) {
      if (!V3_RESPONSE_KEYS.has(key)) errors.push(`${path}.response.${key} is not supported`);
    }
    if (!boundedString(delivery.response.textContains, 256)) {
      errors.push(`${path}.response.textContains must be a non-empty string not exceeding 256 characters`);
    }
  }
  if (!Number.isInteger(delivery.timeoutMs)
      || delivery.timeoutMs < 1000 || delivery.timeoutMs > 8000) {
    errors.push(`${path}.timeoutMs must be an integer from 1000 to 8000`);
  }
}

function validateNotificationAdapterV3(adapter) {
  const errors = [];
  for (const key of Object.keys(adapter)) {
    if (!V3_ALLOWED_KEYS.has(key)) errors.push(`notificationAdapter.${key} is not supported`);
  }
  if (!isPlainObject(adapter.deliveries)) {
    errors.push("notificationAdapter.deliveries must be an object");
    return errors;
  }
  for (const key of Object.keys(adapter.deliveries)) {
    if (!V3_DELIVERY_NAMES.includes(key)) {
      errors.push(`notificationAdapter.deliveries.${key} is not supported`);
    }
  }
  for (const name of V3_DELIVERY_NAMES) {
    validateV3Delivery(adapter.deliveries[name], name, errors);
  }
  return errors;
}

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

export function renderNotificationMessage(adapter, type, data) {
  const template = adapter?.eventTemplates?.[type];
  if (typeof template !== "string") throw new Error("notification event is not configured");
  const values = { type, ...(isPlainObject(data) ? data : {}) };
  return template.replace(/\{\{([A-Za-z][A-Za-z0-9]{0,63}|type)\}\}/g,
    (_match, key) => String(values[key] ?? ""));
}

function roundPlaceholderText(value) {
  if (Array.isArray(value)) {
    return value.map((item) => {
      if (isPlainObject(item)
          && Object.keys(item).length === 2
          && typeof item.label === "string"
          && Number.isInteger(item.affectedCount)) {
        return `${item.label} × ${item.affectedCount}`;
      }
      return typeof item === "string" ? item : JSON.stringify(item);
    }).join("\n");
  }
  if (isPlainObject(value)) return JSON.stringify(value);
  return String(value ?? "");
}

function renderSimpleControlledTemplate(template, values, allowedPlaceholders) {
  const errors = [];
  const tokens = controlledTemplateTokens(template, "formatter template", errors, {
    allowedPlaceholders: new Set(allowedPlaceholders)
  });
  if (errors.length) throw new Error("notification formatter template is invalid");
  return tokens.map((token) => token.kind === "text"
    ? token.value
    : String(values[token.field] ?? "")).join("");
}

function formatRoundValue(field, value, formatter) {
  if (!formatter) return roundPlaceholderText(value);
  if (formatter.type === "length") {
    if (!Array.isArray(value)) throw new Error("notification formatter input is invalid");
    return String(value.length);
  }
  if (formatter.type === "list") {
    if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
      throw new Error("notification formatter input is invalid");
    }
    if (value.length === 0) return formatter.empty;
    return value.map((item) => `${formatter.prefixEach}${item}`).join(formatter.separator);
  }
  if (formatter.type === "isoLocalSeconds") {
    const parsed = parseIsoOffsetDateTime(value);
    if (!parsed) throw new Error("notification formatter input is invalid");
    return parsed.localSeconds;
  }
  if (formatter.type === "groupedCountList") {
    if (!Array.isArray(value)) throw new Error("notification formatter input is invalid");
    if (value.length === 0) return formatter.empty;
    const grouped = new Map();
    value.forEach((item) => {
      if (!isPlainObject(item) || typeof item.label !== "string"
          || !Number.isInteger(item.affectedCount)) {
        throw new Error("notification formatter input is invalid");
      }
      if (!grouped.has(item.affectedCount)) grouped.set(item.affectedCount, []);
      grouped.get(item.affectedCount).push(item);
    });
    return [...grouped.entries()]
      .map(([count, items]) => ({ count, items }))
      .sort((left, right) => right.count - left.count)
      .map(({ count, items }) => {
        const itemText = items.map((item, index) => renderSimpleControlledTemplate(
          formatter.itemTemplate,
          { index: index + 1, label: item.label, count },
          ["index", "label", "count"]
        )).join(formatter.itemSeparator);
        return renderSimpleControlledTemplate(formatter.groupTemplate,
          { count, items: itemText }, ["count", "items"]);
      })
      .join(formatter.groupSeparator);
  }
  throw new Error("notification formatter is invalid");
}

function roundFieldTruthy(value) {
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "string") return value.length > 0;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "boolean") return value;
  return value !== null && value !== undefined;
}

function renderRoundTemplate(template, values, formatters) {
  const errors = [];
  const tokens = controlledTemplateTokens(template, "messageTemplate", errors, {
    allowedPlaceholders: new Set(["type", ...SUBMISSION_ROUND_FIELDS]),
    allowedConditionals: new Set(SUBMISSION_ROUND_FIELDS),
    allowConditionals: true,
    maxDepth: MAX_MESSAGE_CONDITIONAL_DEPTH
  });
  if (errors.length) throw new Error("notification round message template is invalid");
  const active = [true];
  let rendered = "";
  const append = (value) => {
    const text = String(value);
    if (rendered.length + text.length > MAX_RENDERED_MESSAGE_LENGTH) {
      throw new Error("notification round message exceeds the rendered length limit");
    }
    rendered += text;
  };
  for (const token of tokens) {
    if (token.kind === "ifStart") {
      active.push(active.at(-1) && roundFieldTruthy(values[token.field]));
    } else if (token.kind === "ifEnd") {
      active.pop();
    } else if (active.at(-1) && token.kind === "text") {
      append(token.value);
    } else if (active.at(-1) && token.kind === "placeholder") {
      append(token.field === "type"
        ? String(values.type)
        : formatRoundValue(token.field, values[token.field], formatters?.[token.field]));
    }
  }
  return rendered;
}

export function renderRoundDeliveryMessage(adapter, deliveryName, data) {
  if (adapter?.version !== NOTIFICATION_ADAPTER_ROUND_VERSION
      || !V3_DELIVERY_NAMES.includes(deliveryName)) {
    throw new Error("notification round delivery is not configured");
  }
  if (validateNotificationAdapterV3(adapter).length > 0) {
    throw new Error("notification round delivery is not configured");
  }
  const delivery = adapter.deliveries[deliveryName];
  const template = delivery.messageTemplate;
  if (typeof template !== "string") throw new Error("notification round delivery is not configured");
  const values = { type: "submission.round", ...(isPlainObject(data) ? data : {}) };
  return renderRoundTemplate(template, values, delivery.formatters);
}

export function shouldSendRoundProblem(data) {
  return isPlainObject(data) && (
    data.success === false
    || (Array.isArray(data.errors) && data.errors.length > 0)
    || (Array.isArray(data.unconfirmedIdentifiers) && data.unconfirmedIdentifiers.length > 0)
    || (Array.isArray(data.networkAffectedIdentifiers)
      && data.networkAffectedIdentifiers.length > 0)
  );
}

export function renderNotificationBody(template, values) {
  const context = values && typeof values === "object"
    ? values
    : { message: values };
  if (typeof template === "string") {
    return template
      .replaceAll("{{message}}", String(context.message ?? ""))
      .replaceAll("{{type}}", String(context.type ?? ""));
  }
  if (Array.isArray(template)) return template.map((value) => renderNotificationBody(value, context));
  if (isJsonContainer(template)) {
    return Object.fromEntries(Object.entries(template).map(([key, value]) => [key, renderNotificationBody(value, context)]));
  }
  return template;
}

function valueAt(value, path) {
  if (path === "" || path === "$") return value;
  return String(path).split(".").reduce((current, key) =>
    current === undefined || current === null ? undefined : current[key], value);
}

function sameBusinessValue(left, right) {
  if (typeof left === typeof right) return left === right;
  return String(left) === String(right);
}

export function notificationResponseSucceeded(adapter, status, body) {
  if (!adapter.successStatuses.includes(status)) return false;
  if (!adapter.response) return true;
  const code = valueAt(body, adapter.response.codePath);
  return adapter.response.successValues.some((value) => sameBusinessValue(code, value));
}

export function roundDeliveryResponseSucceeded(delivery, status, rawBody) {
  if (!isPlainObject(delivery) || !Array.isArray(delivery.successStatuses)
      || !delivery.successStatuses.includes(status)) {
    return false;
  }
  const marker = delivery.response?.textContains;
  return typeof marker === "string" && marker.length > 0
    && typeof rawBody === "string" && rawBody.includes(marker);
}
