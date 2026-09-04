// The v3 delivery block and the adapter that carries it.
import { ALLOWED_METHODS, V3_ALLOWED_KEYS, V3_DELIVERY_KEYS, V3_DELIVERY_NAMES, V3_RESPONSE_KEYS } from "./notification-adapter-constants.js";
import { boundedString, containsMessagePlaceholder, isJsonContainer, isPlainObject } from "./notification-adapter-primitives.js";
import { validateTemplateContainer } from "./notification-adapter-round-data.js";
import { validateRoundMessageTemplate, validateV3Formatters } from "./notification-adapter-templates.js";

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

export function validateNotificationAdapterV3(adapter) {
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
