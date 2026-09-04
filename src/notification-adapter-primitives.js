// Shared value checks: containers, placeholders, bounded strings and ISO timestamps.
import { DATA_KEY_PATTERN, EVENT_TYPE_PATTERN, MAX_ROUND_ITEMS, NOTIFICATION_EVENT_SCHEMAS } from "./notification-adapter-constants.js";

export function isJsonContainer(value) {
  return value !== null && typeof value === "object";
}

export function containsMessagePlaceholder(value) {
  if (typeof value === "string") return value.includes("{{message}}");
  if (Array.isArray(value)) return value.some(containsMessagePlaceholder);
  if (isJsonContainer(value)) return Object.values(value).some(containsMessagePlaceholder);
  return false;
}

export function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function templatePlaceholders(template) {
  return [...String(template || "").matchAll(/\{\{([^{}]*)\}\}/g)]
    .map((match) => match[1]);
}

export function validateEventTemplates(value, errors) {
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

export function boundedString(value, maxLength, { allowEmpty = false } = {}) {
  return typeof value === "string"
    && value.length <= maxLength
    && (allowEmpty || value.length > 0);
}

export function parseIsoOffsetDateTime(value) {
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

export function validateStringArray(value, path, maxLength, errors) {
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
