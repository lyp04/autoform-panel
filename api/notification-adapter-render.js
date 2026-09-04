// Rendering a notification: messages, round bodies, and whether a response counts as delivered.
import { MAX_MESSAGE_CONDITIONAL_DEPTH, MAX_RENDERED_MESSAGE_LENGTH, NOTIFICATION_ADAPTER_ROUND_VERSION, SUBMISSION_ROUND_FIELDS, V3_DELIVERY_NAMES } from "./notification-adapter-constants.js";
import { isJsonContainer, isPlainObject, parseIsoOffsetDateTime } from "./notification-adapter-primitives.js";
import { controlledTemplateTokens } from "./notification-adapter-templates.js";
import { validateNotificationAdapterV3 } from "./notification-adapter-v3.js";

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
